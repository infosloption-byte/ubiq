<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserPreference;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    /**
     * Register a new user
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function register(Request $request)
    {
        // Validate input
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
            // Create user
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

            // Generate token
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
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function login(Request $request)
    {
        // Validate input
        $validator = Validator::make($request->all(), [
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }

        // Find user
        $user = User::where('email', $request->email)->first();

        // Check credentials
        if (!$user || !Hash::check($request->password, $user->password)) {
            return response()->json([
                'error' => 'Invalid credentials',
                'message' => 'The provided credentials are incorrect.'
            ], 401);
        }

        // Delete old tokens (optional - keep only 1 active session)
        // $user->tokens()->delete();

        // Generate new token
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
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function logout(Request $request)
    {
        try {
            // Delete current token
            $request->user()->currentAccessToken()->delete();

            return response()->json([
                'message' => 'Logged out successfully'
            ], 200);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Logout failed',
                'message' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Refresh token
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function refresh(Request $request)
    {
        try {
            $user = $request->user();

            // Delete current token
            $request->user()->currentAccessToken()->delete();

            // Generate new token
            $token = $user->createToken('auth_token')->plainTextToken;

            return response()->json([
                'message' => 'Token refreshed successfully',
                'token' => $token,
            ], 200);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Token refresh failed',
                'message' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get current user
     * 
     * @param Request $request
     * @return \Illuminate\Http\JsonResponse
     */
    public function me(Request $request)
    {
        try {
            $user = $request->user()->load('preferences');

            return response()->json([
                'user' => [
                    'id' => $user->id,
                    'username' => $user->username,
                    'email' => $user->email,
                    'subscription_tier' => $user->subscription_tier,
                    'api_key' => $user->api_key,
                    'email_verified_at' => $user->email_verified_at,
                    'created_at' => $user->created_at,
                    'preferences' => $user->preferences ? [
                        'preferred_model' => $user->preferences->preferred_model,
                        'theme' => $user->preferences->theme,
                        'editor_settings' => json_decode($user->preferences->editor_settings),
                        'auto_complete' => (bool) $user->preferences->auto_complete,
                        'code_suggestions' => (bool) $user->preferences->code_suggestions,
                    ] : null,
                ],
            ], 200);

        } catch (\Exception $e) {
            return response()->json([
                'error' => 'Failed to fetch user',
                'message' => $e->getMessage()
            ], 500);
        }
    }
}