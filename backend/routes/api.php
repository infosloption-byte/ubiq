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
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    
    // Protected routes
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

        // Delete files by path (Folder Deletion)
        Route::delete('projects/{project}/files/path', [App\Http\Controllers\API\V1\FileController::class, 'destroyPath']);
        
        // Chat Sessions
        Route::get('/chat/sessions', [ChatController::class, 'index']);
        Route::post('/chat/sessions', [ChatController::class, 'store']);
        Route::get('/chat/sessions/{session}', [ChatController::class, 'show']);
        Route::delete('/chat/sessions/{session}', [ChatController::class, 'destroy']);
        Route::post('/chat/sessions/{session}/title', [ChatController::class, 'generateTitle']);
        // NEW: Manual Update route (for inline editing)
        Route::patch('/chat/sessions/{session}', [ChatController::class, 'update']);
        
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
        Route::get('/ai/models', [ModelController::class, 'index']);
        
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