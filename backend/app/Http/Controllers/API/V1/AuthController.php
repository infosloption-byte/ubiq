<?php

// ============================================================
// File: app/Http/Controllers/API/V1/AuthController.php
// ============================================================

namespace App\Http\Controllers\API\V1;

use Laravel\Socialite\Facades\Socialite;
use App\Models\User;
use App\Models\UserPreference;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
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
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }

        try {
            $user = User::create([
                'username' => $request->username,
                'email' => $request->email,
                'password' => Hash::make($request->password),
                'subscription_tier' => 'free',
                'api_key' => 'ak_' . Str::random(32),
            ]);

            // Create default preferences
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

            $token = $user->createToken('auth_token')->plainTextToken;

            return response()->json([
                'message' => 'User registered successfully',
                'user' => [
                    'id' => $user->id,
                    'username' => $user->username,
                    'email' => $user->email,
                    'subscription_tier' => $user->subscription_tier,
                ],
                'token' => $token,
            ], 201);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Registration failed',
                'message' => $e->getMessage()
            ], 500);
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
            return response()->json([
                'error' => 'Invalid credentials',
                'message' => 'The provided credentials are incorrect.'
            ], 401);
        }

        $token = $user->createToken('auth_token')->plainTextToken;

        return response()->json([
            'message' => 'Login successful',
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'subscription_tier' => $user->subscription_tier,
            ],
            'token' => $token,
        ], 200);
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
     * Get current user
     */
    public function me(Request $request)
    {
        try {
            $user = $request->user()->load('preferences');

            $prefs = null;
            if ($user->preferences) {
                // Safely decode editor_settings if it's a string
                $settings = $user->preferences->editor_settings;
                if (is_string($settings)) {
                    $settings = json_decode($settings);
                }

                $prefs = [
                    'preferred_model' => $user->preferences->preferred_model,
                    'theme' => $user->preferences->theme,
                    'editor_settings' => $settings,
                    'auto_complete' => (bool) $user->preferences->auto_complete,
                    'code_suggestions' => (bool) $user->preferences->code_suggestions,
                ];
            }

            return response()->json([
                'user' => [
                    'id' => $user->id,
                    'username' => $user->username,
                    'email' => $user->email,
                    'subscription_tier' => $user->subscription_tier,
                    'api_key' => $user->api_key,
                    'email_verified_at' => $user->email_verified_at,
                    'created_at' => $user->created_at,
                    'preferences' => $prefs,
                ],
            ], 200);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to fetch user', 'message' => $e->getMessage()], 500);
        }
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

            // Find or Create User
            $user = User::firstOrCreate(
                ['email' => $googleUser->getEmail()],
                [
                    'username' => $googleUser->getName(),
                    'password' => bcrypt(Str::random(24)), // Random password
                    'google_id' => $googleUser->getId(),
                    'avatar' => $googleUser->getAvatar(),
                    'subscription_tier' => 'free'
                ]
            );

            // Create Token
            $token = $user->createToken('auth_token')->plainTextToken;

            $frontendUrl = env('FRONTEND_URL', 'https://ubiq-editor.space');

            // Redirect to Frontend with Token
            // CHANGE THIS URL to your actual frontend URL
            return redirect("{$frontendUrl}/auth/callback?token={$token}");

        } catch (\Exception $e) {
            $frontendUrl = env('FRONTEND_URL', 'https://ubiq-editor.space');
            return redirect("{$frontendUrl}/login?error=Google login failed");
        }
    }
}