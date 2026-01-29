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

Route::prefix('v1')->group(function () {
    // Public routes
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    
    // Protected routes
    Route::middleware('auth:sanctum')->group(function () {
        // Authentication
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/user', [AuthController::class, 'user']); // Frontend calls /auth/me, mapped to this or update frontend
        Route::get('/auth/me', [AuthController::class, 'user']);   // Added alias for frontend
        
        // Projects
        Route::apiResource('projects', ProjectController::class);
        Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
        Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
        
        // Files
        Route::apiResource('projects.files', FileController::class)->shallow();
        
        // Chat Sessions (New Structure)
        Route::get('/chat/sessions', [ChatController::class, 'index']);
        Route::post('/chat/sessions', [ChatController::class, 'store']);
        Route::get('/chat/sessions/{session}', [ChatController::class, 'show']);
        Route::delete('/chat/sessions/{session}', [ChatController::class, 'destroy']);
        
        // Chat Messages
        Route::get('/chat/sessions/{session}/messages', [ChatController::class, 'messages']);
        Route::post('/chat/sessions/{session}/messages', [ChatController::class, 'sendMessage']);
        
        // AI Features (Aligned with Frontend)
        Route::post('/ai/completion', [CompletionController::class, 'complete']);
        Route::post('/ai/chat', [CompletionController::class, 'chat']);
        Route::post('/ai/review', [CompletionController::class, 'review']);
        Route::post('/ai/debug', [CompletionController::class, 'debug']);
        Route::post('/ai/explain', [CompletionController::class, 'explain']);
        
        // Models
        Route::get('/ai/models', [ModelController::class, 'index']);
        
        // User & Stats
        Route::get('/user/preferences', [AuthController::class, 'getPreferences']); // Ensure AuthController has this or create UserController
        Route::put('/user/preferences', [AuthController::class, 'updatePreferences']);
        Route::get('/user/stats', [UsageController::class, 'stats']);
        Route::get('/user/usage', [UsageController::class, 'index']);
    });
});

Route::get('/health', function () {
    return response()->json(['status' => 'ok', 'timestamp' => now()->toIso8601String()]);
});