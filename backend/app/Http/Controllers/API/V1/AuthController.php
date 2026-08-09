<?php

// ============================================================
// File: app/Http/Controllers/API/V1/AuthController.php
// ============================================================

namespace App\Http\Controllers\API\V1;

use Laravel\Socialite\Facades\Socialite;
use App\Models\User;
use App\Models\UserPreference;
use App\Models\Plan;
use App\Services\IpGeolocationService;
use App\Services\PayPalService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;
use App\Http\Controllers\Controller;

class AuthController extends Controller
{
    public function __construct(private IpGeolocationService $geo, private PayPalService $paypal) {}

    /**
     * E3b (PLAN_SYSTEM_TASKS.md Phase E) — every one of the 4 places this
     * controller creates a token now goes through here instead of calling
     * $user->createToken() directly, so device/IP/location metadata is
     * captured consistently at every login path (register, login, token
     * refresh, Google OAuth) rather than needing the same few lines
     * duplicated 4 times and risking one path silently missing it later.
     *
     * The geolocation lookup runs synchronously during login — accepted
     * tradeoff: it's capped at a 2s HTTP timeout (see IpGeolocationService)
     * and only happens once per token creation, not per request, so the
     * worst case is a login that takes up to ~2s longer, not a slowdown
     * that compounds across normal usage.
     */
    private function createTokenWithMetadata(User $user, Request $request): string
    {
        $newToken = $user->createToken('auth_token');

        $ip = $request->ip();
        $location = $this->geo->lookup($ip);

        $newToken->accessToken->forceFill([
            'user_agent' => $request->userAgent(),
            'ip_address' => $ip,
            'city' => $location['city'],
            'region' => $location['region'],
            'country' => $location['country'],
        ])->save();

        return $newToken->plainTextToken;
    }

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

            // E5 — this is a real, user-chosen password (as opposed to the
            // random throwaway one Google OAuth signups get), so mark it.
            // Not in $fillable, set directly via forceFill for clarity.
            $user->forceFill(['password_set_at' => now()])->save();

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

            $token = $this->createTokenWithMetadata($user, $request); // E3b fix — PLAN_SYSTEM_TASKS.md Phase E

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

        $token = $this->createTokenWithMetadata($user, $request); // E3b fix — PLAN_SYSTEM_TASKS.md Phase E

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
            'preferences' => $prefs,
            // E5 — drives "Change Password" vs "Set a Password" and the
            // connected-accounts indicator in Settings > Account. Raw
            // google_id itself is never exposed, only whether it's set.
            'has_password' => $user->has_password,
            'google_connected' => $user->google_id !== null,
            // E4 — Privacy tab default-visibility setting.
            'default_project_visibility' => $user->default_project_visibility,
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
     * E3c (PLAN_SYSTEM_TASKS.md Phase E) — revokes every Sanctum token
     * belonging to this user, not just the one making this request. This
     * intentionally also signs out the session calling it — there's no
     * "log out every device except this one" version, since that's not
     * what "Log Out All Devices" was asked for, and quietly excluding the
     * caller would be a surprising, undocumented exception to what the
     * button says it does.
     */
    public function logoutAllDevices(Request $request)
    {
        try {
            $request->user()->tokens()->delete();
            return response()->json(['message' => 'Logged out of all devices successfully'], 200);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Logout failed', 'message' => $e->getMessage()], 500);
        }
    }

    /**
     * E3b (PLAN_SYSTEM_TASKS.md Phase E) — lists every active session
     * (Sanctum token) for the authenticated user: device (parsed from the
     * stored user_agent on the fly, not pre-parsed and stored, so a future
     * parsing improvement doesn't need a backfill), IP, best-effort
     * city/region/country, created_at, last_used_at, and whether this is
     * the session making the current request.
     */
    public function sessions(Request $request)
    {
        $currentTokenId = $request->user()->currentAccessToken()?->id;

        $sessions = $request->user()->tokens()
            ->orderByDesc('last_used_at')
            ->get()
            ->map(fn ($token) => [
                'id' => $token->id,
                'is_current' => $token->id === $currentTokenId,
                'device' => $this->parseDeviceLabel($token->user_agent),
                'ip_address' => $token->ip_address,
                'location' => trim(implode(', ', array_filter([$token->city, $token->region, $token->country]))) ?: null,
                'created_at' => $token->created_at,
                'last_used_at' => $token->last_used_at,
            ]);

        return response()->json(['sessions' => $sessions]);
    }

    /**
     * E3b — revokes a single session by token id. Scoped via
     * `$request->user()->tokens()->where('id', $id)` rather than a bare
     * `PersonalAccessToken::find($id)` — this is the difference between
     * "delete my own session" and an IDOR letting anyone revoke anyone
     * else's session just by guessing a numeric id. The where() only ever
     * matches a row that's actually in this user's own tokens relation.
     */
    public function revokeSession(Request $request, $id)
    {
        $deleted = $request->user()->tokens()->where('id', $id)->delete();

        if (!$deleted) {
            return response()->json(['error' => 'Session not found'], 404);
        }

        return response()->json(['message' => 'Session revoked'], 200);
    }

    /**
     * E3b — lightweight device/browser label parsed from a raw user-agent
     * string. Deliberately not a full UA-parsing library dependency for
     * what's ultimately a "nice to have" display label — covers the
     * common browsers/platforms, falls back to a generic label rather
     * than guessing wrong for anything unusual.
     */
    private function parseDeviceLabel(?string $userAgent): string
    {
        if (!$userAgent) return 'Unknown device';

        $browser = match (true) {
            str_contains($userAgent, 'Edg/') => 'Edge',
            str_contains($userAgent, 'OPR/') => 'Opera',
            str_contains($userAgent, 'Firefox/') => 'Firefox',
            str_contains($userAgent, 'Chrome/') => 'Chrome',
            str_contains($userAgent, 'Safari/') => 'Safari',
            default => 'Browser',
        };

        $os = match (true) {
            str_contains($userAgent, 'iPhone') => 'iPhone',
            str_contains($userAgent, 'iPad') => 'iPad',
            str_contains($userAgent, 'Android') => 'Android',
            str_contains($userAgent, 'Windows') => 'Windows',
            str_contains($userAgent, 'Macintosh'), str_contains($userAgent, 'Mac OS X') => 'Mac',
            str_contains($userAgent, 'Linux') => 'Linux',
            default => null,
        };

        return $os ? "{$browser} on {$os}" : $browser;
    }

    /**
     * E5 (PLAN_SYSTEM_TASKS.md Phase E) — change or set the account
     * password. Two modes off the same endpoint, keyed off
     * `$user->has_password` (see User::getHasPasswordAttribute()):
     *   - Already has a real password: `current_password` is required and
     *     verified before allowing the change.
     *   - Google-only account with no password yet ("Set a Password"):
     *     no current password to check, since there isn't one the user
     *     actually knows — this ADDS email/password as a second login
     *     method without touching the Google login.
     * Either way, `password_set_at` is (re)stamped to now() so a
     * newly-set password is immediately recognized as "real."
     */
    public function changePassword(Request $request)
    {
        $user = $request->user();

        $rules = [
            'new_password' => 'required|string|min:8|confirmed',
        ];
        if ($user->has_password) {
            $rules['current_password'] = 'required|string';
        }

        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        if ($user->has_password && !Hash::check($request->current_password, $user->password)) {
            return response()->json(['error' => 'Current password is incorrect'], 401);
        }

        $wasSettingForFirstTime = !$user->has_password;

        $user->forceFill([
            'password' => Hash::make($request->new_password),
            'password_set_at' => now(),
        ])->save();

        return response()->json([
            'message' => $wasSettingForFirstTime ? 'Password set successfully' : 'Password changed successfully',
        ], 200);
    }

    /**
     * E4 (PLAN_SYSTEM_TASKS.md Phase E) — set the visibility newly-created
     * projects default to when the create form doesn't explicitly pass
     * one. See ProjectController::store(), which now falls back to this
     * instead of a hardcoded 'private'.
     */
    public function updateDefaultVisibility(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'default_project_visibility' => 'required|in:private,public',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        $user = $request->user();
        $user->update(['default_project_visibility' => $request->default_project_visibility]);

        return response()->json(['default_project_visibility' => $user->default_project_visibility], 200);
    }

    /**
     * E4 — "Export My Data." A GDPR-style self-service export of
     * everything this user actually owns: account info, projects (with
     * file contents), and AI chat history. Streamed as a single JSON
     * attachment rather than built into a variable first — projects can
     * contain a lot of file content, no reason to hold it all in memory
     * twice.
     */
    public function exportData(Request $request)
    {
        $user = $request->user();

        $payload = [
            'exported_at' => now()->toIso8601String(),
            'account' => [
                'id' => $user->id,
                'username' => $user->username,
                'email' => $user->email,
                'created_at' => $user->created_at,
                'subscription_tier' => $user->subscription_tier,
                'google_connected' => $user->google_id !== null,
            ],
            'projects' => $user->projects()
                ->with(['files' => function ($q) {
                    $q->where('is_deleted', false);
                }])
                ->get()
                ->map(fn ($project) => [
                    'id' => $project->id,
                    'name' => $project->name,
                    'description' => $project->description,
                    'visibility' => $project->visibility,
                    'created_at' => $project->created_at,
                    'files' => $project->files->map(fn ($file) => [
                        'name' => $file->name,
                        'path' => $file->path,
                        'content' => $file->content,
                        'size_bytes' => $file->size_bytes,
                    ]),
                ]),
            'chat_sessions' => $user->chatSessions()
                ->with('messages')
                ->get()
                ->map(fn ($session) => [
                    'title' => $session->title,
                    'model_used' => $session->model_used,
                    'created_at' => $session->created_at,
                    'messages' => $session->messages->map(fn ($m) => [
                        'role' => $m->role,
                        'content' => $m->content,
                        'created_at' => $m->created_at,
                    ]),
                ]),
        ];

        $filename = 'ubiq-export-' . $user->username . '-' . now()->format('Y-m-d') . '.json';

        return response()->json($payload, 200, [
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ], JSON_PRETTY_PRINT);
    }

    /**
     * E4 — "Clear AI Chat History." Deletes every chat session belonging
     * to this user, across all projects. `chat_messages` cascades via its
     * `session_id` FK (onDelete cascade, see the base schema migration),
     * so a single delete on chat_sessions is enough — no separate message
     * cleanup needed.
     */
    public function clearChatHistory(Request $request)
    {
        $count = $request->user()->chatSessions()->count();
        $request->user()->chatSessions()->delete();

        return response()->json(['message' => "Cleared {$count} chat session(s)."], 200);
    }

    /**
     * E3d (PLAN_SYSTEM_TASKS.md Phase E) — irreversible account deletion.
     * Deliberately the last thing built in this phase, and the most
     * cautious method in this controller. Order matters here:
     *
     *   1. Typed confirmation FIRST, before touching anything — the
     *      literal word "DELETE" or the account's own email address.
     *   2. Cancel any active PayPal subscription. If PayPal's API call
     *      fails, STOP and return an error rather than deleting the
     *      account anyway — leaving a recurring charge running against a
     *      now-deleted account would be worse than making the user retry.
     *   3. Stop/remove this user's sandbox Docker containers. DB cascade
     *      deletes (step 5) don't touch live containers — they'd leak and
     *      keep running orphaned otherwise.
     *   4. Revoke every Sanctum token explicitly. personal_access_tokens
     *      is a polymorphic table (tokenable_type/id), not a real FK, so
     *      it would NOT be caught by the user row's cascade deletes.
     *   5. Delete the user row itself. Every other user-owned table
     *      (projects, files, chat_sessions, usage_counters,
     *      plan_action_logs, user_ai_keys, etc.) has a real FK with
     *      cascadeOnDelete() — verified against every migration — so this
     *      one delete is genuinely enough to take the rest with it.
     */
    public function deleteAccount(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'confirmation' => 'required|string',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        $user = $request->user();
        $confirmation = trim($request->input('confirmation'));

        if (strcasecmp($confirmation, 'DELETE') !== 0 && strcasecmp($confirmation, $user->email) !== 0) {
            return response()->json(['error' => 'Type DELETE or your account email to confirm.'], 422);
        }

        if ($user->paypal_subscription_id && $user->subscription_status !== 'canceled') {
            $canceled = $this->paypal->cancelSubscription($user->paypal_subscription_id, 'Account deletion');
            if (!$canceled) {
                Log::error("[Account Deletion] Failed to cancel PayPal subscription for user {$user->id} — aborting deletion.");
                return response()->json([
                    'error' => 'Could not cancel your active subscription with PayPal. Please try again or contact support before deleting your account.',
                ], 502);
            }
        }

        foreach ($user->projects()->pluck('id') as $projectId) {
            $containerName = "ubiq_project_{$projectId}";
            Process::run("docker rm -f {$containerName} 2>/dev/null || true");
        }

        try {
            DB::transaction(function () use ($user) {
                $user->tokens()->delete();
                $user->delete();
            });
        } catch (\Exception $e) {
            Log::error('Account deletion failed: ' . $e->getMessage());
            return response()->json(['error' => 'Account deletion failed. Please try again or contact support.'], 500);
        }

        return response()->json(['message' => 'Account deleted.'], 200);
    }

    /**
     * Refresh token
     */
    public function refresh(Request $request)
    {
        try {
            $user = $request->user();
            $request->user()->currentAccessToken()->delete();
            $token = $this->createTokenWithMetadata($user, $request); // E3b fix — PLAN_SYSTEM_TASKS.md Phase E

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

    public function handleGoogleCallback(Request $request)
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
            $token = $this->createTokenWithMetadata($user, $request); // E3b fix — PLAN_SYSTEM_TASKS.md Phase E

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