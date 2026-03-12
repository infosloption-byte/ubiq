<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\API\V1\AuthController;
use App\Http\Controllers\API\V1\ProjectController;
use App\Http\Controllers\API\V1\FileController;
use App\Http\Controllers\API\V1\ChatController;
use App\Http\Controllers\API\V1\CompletionController;
use App\Http\Controllers\API\V1\ModelController;
use App\Http\Controllers\API\V1\UsageController;
use App\Http\Controllers\API\V1\AiController;
use App\Http\Controllers\API\V1\AdminController;
use App\Http\Controllers\API\V1\GitController;
use App\Http\Controllers\API\V1\TerminalController;

// Public JSON login route
Route::get('/login', function () {
    return response()->json([
        'error' => 'Unauthorized', 
        'message' => 'Authentication required. Please log in.'
    ], 401);
})->name('login');

Route::prefix('v1')->group(function () {
    // Public routes
    Route::post('/visit', [UsageController::class, 'recordVisit']);
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    Route::get('/auth/google', [AuthController::class, 'redirectToGoogle']);
    Route::get('/auth/google/callback', [AuthController::class, 'handleGoogleCallback']);

    // Paddle Webhook (REQUIRED: Must be public for Paddle to communicate with your server)
    // Laravel Cashier automatically handles most of this logic at this endpoint
    Route::post('/paddle/webhook', '\Laravel\Paddle\Http\Controllers\WebhookController');

    // Project Preview
    Route::get('projects/{project}/preview/{token}/{path}', [FileController::class, 'preview'])
        ->where('path', '.*');
    
    // Protected Routes
    Route::middleware('auth:sanctum')->group(function () {
        
        // Subscription Management
        // These allow the user to manage their plan even if their current one is expired
        Route::get('/user/subscription/pay-link', [AuthController::class, 'getPayLink']); // Get Paddle Checkout URL
        Route::get('/user/subscription/portal', [AuthController::class, 'getManagementPortal']); // Cancel/Update via Paddle

        // Admin Routes
        Route::middleware('admin')->prefix('admin')->group(function () {
            Route::get('/stats', [AdminController::class, 'stats']);
            Route::get('/users', [AdminController::class, 'getUsers']);
            Route::delete('/users/{id}', [AdminController::class, 'deleteUser']);
        });

        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/user', [AuthController::class, 'user']);
        Route::get('/auth/me', [AuthController::class, 'me']);
        
        // Platform Access (Restricted by Subscription/Trial)
        Route::middleware('subscribed')->group(function () {
            
            // Projects & Files
            Route::apiResource('projects', ProjectController::class);
            Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
            Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
            Route::apiResource('projects.files', FileController::class)->shallow();
            Route::delete('projects/{project}/files/path', [FileController::class, 'destroyPath']);
            Route::post('projects/import', [ProjectController::class, 'import']);
            Route::post('projects/{project}/files/upload', [FileController::class, 'upload']);
            Route::get('projects/{project}/download', [ProjectController::class, 'download']);
            Route::get('projects/{project}/files/{file}/serve', [FileController::class, 'serve']);
            Route::post('projects/{project}/run', [ProjectController::class, 'runProject']);
            Route::post('projects/{project}/terminal', [App\Http\Controllers\API\V1\TerminalController::class, 'execute']);
            Route::get('projects/{project}/build-log', [ProjectController::class, 'getBuildLog']);

            // AI Features
            Route::post('ai/generate', [CompletionController::class, 'generate']);
            Route::post('projects/{project}/scaffold', [ProjectController::class, 'scaffold']);
            Route::post('projects/{project}/seed-chat', [ProjectController::class, 'seedChat']);
            Route::post('chat/message', [CompletionController::class, 'chat']);
            Route::post('/ai/completion', [CompletionController::class, 'complete']);
            Route::post('/ai/chat', [CompletionController::class, 'chat']);
            Route::post('/ai/review', [CompletionController::class, 'review']);
            Route::post('/ai/debug', [CompletionController::class, 'debug']);
            Route::post('/ai/explain', [CompletionController::class, 'explain']);
            Route::get('/ai/models', [AiController::class, 'getModels']);

            // Git integration
            Route::prefix('projects/{project}/git')->group(function () {
                Route::get('/status', [GitController::class, 'status']);
                Route::post('/create-pr', [GitController::class, 'createPr']);
            });

            // Project Git 
            // Route::prefix('projects/{project}/git')->group(function () {
            //     Route::get('/status', [GitController::class, 'status']);
            //     // Route::post('/add', [GitController::class, 'add']);
            //     // Route::post('/commit', [GitController::class, 'commit']);
            //     // Route::post('/reset', [GitController::class, 'reset']);
            //     // Route::post('/pull', [GitController::class, 'pull']);
            //     // Route::post('/push', [GitController::class, 'push']);

            //     Route::post('projects/{project}/git/create-pr', [GitController::class, 'createPr']);
            //     Route::get('projects/{project}/git/status', [GitController::class, 'status']);
            // });
            
            // Chat Sessions & Messages
            Route::get('/chat/sessions', [ChatController::class, 'index']);
            Route::post('/chat/sessions', [ChatController::class, 'store']);
            Route::get('/chat/sessions/{session}', [ChatController::class, 'show']);
            Route::delete('/chat/sessions/{session}', [ChatController::class, 'destroy']);
            Route::post('/chat/sessions/{session}/title', [ChatController::class, 'generateTitle']);
            Route::patch('/chat/sessions/{session}', [ChatController::class, 'update']);
            Route::post('/chat/sessions/{session}/upload', [ChatController::class, 'uploadAttachment']);
            Route::get('/chat/sessions/{session}/messages', [ChatController::class, 'messages']);
            Route::post('/chat/sessions/{session}/messages', [ChatController::class, 'sendMessage']);
            
            // User Preferences & Stats
            Route::get('/user/preferences', [AuthController::class, 'getPreferences']);
            Route::put('/user/preferences', [AuthController::class, 'updatePreferences']);
            Route::get('/user/stats', [UsageController::class, 'stats']);
            Route::get('/user/usage', [UsageController::class, 'index']);
        });
    });
});

Route::get('/health', function () {
    return response()->json(['status' => 'ok', 'timestamp' => now()->toIso8601String()]);
});