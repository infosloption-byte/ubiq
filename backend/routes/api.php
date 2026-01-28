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

Route::prefix('v1')->group(function () {
    // Public routes - Authentication
    Route::post('/auth/register', [AuthController::class, 'register']);
    Route::post('/auth/login', [AuthController::class, 'login']);
    
    // Protected routes - Require authentication
    Route::middleware('auth:sanctum')->group(function () {
        // Authentication
        Route::post('/auth/logout', [AuthController::class, 'logout']);
        Route::get('/auth/user', [AuthController::class, 'user']);
        
        // Projects - Full CRUD
        Route::apiResource('projects', ProjectController::class);
        Route::post('/projects/{project}/restore', [ProjectController::class, 'restore']);
        
        // Files - Nested under projects
        Route::apiResource('projects.files', FileController::class)
            ->shallow(); // Allows /files/{file} for show, update, destroy
        
        // Chat/Messages
        Route::get('/projects/{project}/messages', [ChatController::class, 'index']);
        Route::post('/projects/{project}/messages', [ChatController::class, 'store']);
        Route::delete('/messages/{message}', [ChatController::class, 'destroy']);
        
        // AI Completion Features
        Route::post('/ai/complete', [CompletionController::class, 'complete']);
        Route::post('/ai/review', [CompletionController::class, 'review']);
        Route::post('/ai/debug', [CompletionController::class, 'debug']);
        Route::post('/ai/explain', [CompletionController::class, 'explain']);
        
        // Models Management
        Route::get('/models', [ModelController::class, 'index']);
        Route::get('/models/current', [ModelController::class, 'current']);
        Route::post('/models/{model}/select', [ModelController::class, 'select']);
        
        // Usage Statistics
        Route::get('/usage', [UsageController::class, 'index']);
        Route::get('/usage/stats', [UsageController::class, 'stats']);
    });
});

// Health check endpoint (optional, for monitoring)
Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'timestamp' => now()->toIso8601String(),
    ]);
});