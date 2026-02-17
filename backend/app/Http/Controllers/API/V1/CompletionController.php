<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use App\Models\Project;
use App\Models\UsageLog;
use App\Models\RateLimit;
use Carbon\Carbon;

class CompletionController extends Controller
{
    // Define rate limits per tier
    protected $rateLimits = [
        'free' => 30,      // 30 requests per hour
        'premium' => 100,  // 100 requests per hour
    ];
    
    /**
     * Helper: Map model ID to API Endpoint & Key
     */
    private function getProviderConfig($modelId, $apiKeys)
    {
        // 1. GOOGLE GEMINI (Native API)
        if (str_contains($modelId, 'gemini')) {
            $key = isset($apiKeys['google']) ? trim($apiKeys['google']) : null;
            if (!$key) return null;
            $cleanModel = str_replace('models/', '', $modelId);
            return [
                'provider' => 'gemini',
                'url' => "https://generativelanguage.googleapis.com/v1beta/models/{$cleanModel}:generateContent?key={$key}",
                'headers' => ['Content-Type' => 'application/json'],
                'model_name' => $cleanModel
            ];
        }

        // 2. OPENAI
        if (str_starts_with($modelId, 'gpt-')) {
            $key = isset($apiKeys['openai']) ? trim($apiKeys['openai']) : null;
            if (!$key) return null;
            return [
                'provider' => 'openai',
                'url' => 'https://api.openai.com/v1/chat/completions',
                'headers' => ['Authorization' => "Bearer $key"],
                'model_name' => $modelId
            ];
        }

        // 3. OPENROUTER
        if (str_starts_with($modelId, 'openrouter/')) {
            $key = isset($apiKeys['openrouter']) ? trim($apiKeys['openrouter']) : null;
            if (!$key) return null;
            return [
                'provider' => 'openrouter',
                'url' => 'https://openrouter.ai/api/v1/chat/completions',
                'headers' => [
                    'Authorization' => "Bearer $key",
                    'HTTP-Referer' => config('app.url'),
                    'X-Title' => 'Ubiq Editor'
                ],
                'model_name' => str_replace('openrouter/', '', $modelId)
            ];
        }

        // 4. MISTRAL
        if (str_contains($modelId, 'mistral') || str_contains($modelId, 'codestral')) {
            $key = isset($apiKeys['mistral']) ? trim($apiKeys['mistral']) : null;
            if (!$key) return null;
            return [
                'provider' => 'mistral',
                'url' => 'https://api.mistral.ai/v1/chat/completions',
                'headers' => ['Authorization' => "Bearer $key"],
                'model_name' => $modelId
            ];
        }

        // 5. OLLAMA (Local vs Remote)
        // If 'ollama_url' is provided, we treat it as Remote.
        // If NOT provided, we default to 'http://host.docker.internal:11434' (Local).
        
        $baseUrl = 'http://host.docker.internal:11434'; // Default Local
        
        if (isset($apiKeys['ollama_url']) && filter_var($apiKeys['ollama_url'], FILTER_VALIDATE_URL)) {
            $baseUrl = rtrim($apiKeys['ollama_url'], '/');
        }

        return [
            'provider' => 'ollama',
            'url' => "{$baseUrl}/api/chat",
            'headers' => [],
            'model_name' => $modelId,
            'is_local' => true
        ];
    }

    protected function checkRateLimit($user)
    {
        $limit = $this->rateLimits[$user->subscription_tier ?? 'free'] ?? 30;
        $now = Carbon::now();
        $rateLimit = RateLimit::where('user_id', $user->id)->where('window_end', '>', $now)->first();
        
        if (!$rateLimit) {
            RateLimit::create(['user_id' => $user->id, 'request_count' => 1, 'window_start' => $now, 'window_end' => $now->copy()->addHour()]);
            return ['allowed' => true, 'remaining' => $limit - 1];
        }
        if ($rateLimit->request_count >= $limit) return ['allowed' => false, 'remaining' => 0, 'retry_after' => $rateLimit->window_end->diffInSeconds($now)];
        
        $rateLimit->increment('request_count');
        return ['allowed' => true, 'remaining' => $limit - $rateLimit->request_count];
    }

    /**
     * GENERATE PROJECT (Used by AI Architect)
     */
    public function generate(Request $request)
    {
        $request->validate([
            'project_id' => 'required|exists:projects,id',
            'prompt' => 'required|string|max:5000',
            'model' => 'required|string',
            'api_keys' => 'nullable|array'
        ]);

        $project = Project::find($request->project_id);
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $rateLimitCheck = $this->checkRateLimit($request->user());
        if (!$rateLimitCheck['allowed']) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        }

        $model = $request->model;
        $apiKeys = $request->input('api_keys', []);
        $config = $this->getProviderConfig($model, $apiKeys);

        if (!$config) {
            return response()->json(['error' => "Configuration failed for model: {$model}. Please check your API keys."], 400);
        }

        // --- TRULY DYNAMIC POLYGLOT SYSTEM PROMPT ---
        $systemPrompt = "You are an Expert Full Stack Architect.
        TASK: Generate a complete, production-ready web application workspace.
        
        TECHNOLOGY STACK SELECTION:
        - If the user specifies a framework or language (e.g., Angular, Laravel, React, Vue, Express, Django, CodeIgniter), you MUST strictly use that technology stack.
        - If the user does not specify a stack, you MUST analyze their requirements and independently choose the OPTIMUM modern stack (e.g., Vite+React+Node) for their specific use case.
        
        CRITICAL RULES:
        1. Return ONLY valid JSON where keys are file paths and values are code: {\"filename.ext\": \"content\"}. No markdown blocks outside the JSON.
        2. You MUST include a 'ubiq.json' file to configure the server. It MUST contain:
           - \"title\": A short, catchy name for this project based on the prompt.
           - \"runtime\": You MUST map your chosen stack to EXACTLY ONE of these sandbox environments:
                -> \"static\": For pure Vanilla HTML/CSS/JS without build steps.
                -> \"node\": For ANY JavaScript/TypeScript framework (React, Angular, Vue, Next.js, Express, Svelte, etc.).
                -> \"php\": For ANY PHP framework or pure PHP (Laravel, CodeIgniter, Symfony, etc.).
                -> \"python\": For ANY Python framework (Django, Flask, FastAPI, etc.).
           - \"entry\": The primary file to execute or serve.

        3. FRAMEWORK STANDARDS (STRICT):
           - React/Vue/Vite: You MUST place 'index.html' in the ROOT directory. Do NOT put it in 'public/'. The 'public/' folder is only for static assets like images.
           - Laravel: Follow standard Laravel structure (index.php in public/).
           - Next.js: Use the 'app/' directory router structure.
        
        4. DEPENDENCY ENFORCEMENT & PORT STANDARDIZATION:
           - If runtime is \"node\", you MUST generate a valid 'package.json' with a \"dev\" script. 
           - CRITICAL: You MUST configure the \"dev\" script to run on port 5173 and bind to 0.0.0.0. 
             (Examples: \"vite --port 5173 --host 0.0.0.0\", \"next dev -p 5173 -H 0.0.0.0\", \"ng serve --port 5173 --host 0.0.0.0\").
           - If runtime is \"php\", generate 'composer.json'. CRITICAL: If building Laravel, you MUST include the 'artisan' , 'public/index.php', AND 'bootstrap/app.php'.
           - If runtime is \"python\", generate a 'requirements.txt'.
          
        5. Provide ALL necessary code to make the app actually run. Do not leave placeholders.";
        
        $userPrompt = "Create this app: " . $request->prompt;

        // ---------------------------------------------------------
        // BROAD LOCAL MODEL REINFORCEMENT:
        // We use broad keyword matching to catch families of frameworks.
        // ---------------------------------------------------------
        $isNode = preg_match('/react|vue|angular|svelte|next|nuxt|node|express|nest/i', $request->prompt);
        $isPhp = preg_match('/php|laravel|symfony|codeigniter|yii/i', $request->prompt);
        $isPython = preg_match('/python|django|flask|fastapi/i', $request->prompt);

        if ($isNode) {
            $userPrompt .= "\n\nCRITICAL ENFORCEMENT: You MUST use '\"runtime\": \"node\"' and generate a full 'package.json' with dependencies. Do NOT output a static HTML fallback.";
        } elseif ($isPhp) {
            $userPrompt .= "\n\nCRITICAL ENFORCEMENT: You MUST use '\"runtime\": \"php\"' and generate the correct PHP framework structure (including composer.json if applicable). Do NOT output a static HTML fallback.";
        } elseif ($isPython) {
            $userPrompt .= "\n\nCRITICAL ENFORCEMENT: You MUST use '\"runtime\": \"python\"' and generate a 'requirements.txt'. Do NOT output a static HTML fallback.";
        } else {
            $userPrompt .= "\n\nCRITICAL ENFORCEMENT: Choose the best tech stack. If your chosen stack requires a server or build step (Node/PHP/Python), you MUST set the correct 'runtime' in ubiq.json and generate the required dependency files (package.json, composer.json, etc.). Do NOT default to static HTML unless it is a very simple request.";
        }

        try {
            $payload = [];

            // --- PAYLOAD CONSTRUCTION ---
            if ($config['provider'] === 'gemini') {
                // FIX: Use the official systemInstruction field for Gemini so it Obeys!
                $payload = [
                    'systemInstruction' => [
                        'parts' => [['text' => $systemPrompt]]
                    ],
                    'contents' => [
                        ['role' => 'user', 'parts' => [['text' => $userPrompt]]]
                    ]
                ];
            } 
            elseif ($config['provider'] === 'ollama') {
                // ADDED: Options array to force longer outputs and stricter rules
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user', 'content' => $userPrompt]
                    ],
                    'stream' => false,
                    'options' => [
                        'num_predict' => 8000, // Force Ollama to allow long multi-file outputs
                        'temperature' => 0.1   // Lower temp makes it obey strict rules better
                    ]
                ];
            } 
            else {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user', 'content' => $userPrompt]
                    ],
                    'temperature' => 0.2,
                    'max_tokens' => 8000, // Boosted for larger React projects
                    'stream' => false
                ];
            }

            // --- EXECUTE REQUEST ---
            if (!$response->successful()) {
                throw new \Exception("Provider Error ({$response->status()}): " . substr($response->body(), 0, 200));
            }

            if (!$response->successful()) throw new \Exception($response->body());

            // --- PARSE RESPONSE ---
            $data = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
            } else {
                $content = $data['choices'][0]['message']['content'] ?? $data['message']['content'] ?? '';
            }
            
            // Cleanup & Extraction
            $content = preg_replace('/^```json/', '', $content);
            $content = preg_replace('/```$/', '', $content);
            
            if (strpos($content, '{') !== 0) {
                preg_match('/\{[\s\S]*\}/', $content, $matches);
                if (!empty($matches[0])) $content = $matches[0];
            }

            $files = json_decode($content, true);

            if (json_last_error() !== JSON_ERROR_NONE || empty($files)) {
                throw new \Exception("AI response was not valid JSON. Response: " . substr($content, 0, 100) . "...");
            }

            // Save Files
            $savedCount = 0;
            foreach ($files as $path => $code) {
                $project->files()->updateOrCreate(
                    ['path' => $path],
                    ['name' => basename($path), 'content' => $code, 'language' => $this->detectLanguage($path), 'is_deleted' => false]
                );
                
                $fullPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}/{$path}");
                if (!file_exists(dirname($fullPath))) mkdir(dirname($fullPath), 0755, true);
                file_put_contents($fullPath, $code);
                
                $savedCount++;
            }

            return response()->json(['message' => "Generated $savedCount files", 'model_used' => $model]);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Generation failed: ' . $e->getMessage()], 500);
        }
    }

    private function detectLanguage($filename) {
        $ext = pathinfo($filename, PATHINFO_EXTENSION);
        return match($ext) {
            'js', 'jsx' => 'javascript',
            'ts', 'tsx' => 'typescript',
            'html' => 'html',
            'css' => 'css',
            'json' => 'json',
            'php' => 'php',
            'py' => 'python',
            default => 'plaintext'
        };
    }

    /**
     * Code completion endpoint
     */
    public function complete(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code' => 'required|string|max:10000',
            'language' => 'required|string|max:50',
            'model' => 'nullable|string|max:100',
            'api_keys' => 'nullable|array'
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }
        
        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        if (!$rateLimitCheck['allowed']) {
            return response()->json(['error' => 'Rate limit exceeded', 'retry_after' => $rateLimitCheck['retry_after']], 429);
        }
        
        $model = $request->model ?? ($user->preferences->preferred_model ?? 'codellama:7b');
        $apiKeys = $request->input('api_keys', []);
        $config = $this->getProviderConfig($model, $apiKeys);

        if (!$config) return response()->json(['error' => 'Missing API Key for selected model'], 400);
        
        $prompt = "You are an expert code completion engine. Output ONLY the code to complete the following {$request->language} snippet. Do not use Markdown blocks. Context:\n\n" . $request->code;

        try {
            $startTime = microtime(true);
            $payload = [];

            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]]];
            } else {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are a code completion tool. Output only raw code.'],
                        ['role' => 'user', 'content' => $prompt]
                    ],
                    'max_tokens' => 100,
                    'temperature' => 0.2,
                    'stream' => false
                ];
            }
            
            $response = Http::withHeaders($config['headers'])->timeout(30)->post($config['url'], $payload);
            
            if (!$response->successful()) throw new \Exception('Provider Error: ' . $response->body());
            
            $result = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $result['candidates'][0]['content']['parts'][0]['text'] ?? '';
            } else {
                $content = $result['choices'][0]['message']['content'] ?? '';
            }
            
            $latency = (microtime(true) - $startTime) * 1000;
            
            UsageLog::create([
                'user_id' => $user->id,
                'request_type' => 'completion',
                'model_used' => $model,
                'latency_ms' => $latency,
                'success' => true,
                'ip_address' => $request->ip(),
            ]);
            
            return response()->json([
                'completion' => $content,
                'model' => $model,
                'cached' => false,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);
            
        } catch (\Exception $e) {
            return response()->json(['error' => 'Completion failed', 'details' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Chat endpoint (Universal)
     */
    public function chat(Request $request)
    {
        $request->validate([
            'messages' => 'required|array',
            'model' => 'nullable|string',
            'api_keys' => 'nullable|array'
        ]);
        
        $user = $request->user();
        $model = $request->model ?? 'gpt-3.5-turbo';
        $apiKeys = $request->input('api_keys', []);

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) {
            return response()->json(['error' => 'Missing API Key'], 400);
        }

        try {
            $payload = [];

            // A. GEMINI (Specific Structuring)
            if ($config['provider'] === 'gemini') {
                $geminiMessages = [];
                $systemInstruction = null;

                // Loop through messages to segregate System vs User/Model
                foreach ($request->messages as $msg) {
                    if ($msg['role'] === 'system') {
                        $systemInstruction = ['parts' => [['text' => $msg['content']]]];
                    } else {
                        // Map 'assistant' -> 'model'
                        $role = ($msg['role'] === 'assistant') ? 'model' : 'user';
                        $geminiMessages[] = [
                            'role' => $role,
                            'parts' => [['text' => $msg['content']]]
                        ];
                    }
                }

                $payload = ['contents' => $geminiMessages];
                if ($systemInstruction) {
                    $payload['systemInstruction'] = $systemInstruction;
                }
            } 
            // B. OLLAMA
            elseif ($config['provider'] === 'ollama') {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => $request->messages,
                    'stream' => false,
                ];
            } 
            // C. STANDARD (OpenAI)
            else {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => $request->messages,
                    'stream' => false, 
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])
                ->timeout(120)
                ->post($config['url'], $payload);

            if (!$response->successful()) {
                throw new \Exception('AI Provider Error: ' . $response->body());
            }

            $data = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
            } else {
                $content = $data['choices'][0]['message']['content'] ?? $data['message']['content'] ?? '';
            }

            return response()->json([
                'message' => ['role' => 'assistant', 'content' => $content],
                'model' => $model
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Code Review
     */
    public function review(Request $request)
    {
        $request->validate([
            'code' => 'required|string',
            'language' => 'required|string',
            'model' => 'nullable|string',
            'review_type' => 'nullable|array',
            'api_keys' => 'nullable|array'
        ]);

        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        if (!$rateLimitCheck['allowed']) {
            return response()->json(['error' => 'Rate limit exceeded'], 429);
        }

        $model = $request->model ?? 'gpt-4o';
        $apiKeys = $request->input('api_keys', []);
        
        $reviewTypes = $request->review_type ?? ['security', 'performance', 'best_practices'];
        $prompt = "Review the following {$request->language} code for " . implode(', ', $reviewTypes) . ":\n\n{$request->code}\n\nProvide a detailed review with specific suggestions.";

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) return response()->json(['error' => 'Missing API Key'], 400);

        try {
            $payload = [];
            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => "You are an expert code reviewer.\n" . $prompt]]]]];
            } else {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are an expert code reviewer.'],
                        ['role' => 'user', 'content' => $prompt]
                    ],
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);

            if (!$response->successful()) throw new \Exception($response->body());

            $result = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $result['candidates'][0]['content']['parts'][0]['text'] ?? 'No review generated';
            } else {
                $content = $result['choices'][0]['message']['content'] ?? 'No review generated';
            }

            return response()->json([
                'review' => $content,
                'model' => $model,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Review failed', 'details' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Debug Code
     */
    public function debug(Request $request)
    {
        $request->validate([
            'code' => 'required|string',
            'error_message' => 'required|string',
            'language' => 'required|string',
            'model' => 'nullable|string',
            'api_keys' => 'nullable|array'
        ]);

        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        if (!$rateLimitCheck['allowed']) return response()->json(['error' => 'Rate limit exceeded'], 429);

        $model = $request->model ?? 'gpt-4o';
        $apiKeys = $request->input('api_keys', []);
        
        $prompt = "Debug this {$request->language} code that produces the following error:\n\nError: {$request->error_message}\n\nCode:\n{$request->code}\n\nExplain the issue and provide a fix.";

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) return response()->json(['error' => 'Missing API Key'], 400);

        try {
            $payload = [];
            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => "You are an expert debugger.\n" . $prompt]]]]];
            } else {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are an expert debugger.'],
                        ['role' => 'user', 'content' => $prompt]
                    ],
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);

            if (!$response->successful()) throw new \Exception($response->body());

            $result = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $result['candidates'][0]['content']['parts'][0]['text'] ?? 'No solution found';
            } else {
                $content = $result['choices'][0]['message']['content'] ?? 'No solution found';
            }

            return response()->json([
                'solution' => $content,
                'model' => $model,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Debug failed', 'details' => $e->getMessage()], 500);
        }
    }
    
    /**
     * Explain Code
     */
    public function explain(Request $request)
    {
        $request->validate([
            'code' => 'required|string',
            'language' => 'required|string',
            'model' => 'nullable|string',
            'api_keys' => 'nullable|array'
        ]);

        $user = $request->user();
        $rateLimitCheck = $this->checkRateLimit($user);
        if (!$rateLimitCheck['allowed']) return response()->json(['error' => 'Rate limit exceeded'], 429);

        $model = $request->model ?? 'gpt-4o';
        $apiKeys = $request->input('api_keys', []);
        
        $prompt = "Explain this {$request->language} code in detail:\n\n{$request->code}";

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) return response()->json(['error' => 'Missing API Key'], 400);

        try {
            $payload = [];
            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => "You are a helpful programming teacher.\n" . $prompt]]]]];
            } else {
                $payload = [
                    'model' => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are a helpful programming teacher.'],
                        ['role' => 'user', 'content' => $prompt]
                    ],
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);

            if (!$response->successful()) throw new \Exception($response->body());

            $result = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $result['candidates'][0]['content']['parts'][0]['text'] ?? 'No explanation found';
            } else {
                $content = $result['choices'][0]['message']['content'] ?? 'No explanation found';
            }

            return response()->json([
                'explanation' => $content,
                'model' => $model,
                'remaining_requests' => $rateLimitCheck['remaining']
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Explanation failed', 'details' => $e->getMessage()], 500);
        }
    }
}