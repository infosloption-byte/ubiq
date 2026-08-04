<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\API\V1\AuthController;
use App\Http\Controllers\API\V1\ProjectController;
use App\Http\Controllers\API\V1\FileController;
use App\Http\Controllers\API\V1\ChatController;
use App\Http\Controllers\API\V1\CompletionController;
use App\Http\Controllers\API\V1\UsageController;
use App\Http\Controllers\API\V1\AiController;
use App\Http\Controllers\API\V1\AdminController;
use App\Http\Controllers\API\V1\AdminPlanController;
use App\Http\Controllers\API\V1\PlanController;
use App\Http\Controllers\API\V1\GitController;
use App\Http\Controllers\API\V1\TerminalController;
use App\Http\Controllers\API\V1\PayPalController;
use App\Http\Controllers\OllamaProxyController;

// ── Unauthenticated fallback ───────────────────────────────────────────────
Route::get('/login', function () {
    return response()->json([
        'error'   => 'Unauthorized',
        'message' => 'Authentication required. Please log in.',
    ], 401);
})->name('login');

Route::prefix('v1')->group(function () {

    // ── Fully public ──────────────────────────────────────────────────────

    Route::post('/visit', [UsageController::class, 'recordVisit']);

    // C3 — public pricing page data, no auth needed. Distinct from the
    // admin /admin/plans endpoints (B5) — this is read-only and excludes
    // nothing sensitive (paypal_plan_id isn't a secret, same as any
    // publishable checkout ID, and the frontend needs it to build the
    // right subscription per plan in Phase C4).
    Route::get('/plans', [PlanController::class, 'index']);

    // Auth: strict rate limits — 10 attempts per minute per IP
    Route::middleware('throttle:10,1')->group(function () {
        Route::post('/auth/register', [AuthController::class, 'register']);
        Route::post('/auth/login',    [AuthController::class, 'login']);
        // One-time code → token exchange for Google OAuth callback.
        // Must be public (user has no token yet) but rate-limited to
        // prevent brute-forcing the 64-char random codes.
        Route::post('/auth/exchange', [AuthController::class, 'exchangeOAuthCode']);
    });

    Route::get('/auth/google',          [AuthController::class, 'redirectToGoogle']);
    Route::get('/auth/google/callback', [AuthController::class, 'handleGoogleCallback']);

    // PayPal Webhook — must be public; PayPalController::webhook() verifies
    // the signature itself against PayPal's verify-webhook-signature API.
    Route::post('/paypal/webhook', [PayPalController::class, 'webhook']);

    // File Preview — authenticated issues a signed URL, public route validates the signature
    Route::get('/projects/{project}/preview-url/{path}', [FileController::class, 'getPreviewUrl'])
        ->where('path', '.*')
        ->middleware('auth:sanctum');

    Route::get('/projects/{project}/preview/{path}', [FileController::class, 'previewSigned'])
        ->where('path', '.*')
        ->name('projects.preview.signed');

    // ── Authenticated ─────────────────────────────────────────────────────
    Route::middleware(['auth:sanctum', 'throttle:120,1'])->group(function () {

        // Ollama proxy — rate limited separately (can be slow / expensive)
        Route::middleware('throttle:30,1')->group(function () {
            Route::get('/ollama/tags',  [OllamaProxyController::class, 'tags']);
            Route::post('/ollama/chat', [OllamaProxyController::class, 'chat']);
        });

        // Subscription management — allowed even with expired sub.
        // Checkout itself happens client-side via PayPal's Smart Buttons;
        // these confirm/cancel/verify against PayPal's API server-side.
        Route::post('/paypal/confirm', [PayPalController::class, 'confirm']);
        Route::post('/paypal/cancel',  [PayPalController::class, 'cancel']);
        Route::get('/paypal/subscription', [PayPalController::class, 'status']);

        // Admin
        Route::middleware('admin')->prefix('admin')->group(function () {
            Route::get('/stats',          [AdminController::class, 'stats']);
            Route::get('/users',          [AdminController::class, 'getUsers']);
            Route::delete('/users/{id}',  [AdminController::class, 'deleteUser']);

            // B5 — plan/plan_features management, no SSH+tinker needed
            Route::get('/plans/report',                   [AdminPlanController::class, 'report']); // B6, before {plan} wildcard
            Route::get('/plans',                          [AdminPlanController::class, 'index']);
            Route::post('/plans',                         [AdminPlanController::class, 'store']);
            Route::get('/plans/{plan}',                   [AdminPlanController::class, 'show']);
            Route::put('/plans/{plan}',                   [AdminPlanController::class, 'update']);
            Route::get('/plans/{plan}/features',          [AdminPlanController::class, 'features']);
            Route::put('/plans/{plan}/features',          [AdminPlanController::class, 'updateFeatures']);
            Route::delete('/plans/{plan}/features/{featureKey}', [AdminPlanController::class, 'destroyFeature']);
        });

        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/user',    [AuthController::class, 'user']);
        Route::get('/auth/me',      [AuthController::class, 'me']);

        // ── Subscribed users only ─────────────────────────────────────────
        Route::middleware('subscribed')->group(function () {

            // Projects & Files — standard API rate (120/min from parent)
            Route::apiResource('projects', ProjectController::class);
            Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
            Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
            Route::apiResource('projects.files', FileController::class)->shallow();
            Route::delete('projects/{project}/files/path',   [FileController::class, 'destroyPath']);
            Route::post('projects/import',                   [ProjectController::class, 'import']);
            Route::post('projects/{project}/files/upload',   [FileController::class, 'upload']);
            Route::get('projects/{project}/download',        [ProjectController::class, 'download']);
            Route::get('projects/{project}/files/{file}/serve', [FileController::class, 'serve']);
            Route::get('projects/{project}/build-log',       [ProjectController::class, 'getBuildLog']);

            // Storage stats
            Route::get('/user/storage', [ProjectController::class, 'storageStats']);

            // Sandbox — tighter limit: 20 run/stop per minute prevents abuse
            Route::middleware('throttle:20,1')->group(function () {
                Route::post('projects/{project}/run',  [ProjectController::class, 'runProject']);
                Route::post('projects/{project}/stop', [ProjectController::class, 'stopProject']);
            });

            // Heartbeat — pinged every ~30s while a preview is open, needs
            // its own higher limit (120/min covers a full session's worth
            // of pings without ever throttling a normal user).
            Route::middleware('throttle:120,1')->group(function () {
                Route::post('projects/{project}/heartbeat', [ProjectController::class, 'heartbeat']);
            });

            // Terminal — 60 commands per minute (allows rapid use without hammering)
            Route::middleware('throttle:60,1')->group(function () {
                Route::post('projects/{project}/terminal', [TerminalController::class, 'execute']);
            });

            // AI — 30 requests per minute (protects API cost)
            Route::middleware('throttle:30,1')->group(function () {
                Route::post('ai/generate',             [CompletionController::class, 'generate']);
                Route::post('projects/{project}/scaffold', [ProjectController::class, 'scaffold']);
                Route::post('projects/{project}/seed-chat', [ProjectController::class, 'seedChat']);
                Route::post('chat/message',            [CompletionController::class, 'chat']);
                Route::post('/ai/completion',          [CompletionController::class, 'complete']);
                Route::post('/ai/chat',                [CompletionController::class, 'chat']);
                Route::post('/ai/review',              [CompletionController::class, 'review']);
                Route::post('/ai/debug',               [CompletionController::class, 'debug']);
                Route::post('/ai/explain',             [CompletionController::class, 'explain']);
                Route::get('/ai/models',               [AiController::class, 'getModels']);
            });

            // Git
            Route::prefix('projects/{project}/git')->group(function () {
                Route::get('/status',    [GitController::class, 'status']);
                Route::post('/create-pr', [GitController::class, 'createPr']);
            });

            // Chat Sessions & Messages
            Route::get('/chat/sessions',                       [ChatController::class, 'index']);
            Route::post('/chat/sessions',                      [ChatController::class, 'store']);
            Route::get('/chat/sessions/{session}',             [ChatController::class, 'show']);
            Route::delete('/chat/sessions/{session}',          [ChatController::class, 'destroy']);
            Route::post('/chat/sessions/{session}/title',      [ChatController::class, 'generateTitle']);
            Route::patch('/chat/sessions/{session}',           [ChatController::class, 'update']);
            Route::post('/chat/sessions/{session}/upload',     [ChatController::class, 'uploadAttachment']);
            Route::get('/chat/sessions/{session}/messages',    [ChatController::class, 'messages']);
            Route::post('/chat/sessions/{session}/messages',   [ChatController::class, 'sendMessage']);

            // User Preferences & Stats
            Route::get('/user/preferences',  [AuthController::class, 'getPreferences']);
            Route::put('/user/preferences',  [AuthController::class, 'updatePreferences']);
            Route::get('/user/stats',        [UsageController::class, 'stats']);
            Route::get('/user/usage',        [UsageController::class, 'index']);
            Route::get('/user/plan-usage',   [UsageController::class, 'planUsage']);
        });
    });
});

Route::get('/health', function () {
    return response()->json(['status' => 'ok', 'timestamp' => now()->toIso8601String()]);
});