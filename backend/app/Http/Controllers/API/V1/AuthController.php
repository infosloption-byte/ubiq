<?php

// ============================================================
// File: app/Http/Controllers/API/V1/AuthController.php
// ============================================================

namespace App\Http\Controllers\API\V1;

use Laravel\Socialite\Facades\Socialite;
use App\Models\User;
use App\Models\UserPreference;
use App\Models\Plan;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use App\Http\Controllers\Controller;

class AuthController extends Controller
{
    /**
     * Register a new user
     */
    public function register(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'username' => 'required|string|max:100|unique:users,username|alpha_dash',
            'email' => 'required|string|email|max:191|unique:users,email',
            'password' => 'required|string|min:8|confirmed',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        try {
            $user = User::create([
                'username' => $request->username,
                'email' => $request->email,
                'password' => Hash::make($request->password),
                'api_key' => 'ak_' . Str::random(32),
                // B4 — set explicitly rather than relying solely on the
                // column default + PlanService's subscription_tier
                // fallback. Every new user gets a resolvable plan_id from
                // day one; existing users are backfilled separately.
                'plan_id' => Plan::where('key', 'free')->value('id'),
            ]);

            // Default preferences setup...
            $prefs = UserPreference::create([
                'user_id' => $user->id,
                'preferred_model' => 'codellama:7b',
                'theme' => 'dark',
                'editor_settings' => json_encode([
                    'fontSize' => 14,
                    'tabSize' => 4,
                    'wordWrap' => 'on',
                    'minimap' => ['enabled' => false],
                    'lineNumbers' => 'on',
                    'formatOnSave' => true
                ]),
                'auto_complete' => true,
                'code_suggestions' => true,
            ]);

            $token = $user->createToken('auth_token')->plainTextToken;

            return response()->json([
                'message' => 'User registered successfully',
                'user' => $this->formatUserResponse($user, $prefs),
                'token' => $token,
            ], 201);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Registration failed', 'message' => $e->getMessage()], 500);
        }
    }

    /**
     * Login user
     */
    public function login(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json(['error' => 'Invalid credentials'], 401);
        }

        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'message' => 'Login successful',
            'user' => $this->formatUserResponse($user),
            'token' => $token,
        ], 200);
    }

    /**
     * Helper to standardize user response across login/register/me
     */
    private function formatUserResponse(User $user, $prefs = null)
    {
        // If prefs aren't passed, load them
        if (!$prefs && $user->relationLoaded('preferences')) {
            $prefs = $user->preferences;
        }

        return [
            'id' => $user->id,
            'username' => $user->username,
            'email' => $user->email,
            'subscription_tier' => $user->subscription_tier, // Dynamic attribute
            'subscription_status' => $user->subscription_status, // Dynamic attribute
            'trial_days_left' => $user->trial_days_left,
            'api_key' => $user->api_key,
            'is_admin' => $user->is_admin,
            'avatar' => $user->avatar,
            'created_at' => $user->created_at,
            'preferences' => $prefs
        ];
    }

    /**
     * Get current user (me)
     */
    public function me(Request $request)
    {
        try {
            $user = $request->user()->load('preferences');
            return response()->json([
                'user' => $this->formatUserResponse($user)
            ], 200);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch user'], 500);
        }
    }

    /**
     * Logout user
     */
    public function logout(Request $request)
    {
        try {
            $request->user()->currentAccessToken()->delete();
            return response()->json(['message' => 'Logged out successfully'], 200);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Logout failed', 'message' => $e->getMessage()], 500);
        }
    }

    /**
     * Refresh token
     */
    public function refresh(Request $request)
    {
        try {
            $user = $request->user();
            $request->user()->currentAccessToken()->delete();
            $token = $user->createToken('auth_token')->plainTextToken;

            return response()->json([
                'message' => 'Token refreshed successfully',
                'token' => $token,
            ], 200);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Token refresh failed', 'message' => $e->getMessage()], 500);
        }
    }

    /**
     * Alias for 'me' to satisfy routes calling 'user'
     */
    public function user(Request $request)
    {
        return $this->me($request);
    }

    /**
     * Get user preferences
     */
    public function getPreferences(Request $request)
    {
        $preferences = $request->user()->preferences;
        
        // Ensure settings are returned as object, not string
        if ($preferences && is_string($preferences->editor_settings)) {
            $preferences->editor_settings = json_decode($preferences->editor_settings);
        }

        return response()->json(['preferences' => $preferences]);
    }

    /**
     * Update user preferences
     */
    public function updatePreferences(Request $request)
    {
        $user = $request->user();
        
        // Ensure preferences record exists
        $preference = $user->preferences;
        if (!$preference) {
            $preference = $user->preferences()->create([
                'preferred_model' => 'codellama:7b', // Default fallback
                'theme' => 'dark'
            ]);
        }
        
        $data = $request->all();

        // FIX: If editor_settings is passed as an array (from frontend JSON),
        // we must encode it to a string before saving to the database.
        if (isset($data['editor_settings']) && is_array($data['editor_settings'])) {
            $data['editor_settings'] = json_encode($data['editor_settings']);
        }

        // Update the database
        $preference->update($data);
        
        // Refresh the model to get the saved state
        $preference->refresh();

        // Decode for the response so frontend receives JSON object
        if (is_string($preference->editor_settings)) {
            $preference->editor_settings = json_decode($preference->editor_settings);
        }
        
        return response()->json([
            'message' => 'Preferences updated', 
            'preferences' => $preference
        ]);
    }

    public function redirectToGoogle()
    {
        return Socialite::driver('google')->stateless()->redirect();
    }

    public function handleGoogleCallback()
    {
        try {
            $googleUser = Socialite::driver('google')->stateless()->user();
            $email = $googleUser->getEmail();

            // 1. Check if user already exists by email
            $user = User::where('email', $email)->first();

            if (!$user) {
                // 2. Generate a unique username if it's a NEW user
                // Convert "John Doe" to "johndoe"
                $baseUsername = Str::slug($googleUser->getName(), ''); 
                $username = $baseUsername;
                
                // Check if username exists, if so, append random numbers until unique
                $count = 1;
                while (User::where('username', $username)->exists()) {
                    $username = $baseUsername . $count;
                    $count++;
                }

                $user = User::create([
                    'username' => $username,
                    'email' => $email,
                    'password' => Hash::make(Str::random(24)),
                    'google_id' => $googleUser->getId(),
                    'avatar' => $googleUser->getAvatar(),
                    'subscription_tier' => 'free',
                    'plan_id' => Plan::where('key', 'free')->value('id'),
                    'api_key' => 'ak_' . Str::random(32)
                ]);
            } else {
                // 3. Just update the Google-specific info for existing users
                $user->update([
                    'google_id' => $googleUser->getId(),
                    'avatar' => $googleUser->getAvatar(),
                ]);
            }

            // 4. Create Token
            $token = $user->createToken('auth_token')->plainTextToken;

            // 5. Create Default Preferences if missing
            if (!$user->preferences) {
                UserPreference::create([
                    'user_id' => $user->id,
                    'preferred_model' => 'codellama:7b',
                    'theme' => 'dark',
                    'editor_settings' => json_encode([
                        'fontSize' => 14,
                        'tabSize' => 4,
                        'wordWrap' => 'on',
                        'minimap' => ['enabled' => false],
                        'lineNumbers' => 'on',
                        'formatOnSave' => true
                    ]),
                    'auto_complete' => true,
                    'code_suggestions' => true,
                ]);
            }

            // 6. Store token behind a short-lived one-time code.
            //    The code (not the token) goes in the redirect URL, so the
            //    Sanctum token never appears in nginx logs, browser history,
            //    or referrer headers. The frontend exchanges the code
            //    immediately via POST /auth/exchange.
            $code = Str::random(64);
            Cache::put("oauth_code:{$code}", $token, now()->addMinutes(5));

            $frontendUrl = env('FRONTEND_URL', 'https://ubiq-editor.space');
            return redirect("{$frontendUrl}/auth/callback?code={$code}");

        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('Google Login Error: ' . $e->getMessage());
            $frontendUrl = env('FRONTEND_URL', 'https://ubiq-editor.space');
            return redirect("{$frontendUrl}/login?error=Google login failed");
        }
    }

    /**
     * Exchange a one-time OAuth code for a Sanctum token.
     *
     * Called by the frontend immediately after the Google redirect lands.
     * Cache::pull() atomically reads and deletes the entry so each code
     * works exactly once. Codes expire after 5 minutes regardless.
     */
    public function exchangeOAuthCode(Request $request)
    {
        $code = $request->input('code');

        if (!$code || !is_string($code) || strlen($code) !== 64) {
            return response()->json(['error' => 'Invalid code format'], 422);
        }

        // pull() = get + delete in one atomic operation
        $token = Cache::pull("oauth_code:{$code}");

        if (!$token) {
            return response()->json(['error' => 'Code is invalid or has already been used'], 401);
        }

        return response()->json(['token' => $token]);
    }
}