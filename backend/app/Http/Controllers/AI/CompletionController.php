<?php

namespace App\Http\Controllers\AI;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log; // Added for error logging
use App\Models\UsageLog;
use App\Models\RateLimit;
use Carbon\Carbon;

class CompletionController extends Controller
{
    protected $inferenceUrl;
    protected $rateLimits = [
        'free' => 30,      // 30 requests per hour
        'premium' => 100,  // 100 requests per hour
    ];
    
    public function __construct()
    {
        $this->inferenceUrl = env('INFERENCE_API_URL', 'http://localhost:8001');
    }
    
    /**
     * Check rate limit for user
     */
    protected function checkRateLimit($user)
    {
        $limit = $this->rateLimits[$user->subscription_tier] ?? 30;
        $now = Carbon::now();
        
        // Get or create rate limit record
        $rateLimit = RateLimit::where('user_id', $user->id)
            ->where('window_end', '>', $now)
            ->first();
        
        if (!$rateLimit) {
            // Create new window
            RateLimit::create([
                'user_id' => $user->id,
                'request_count' => 1,
                'window_start' => $now,
                'window_end' => $now->copy()->addHour(),
            ]);
            return ['allowed' => true, 'remaining' => $limit - 1];
        }
        
        if ($rateLimit->request_count >= $limit) {
            $retryAfter = $rateLimit->window_end->diffInSeconds($now);
            return [
                'allowed' => false,
                'remaining' => 0,
                'retry_after' => $retryAfter
            ];
        }
        
        $rateLimit->increment('request_count');
        return [
            'allowed' => true,
            'remaining' => $limit - $rateLimit->request_count
        ];
    }
    
    /**
     * Code completion endpoint
     */
    public function complete(Request $request)
    {
        // Validate input
        $validator = Validator::make($request->all(), [
            'code' => 'required|string|max:10000',
            'language' => 'required|string|max:50',
            'model' => 'nullable|string|max:100',
            'max_tokens' => 'nullable|integer|min:10|max:500',
            'temperature' => 'nullable|numeric|min:0|max:1',
            'context_files' => 'nullable|array|max:5',
            'context_files.*.path' => 'required|string',
            'context_files.*.content' => 'required|string',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        $user = $request->user();
        
        // Check rate limit
        $rateLimitCheck = $this->checkRateLimit($user);
        if (!$rateLimitCheck['allowed']) {
            return response()->json([
                'error' => 'Rate limit exceeded',
                'message' => 'You have exceeded your request quota for this hour.',
                'retry_after' => $rateLimitCheck['retry_after'],
                'remaining' => 0
            ], 429);
        }
        
        // Get user's preferred model or use provided
        $userPreferences = $user->preferences;
        $model = $request->model ?? ($userPreferences ? $userPreferences->preferred_model : 'codellama:7b');
        
        // Check cache
        $cacheKey = 'completion:' . md5($request->code . $model . $request->language);
        
        if ($cached = Cache::get($cacheKey)) {
            return response()->json([
                'completion' => $cached,
                'model' => $model,
                'cached' => true,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);
        }
        
        try {
            $startTime = microtime(true);
            
            // Call inference API
            $response = Http::timeout(60)->post($this->inferenceUrl . '/v1/completion', [
                'code' => $request->code,
                'language' => $request->language,
                'model' => $model,
                'max_tokens' => $request->max_tokens ?? 100,
                'temperature' => $request->temperature ?? 0.2,
                'context_files' => $request->context_files ?? [],
            ]);
            
            $latency = (microtime(true) - $startTime) * 1000;
            
            if (!$response->successful()) {
                throw new \Exception('Inference API returned error: ' . $response->body());
            }
            
            $result = $response->json();
            
            // Cache result for 1 hour
            Cache::put($cacheKey, $result['completion'], 3600);
            
            // Log usage
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'completion',
                'model_used' => $model,
                'tokens_output' => $result['tokens'] ?? 0,
                'latency_ms' => $latency,
                'success' => true,
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);
            
            return response()->json([
                'completion' => $result['completion'],
                'model' => $model,
                'tokens' => $result['tokens'] ?? 0,
                'cached' => false,
                'latency_ms' => round($latency, 2),
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);
            
        } catch (\Exception $e) {
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'completion',
                'model_used' => $model,
                'success' => false,
                'error_message' => $e->getMessage(),
                'ip_address' => $request->ip(),
            ]);
            
            return response()->json([
                'error' => 'Completion failed',
                'message' => 'Failed to generate code completion.',
                'details' => env('APP_DEBUG') ? $e->getMessage() : null
            ], 500);
        }
    }
    
    /**
     * Chat endpoint (Robust timeout/error handling added)
     */
    public function chat(Request $request)
    {
        // Validate input
        $validator = Validator::make($request->all(), [
            'messages' => 'required|array|min:1',
            'messages.*.role' => 'required|string|in:user,assistant,system',
            'messages.*.content' => 'required|string',
            'model' => 'nullable|string|max:100',
            'context' => 'nullable|array',
            'stream' => 'nullable|boolean',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        $user = $request->user();
        
        // Check rate limit
        $rateLimitCheck = $this->checkRateLimit($user);
        if (!$rateLimitCheck['allowed']) {
            return response()->json([
                'error' => 'Rate limit exceeded',
                'retry_after' => $rateLimitCheck['retry_after']
            ], 429);
        }
        
        // Get model
        $userPreferences = $user->preferences;
        $model = $request->model ?? ($userPreferences ? $userPreferences->preferred_model : 'codellama:7b');
        
        try {
            $startTime = microtime(true);
            
            // Call inference API with INCREASED timeout (300s) for large models
            $response = Http::timeout(300)->post($this->inferenceUrl . '/v1/chat', [
                'messages' => $request->messages,
                'model' => $model,
                'context' => $request->context ?? [],
                'stream' => $request->stream ?? false,
            ]);
            
            $latency = (microtime(true) - $startTime) * 1000;
            
            // Check for AI Server Errors specifically
            if (!$response->successful()) {
                $errorBody = $response->json();
                $errorMessage = $errorBody['detail'] ?? $response->body();
                
                throw new \Exception("AI Server Error: " . $errorMessage);
            }
            
            $result = $response->json();
            
            // Log usage
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'chat',
                'model_used' => $model,
                'tokens_input' => $result['prompt_eval_count'] ?? 0,
                'tokens_output' => $result['eval_count'] ?? 0,
                'latency_ms' => $latency,
                'success' => true,
                'ip_address' => $request->ip(),
            ]);
            
            return response()->json([
                'message' => $result['message'] ?? $result,
                'model' => $model,
                'tokens' => $result['eval_count'] ?? 0,
                'latency_ms' => round($latency, 2),
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);

        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            // Handle Timeouts specifically
             UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'chat',
                'model_used' => $model,
                'success' => false,
                'error_message' => 'Connection Timeout',
            ]);

            return response()->json([
                'error' => 'Connection Timeout',
                'message' => "The model '$model' is taking too long to load. Try a smaller model.",
                'details' => $e->getMessage()
            ], 504);
            
        } catch (\Exception $e) {
            // Log failure
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'chat',
                'model_used' => $model,
                'success' => false,
                'error_message' => $e->getMessage(),
            ]);
            
            Log::error("Chat API Failed: " . $e->getMessage());
            
            return response()->json([
                'error' => 'Chat failed',
                'message' => 'Failed to process chat request.',
                'details' => $e->getMessage() // This will now show the REAL error from python
            ], 500);
        }
    }
    
    /**
     * Code review endpoint
     */
    public function review(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code' => 'required|string|max:20000',
            'language' => 'required|string|max:50',
            'model' => 'nullable|string|max:100',
            'review_type' => 'nullable|array',
            'review_type.*' => 'string|in:security,performance,best_practices,bugs,style',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }
        
        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        
        if (!$rateLimitCheck['allowed']) {
            return response()->json(['error' => 'Rate limit exceeded', 'retry_after' => $rateLimitCheck['retry_after']], 429);
        }
        
        $userPreferences = $user->preferences;
        $model = $request->model ?? ($userPreferences ? $userPreferences->preferred_model : 'codellama:7b');
        
        $reviewTypes = $request->review_type ?? ['security', 'performance', 'best_practices'];
        $prompt = "Review the following {$request->language} code for " . implode(', ', $reviewTypes) . ":\n\n{$request->code}\n\nProvide a detailed review with specific suggestions.";
        
        try {
            $startTime = microtime(true);
            
            $response = Http::timeout(120)->post($this->inferenceUrl . '/v1/chat', [
                'messages' => [
                    ['role' => 'system', 'content' => 'You are an expert code reviewer.'],
                    ['role' => 'user', 'content' => $prompt]
                ],
                'model' => $model,
                'stream' => false,
            ]);
            
            $latency = (microtime(true) - $startTime) * 1000;
            
            if (!$response->successful()) {
                throw new \Exception('Review API failed: ' . $response->body());
            }
            
            $result = $response->json();
            
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'review',
                'model_used' => $model,
                'tokens_output' => $result['eval_count'] ?? 0,
                'latency_ms' => $latency,
                'success' => true,
            ]);
            
            return response()->json([
                'review' => $result['message']['content'] ?? 'No review generated',
                'model' => $model,
                'review_types' => $reviewTypes,
                'latency_ms' => round($latency, 2),
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);
            
        } catch (\Exception $e) {
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'review',
                'model_used' => $model,
                'success' => false,
                'error_message' => $e->getMessage(),
            ]);
            
            return response()->json(['error' => 'Review failed', 'message' => 'Failed to generate code review.', 'details' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Debug help endpoint
     */
    public function debug(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code' => 'required|string|max:20000',
            'error_message' => 'required|string|max:2000',
            'language' => 'required|string|max:50',
            'model' => 'nullable|string|max:100',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }
        
        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        
        if (!$rateLimitCheck['allowed']) {
            return response()->json(['error' => 'Rate limit exceeded', 'retry_after' => $rateLimitCheck['retry_after']], 429);
        }
        
        $userPreferences = $user->preferences;
        $model = $request->model ?? ($userPreferences ? $userPreferences->preferred_model : 'codellama:7b');
        
        $prompt = "Debug this {$request->language} code that produces the following error:\n\nError: {$request->error_message}\n\nCode:\n{$request->code}\n\nExplain the issue and provide a fix.";
        
        try {
            $response = Http::timeout(120)->post($this->inferenceUrl . '/v1/chat', [
                'messages' => [
                    ['role' => 'system', 'content' => 'You are an expert debugger.'],
                    ['role' => 'user', 'content' => $prompt]
                ],
                'model' => $model,
            ]);
            
            if (!$response->successful()) {
                throw new \Exception('Debug API failed');
            }
            
            $result = $response->json();
            
            return response()->json([
                'solution' => $result['message']['content'] ?? 'No solution generated',
                'model' => $model,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);
            
        } catch (\Exception $e) {
            return response()->json(['error' => 'Debug failed', 'message' => 'Failed to generate debug solution.', 'details' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Code explanation endpoint
     */
    public function explain(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code' => 'required|string|max:20000',
            'language' => 'required|string|max:50',
            'model' => 'nullable|string|max:100',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }
        
        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        
        if (!$rateLimitCheck['allowed']) {
            return response()->json(['error' => 'Rate limit exceeded', 'retry_after' => $rateLimitCheck['retry_after']], 429);
        }
        
        $userPreferences = $user->preferences;
        $model = $request->model ?? ($userPreferences ? $userPreferences->preferred_model : 'codellama:7b');
        
        $prompt = "Explain this {$request->language} code in detail:\n\n{$request->code}";
        
        try {
            $response = Http::timeout(120)->post($this->inferenceUrl . '/v1/chat', [
                'messages' => [
                    ['role' => 'system', 'content' => 'You are a helpful programming teacher.'],
                    ['role' => 'user', 'content' => $prompt]
                ],
                'model' => $model,
            ]);
            
            if (!$response->successful()) {
                throw new \Exception('Explain API failed');
            }
            
            $result = $response->json();
            
            return response()->json([
                'explanation' => $result['message']['content'] ?? 'No explanation generated',
                'model' => $model,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);
            
        } catch (\Exception $e) {
            return response()->json(['error' => 'Explanation failed', 'message' => 'Failed to generate code explanation.', 'details' => $e->getMessage()], 500);
        }
    }
}