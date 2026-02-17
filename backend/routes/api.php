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

// FIX: Define a named 'login' route that returns JSON 401
// This prevents the "Route [login] not defined" error when auth fails
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

    Route::get('projects/{project}/preview/{token}/{path}', [App\Http\Controllers\API\V1\FileController::class, 'preview'])
    ->where('path', '.*');
    
    // Protected routes

    Route::middleware(['auth:sanctum', 'admin'])->prefix('admin')->group(function () {
        Route::get('/stats', [AdminController::class, 'stats']);
        Route::get('/users', [AdminController::class, 'getUsers']);
        Route::delete('/users/{id}', [AdminController::class, 'deleteUser']);
    });

    Route::middleware('auth:sanctum')->group(function () {
        // Authentication
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/user', [AuthController::class, 'user']);
        Route::get('/auth/me', [AuthController::class, 'me']);    // Alias
        
        // Projects
        Route::apiResource('projects', ProjectController::class);
        Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
        Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
        
        // Files
        Route::apiResource('projects.files', FileController::class)->shallow();
        
        Route::delete('projects/{project}/files/path', [App\Http\Controllers\API\V1\FileController::class, 'destroyPath']);
        Route::post('projects/import', [ProjectController::class, 'import']);
        Route::post('projects/{project}/files/upload', [App\Http\Controllers\API\V1\FileController::class, 'upload']);
        Route::get('projects/{project}/download', [App\Http\Controllers\API\V1\ProjectController::class, 'download']);
        Route::get('projects/{project}/files/{file}/serve', [App\Http\Controllers\API\V1\FileController::class, 'serve']);
        Route::post('projects/{project}/run', [App\Http\Controllers\API\V1\ProjectController::class, 'runProject']);
        Route::post('projects/{project}/terminal', [App\Http\Controllers\API\V1\TerminalController::class, 'execute']);
        Route::get('projects/{project}/build-log', [App\Http\Controllers\API\V1\ProjectController::class, 'getBuildLog']);

        //Project Git 
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


        // Add this new route for AI Generation
        Route::post('ai/generate', [App\Http\Controllers\API\V1\CompletionController::class, 'generate']);
        Route::post('projects/{project}/scaffold', [ProjectController::class, 'scaffold']);
        Route::post('projects/{project}/seed-chat', [ProjectController::class, 'seedChat']);
        Route::post('chat/message', [App\Http\Controllers\API\V1\CompletionController::class, 'chat']);

        Route::prefix('projects/{project}/git')->group(function () {
            Route::get('/status', [GitController::class, 'status']);
            Route::post('/create-pr', [GitController::class, 'createPr']); // <--- THIS WAS MISSING
        });
        
        // Chat Sessions
        Route::get('/chat/sessions', [ChatController::class, 'index']);
        Route::post('/chat/sessions', [ChatController::class, 'store']);
        Route::get('/chat/sessions/{session}', [ChatController::class, 'show']);
        Route::delete('/chat/sessions/{session}', [ChatController::class, 'destroy']);
        Route::post('/chat/sessions/{session}/title', [ChatController::class, 'generateTitle']);
        // NEW: Manual Update route (for inline editing)
        Route::patch('/chat/sessions/{session}', [ChatController::class, 'update']);

        Route::post('/chat/sessions/{session}/upload', [ChatController::class, 'uploadAttachment']);
        
        // Chat Messages
        Route::get('/chat/sessions/{session}/messages', [ChatController::class, 'messages']);
        Route::post('/chat/sessions/{session}/messages', [ChatController::class, 'sendMessage']);
        
        // AI Features
        Route::post('/ai/completion', [CompletionController::class, 'complete']);
        Route::post('/ai/chat', [CompletionController::class, 'chat']);
        Route::post('/ai/review', [CompletionController::class, 'review']);
        Route::post('/ai/debug', [CompletionController::class, 'debug']);
        Route::post('/ai/explain', [CompletionController::class, 'explain']);
        
        // Models
        // Route::get('/ai/models', [ModelController::class, 'index']);
        Route::get('/ai/models', [AiController::class, 'getModels']);
        
        // User & Stats
        Route::get('/user/preferences', [AuthController::class, 'getPreferences']);
        Route::put('/user/preferences', [AuthController::class, 'updatePreferences']);
        Route::get('/user/stats', [UsageController::class, 'stats']);
        Route::get('/user/usage', [UsageController::class, 'index']);
    });
});

Route::get('/health', function () {
    return response()->json(['status' => 'ok', 'timestamp' => now()->toIso8601String()]);
});