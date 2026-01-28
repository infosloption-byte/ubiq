<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\FileController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\AI\CompletionController;
use App\Http\Controllers\AI\ModelController;
use App\Http\Controllers\UserController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

// Public routes
Route::prefix('v1')->group(function () {
    
    // Authentication routes (public)
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    
    // Health check
    Route::get('/health', function () {
        return response()->json([
            'status' => 'ok',
            'timestamp' => now(),
            'service' => 'AI Coding Platform API',
            'version' => '1.0.0'
        ]);
    });
    
    // Protected routes (require authentication)
    Route::middleware('auth:sanctum')->group(function () {
        
        // ============================================================
        // AUTHENTICATION
        // ============================================================
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::post('/auth/refresh', [AuthController::class, 'refresh']);
        Route::get('/auth/me', [AuthController::class, 'me']);
        
        // ============================================================
        // USER MANAGEMENT
        // ============================================================
        Route::prefix('user')->group(function () {
            Route::get('/profile', [UserController::class, 'profile']);
            Route::put('/profile', [UserController::class, 'updateProfile']);
            Route::get('/preferences', [UserController::class, 'preferences']);
            Route::put('/preferences', [UserController::class, 'updatePreferences']);
            Route::get('/usage', [UserController::class, 'usage']);
            Route::get('/stats', [UserController::class, 'stats']);
        });
        
        // ============================================================
        // PROJECTS
        // ============================================================
        Route::apiResource('projects', ProjectController::class);
        Route::post('/projects/{project}/archive', [ProjectController::class, 'archive']);
        Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
        
        // ============================================================
        // FILES
        // ============================================================
        Route::prefix('projects/{project}')->group(function () {
            Route::get('/files', [FileController::class, 'index']);
            Route::post('/files', [FileController::class, 'store']);
        });
        
        Route::prefix('files')->group(function () {
            Route::get('/{file}', [FileController::class, 'show']);
            Route::put('/{file}', [FileController::class, 'update']);
            Route::delete('/{file}', [FileController::class, 'destroy']);
            Route::post('/{file}/restore', [FileController::class, 'restore']);
        });
        
        // ============================================================
        // CHAT
        // ============================================================
        Route::prefix('chat')->group(function () {
            Route::get('/sessions', [ChatController::class, 'index']);
            Route::post('/sessions', [ChatController::class, 'store']);
            Route::get('/sessions/{session}', [ChatController::class, 'show']);
            Route::put('/sessions/{session}', [ChatController::class, 'update']);
            Route::delete('/sessions/{session}', [ChatController::class, 'destroy']);
            
            // Messages
            Route::get('/sessions/{session}/messages', [ChatController::class, 'messages']);
            Route::post('/sessions/{session}/messages', [ChatController::class, 'sendMessage']);
            
            // Archive
            Route::post('/sessions/{session}/archive', [ChatController::class, 'archive']);
            Route::post('/sessions/{session}/restore', [ChatController::class, 'restore']);
        });
        
        // ============================================================
        // AI FEATURES
        // ============================================================
        Route::prefix('ai')->group(function () {
            // Code completion
            Route::post('/completion', [CompletionController::class, 'complete']);
            
            // Chat
            Route::post('/chat', [CompletionController::class, 'chat']);
            
            // Code review
            Route::post('/review', [CompletionController::class, 'review']);
            
            // Debugging help
            Route::post('/debug', [CompletionController::class, 'debug']);
            
            // Code explanation
            Route::post('/explain', [CompletionController::class, 'explain']);
            
            // Available models
            Route::get('/models', [ModelController::class, 'index']);
            Route::get('/models/{model}', [ModelController::class, 'show']);
        });
        
    });
    
});

// Catch-all route for undefined API endpoints
Route::fallback(function () {
    return response()->json([
        'error' => 'Endpoint not found',
        'message' => 'The requested API endpoint does not exist.'
    ], 404);
});