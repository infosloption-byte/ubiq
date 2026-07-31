<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Log;
use App\Models\Project;
use App\Models\UsageLog;
use App\Models\AvailableModel;
use App\Services\PlanGuard;
use App\Exceptions\PlanLimitExceededException;
use Carbon\Carbon;

class CompletionController extends Controller
{
    public function __construct(private PlanGuard $planGuard)
    {
    }

    /**
     * Guards every AI-calling endpoint below through PlanGuard's 'ai.request'
     * action (hourly + daily limits read live from plan_features — see
     * PLAN_SYSTEM_TASKS.md Phase B3a). Replaces the old hardcoded
     * $rateLimits array + RateLimit model, which had already caused one
     * production bug (subscription_tier key mismatch after the
     * Paddle→PayPal migration — pro users silently fell through to the
     * free limit). Centralizing here means that class of bug can't recur:
     * there's exactly one place limits are read from, and it's the
     * database, not a hardcoded array in this file.
     *
     * @throws never — denials are converted to a 429 response, not thrown
     *         out of this helper, so every call site stays a simple
     *         try/catch around the one authorize() call.
     */
    private function guardAiRequest($user): ?\Illuminate\Http\JsonResponse
    {
        try {
            $this->planGuard->authorize($user, 'ai.request');
            return null;
        } catch (PlanLimitExceededException $e) {
            return $this->planLimitResponse($e);
        }
    }

    private function planLimitResponse(PlanLimitExceededException $e): \Illuminate\Http\JsonResponse
    {
        $retryAfter = match ($e->reason) {
            'hourly_limit_exceeded' => (int) Carbon::now()->diffInSeconds(Carbon::now()->copy()->addHour()->startOfHour()),
            'daily_limit_exceeded' => (int) Carbon::now()->diffInSeconds(Carbon::now()->copy()->addDay()->startOfDay()),
            default => null,
        };

        return response()->json([
            'error' => 'Rate limit exceeded',
            'reason' => $e->reason,
            'limit' => $e->limitValue,
            'usage' => $e->currentUsage,
            'retry_after' => $retryAfter,
        ], 429);
    }

    private function remainingAiRequests($user): ?int
    {
        return $this->planGuard->remaining($user, 'ai.request')['hour_remaining'] ?? null;
    }

    /**
     * B3d — Looks up the requested model's required tier: exact catalog
     * match first (available_models.tier_required), falling back to the
     * SAME provider-family pattern-matching getProviderConfig() already
     * uses below, so an unlisted model still resolves to a sensible tier
     * instead of silently bypassing gating. Unmatched/unknown model
     * strings default to 'pro' — the conservative choice, since an unknown
     * string could otherwise be used to dodge the catalog entirely.
     */
    private function resolveModelTier(string $modelId): string
    {
        $catalogTier = AvailableModel::query()
            ->where('name', $modelId)
            ->where('is_active', true)
            ->value('tier_required');

        if ($catalogTier !== null) {
            return $catalogTier;
        }

        return match (true) {
            str_contains($modelId, 'gemini')                      => 'creator',
            str_starts_with($modelId, 'gpt-')                     => 'pro',
            str_starts_with($modelId, 'openrouter/')               => 'creator',
            str_contains($modelId, 'mistral') || str_contains($modelId, 'codestral') => 'starter',
            str_starts_with($modelId, 'ollama/') || !str_contains($modelId, '/') => 'free', // bare model names default to the Ollama family
            default => 'pro',
        };
    }

    /**
     * Returns a 403 JsonResponse if denied, null if allowed — same calling
     * convention as guardAiRequest() so call sites stay a simple
     * `if ($r = $this->guardModelAccess(...)) return $r;` one-liner.
     */
    private function guardModelAccess($user, string $modelId): ?\Illuminate\Http\JsonResponse
    {
        try {
            $this->planGuard->authorize($user, 'model.access', ['model_tier' => $this->resolveModelTier($modelId)]);
            return null;
        } catch (PlanLimitExceededException $e) {
            return response()->json([
                'error' => 'This model requires a higher plan tier.',
                'reason' => $e->reason,
                'your_plan_allows' => $e->limitValue,
                'model_requires' => $e->currentUsage,
            ], 403);
        }
    }

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
        $baseUrl = 'http://host.docker.internal:11434';

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
        // Deprecated — removed. See guardAiRequest() above, backed by
        // PlanGuard::authorize($user, 'ai.request'). Kept as a stub only if
        // something outside this file still calls it directly; if you hit
        // this comment, that call site needs migrating too.
        throw new \RuntimeException('checkRateLimit() is deprecated — use guardAiRequest() via PlanGuard instead.');
    }

    /**
     * GENERATE PROJECT (Boilerplate-First Approach)
     *
     * ARCHITECTURE:
     *   Step 1 — Detect framework from user prompt (BoilerplateManager::detectFromPrompt)
     *   Step 2 — Write the canonical boilerplate scaffold to disk (BoilerplateManager::write)
     *            This guarantees correct bootstrap/app.php, kernel files, package.json,
     *            vite.config.js, etc. before the AI is even called.
     *   Step 3 — Sync boilerplate files into the DB so the editor shows them.
     *   Step 4 — Call AI with a focused prompt asking ONLY for app-specific files
     *            (controllers, models, views, routes, components, etc.)
     *   Step 5 — Merge AI response ON TOP of the boilerplate. AI files overwrite
     *            boilerplate placeholders (e.g. routes/web.php, src/App.jsx).
     *            Protected scaffold files are never overwritten by AI.
     *   Step 6 — Sync merged files into DB.
     *
     * This eliminates the entire class of bugs where AI outputs empty scaffold
     * files, uses wrong Laravel API versions, or forgets Kernel classes.
     */
    public function generate(Request $request)
    {
        $request->validate([
            'project_id' => 'required|exists:projects,id',
            'prompt'     => 'required|string|max:5000',
            'model'      => 'required|string',
            'api_keys'   => 'nullable|array'
        ]);

        $project = Project::find($request->project_id);
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        if ($guardResponse = $this->guardAiRequest($request->user())) {
            return $guardResponse;
        }

        $model   = $request->model;
        if ($guardResponse = $this->guardModelAccess($request->user(), $model)) {
            return $guardResponse;
        }
        $apiKeys = $request->input('api_keys', []);
        $config  = $this->getProviderConfig($model, $apiKeys);

        if (!$config) {
            return response()->json(['error' => "Configuration failed for model: {$model}. Please check your API keys."], 400);
        }

        $workspacePath  = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        $userPrompt     = $request->prompt;

        // ── STEP 1: Detect framework ─────────────────────────────────────────
        $boilerplateKey = \App\Services\BoilerplateManager::detectFromPrompt($userPrompt);
        Log::info("[Ubiq] generate() — detected boilerplate: {$boilerplateKey} for project {$project->id}");

        // ── STEP 2 & 3: Write hardcoded scaffold files to disk + sync to DB ────
        // write() generates all scaffold files from the in-memory template
        // definition and calls the sync callback once per file, so we don't
        // need a separate directory-scan loop afterward. No zip files required.
        $boilerplateMeta = \App\Services\BoilerplateManager::write(
            $boilerplateKey,
            $workspacePath,
            function (string $relativePath, string $content) use ($project) {
                $project->files()->updateOrCreate(
                    ['path' => $relativePath],
                    [
                        'name'       => basename($relativePath),
                        'content'    => $content,
                        'language'   => $this->detectLanguage($relativePath),
                        'size_bytes' => strlen($content),
                        'is_deleted' => false,
                    ]
                );
            }
        );

        // ── STEP 4: Build AI prompt ──────────────────────────────────────────
        $frameworkPrompt = \App\Services\BoilerplateManager::getAiPrompt($boilerplateKey);

        $systemPrompt = <<<'SYSTEMPROMPT'
You are an Expert Full Stack Developer. Your job is to implement the APPLICATION-SPECIFIC logic for a project whose scaffold is already set up.

OUTPUT FORMAT (MANDATORY):
Return ONLY a single valid JSON object. Keys are relative file paths, values are complete file contents.
Example: {"routes/web.php": "<?php use Illuminate\\Support\\Facades\\Route; Route::get('/', fn() => 'Hello');"}
NO markdown fences, NO explanation, NO comments outside JSON. Response MUST start with { and end with }.

CRITICAL RULES:
- NEVER output an empty string "" as a file value. Every file must have real, complete content.
- NEVER output scaffold/infrastructure files that already exist (listed in framework instructions below).
- DO output all application logic files: controllers, models, views, routes, components, migrations, etc.
- All code must be production-quality and complete — no TODO comments, no placeholder functions.
SYSTEMPROMPT;

        $fullPrompt = "Build this application: {$userPrompt}\n\n" .
                      "=== FRAMEWORK INSTRUCTIONS ===\n{$frameworkPrompt}";

        // ── STEP 5: Call AI ──────────────────────────────────────────────────
        try {
            $payload = [];

            if ($config['provider'] === 'gemini') {
                $payload = [
                    'systemInstruction' => ['parts' => [['text' => $systemPrompt]]],
                    'contents'          => [['role' => 'user', 'parts' => [['text' => $fullPrompt]]]],
                    'generationConfig'  => ['temperature' => 0.2, 'maxOutputTokens' => 8192],
                ];
            } elseif ($config['provider'] === 'ollama') {
                $payload = [
                    'model'    => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user',   'content' => $fullPrompt],
                    ],
                    'stream'  => false,
                    'options' => ['num_predict' => 8000, 'temperature' => 0.1],
                ];
            } else {
                $payload = [
                    'model'       => $config['model_name'],
                    'messages'    => [
                        ['role' => 'system', 'content' => $systemPrompt],
                        ['role' => 'user',   'content' => $fullPrompt],
                    ],
                    'temperature' => 0.2,
                    'max_tokens'  => 8000,
                    'stream'      => false,
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(180)->post($config['url'], $payload);

            if (!$response->successful()) {
                throw new \Exception("Provider Error ({$response->status()}): " . substr($response->body(), 0, 200));
            }

            $data    = $response->json();
            $content = $config['provider'] === 'gemini'
                ? ($data['candidates'][0]['content']['parts'][0]['text'] ?? '')
                : ($data['choices'][0]['message']['content'] ?? $data['message']['content'] ?? '');

            // Strip markdown fences if AI wrapped the JSON
            $content = preg_replace('/^```(?:json)?\s*/m', '', $content);
            $content = preg_replace('/\s*```$/m', '', $content);
            $content = trim($content);

            // Extract JSON object if there's leading text
            if (!str_starts_with($content, '{')) {
                preg_match('/\{[\s\S]*\}/s', $content, $matches);
                $content = $matches[0] ?? $content;
            }

            $aiFiles = json_decode($content, true);

            if (json_last_error() !== JSON_ERROR_NONE || empty($aiFiles)) {
                throw new \Exception("AI response was not valid JSON. Raw: " . substr($content, 0, 150) . "...");
            }

            // ── STEP 6: Merge AI files ON TOP of boilerplate ─────────────────
            // Protected files cannot be overwritten by AI — these are the scaffold
            // files we wrote in Step 2 that must remain exactly as written.
            $protected = $this->getProtectedPaths($boilerplateKey);

            $aiSavedCount = 0;

            foreach ($aiFiles as $filePath => $code) {
                // Sanitize path
                $filePath = ltrim(str_replace(['../', '..\\', '\\'], ['', '', '/'], $filePath), '/');

                if (trim((string)$code) === '') {
                    Log::warning("[Ubiq] AI generated empty file: {$filePath} — skipping");
                    continue;
                }

                if (in_array($filePath, $protected, true)) {
                    Log::info("[Ubiq] AI tried to overwrite protected scaffold file: {$filePath} — skipping");
                    continue;
                }

                // Write to disk
                $fullPath = $workspacePath . '/' . $filePath;
                if (!is_dir(dirname($fullPath))) mkdir(dirname($fullPath), 0755, true);
                file_put_contents($fullPath, $code);

                // Sync to DB
                $project->files()->updateOrCreate(
                    ['path' => $filePath],
                    [
                        'name'       => basename($filePath),
                        'content'    => $code,
                        'language'   => $this->detectLanguage($filePath),
                        'size_bytes' => strlen($code),
                        'is_deleted' => false,
                    ]
                );

                $aiSavedCount++;
            }

            Log::info("[Ubiq] generate() complete — boilerplate: {$boilerplateKey}, ai files: {$aiSavedCount}, project: {$project->id}");

            // FIX: Return the full project file list so the frontend can refresh
            // the editor tree. Previously only a message string was returned, so
            // the UI had no way to know which files were saved and never updated.
            $allFiles = $project->files()
                ->where('is_deleted', false)
                ->get(['id', 'path', 'name', 'language', 'size_bytes'])
                ->toArray();

            return response()->json([
                'message'     => "Generated {$aiSavedCount} application files on {$boilerplateKey} scaffold",
                'boilerplate' => $boilerplateKey,
                'model_used'  => $model,
                'files_saved' => $aiSavedCount,
                'files'       => $allFiles,
            ]);

        } catch (\Exception $e) {
            Log::error("[Ubiq] generate() failed: " . $e->getMessage(), ['project_id' => $project->id]);
            return response()->json(['error' => 'Generation failed: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Returns file paths that must NOT be overwritten by AI output.
     * Delegates to BoilerplateManager which is the single source of truth.
     */
    private function getProtectedPaths(string $boilerplateKey): array
    {
        // Common to all
        $common = ['ubiq.json'];

        return match(true) {
            str_starts_with($boilerplateKey, 'laravel@11') => array_merge($common, [
                'bootstrap/app.php',
                'bootstrap/providers.php',
                'public/index.php',
                'artisan',
                'composer.json',
                '.env.example',
                'config/app.php',
                'config/database.php',
                'config/cache.php',
                'config/session.php',
                'app/Providers/AppServiceProvider.php',
                'app/Models/User.php',
                'routes/console.php',
            ]),
            str_starts_with($boilerplateKey, 'laravel@10') => array_merge($common, [
                'bootstrap/app.php',
                'public/index.php',
                'artisan',
                'composer.json',
                '.env.example',
                'config/app.php',
                'config/database.php',
                'config/cache.php',
                'config/session.php',
                'app/Http/Kernel.php',
                'app/Console/Kernel.php',
                'app/Exceptions/Handler.php',
                'app/Providers/AppServiceProvider.php',
                'app/Models/User.php',
                'routes/console.php',
            ]),
            in_array($boilerplateKey, ['react', 'vue']) => array_merge($common, [
                'package.json',
                'vite.config.js',
                'index.html',
                'src/main.jsx',
                'src/main.js',
            ]),
            $boilerplateKey === 'nextjs' => array_merge($common, [
                'package.json',
                'next.config.mjs',
                'app/layout.jsx',
            ]),
            $boilerplateKey === 'node' => array_merge($common, ['package.json']),
            $boilerplateKey === 'angular' => array_merge($common, [
                'package.json',
                'angular.json',
                'src/main.ts',
                'src/index.html',
            ]),
            in_array($boilerplateKey, ['flask', 'fastapi']) => array_merge($common, ['requirements.txt']),
            $boilerplateKey === 'django' => array_merge($common, [
                'manage.py',
                'requirements.txt',
                'config/settings.py',
            ]),
            default => $common,
        };
    }

    private function detectLanguage($filename)
    {
        $ext = pathinfo($filename, PATHINFO_EXTENSION);
        return match ($ext) {
            'js', 'jsx'  => 'javascript',
            'ts', 'tsx'  => 'typescript',
            'html'       => 'html',
            'css', 'scss' => 'css',
            'json'       => 'json',
            'php'        => 'php',
            'py'         => 'python',
            'sh'         => 'shell',
            'md'         => 'markdown',
            'sql'        => 'sql',
            'vue'        => 'vue',
            default      => 'plaintext',
        };
    }

    /**
     * Code completion endpoint
     */
    public function complete(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'code'     => 'required|string|max:10000',
            'language' => 'required|string|max:50',
            'model'    => 'nullable|string|max:100',
            'api_keys' => 'nullable|array'
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        $user = $request->user();
        if ($guardResponse = $this->guardAiRequest($user)) {
            return $guardResponse;
        }

        $model   = $request->model ?? ($user->preferences->preferred_model ?? 'codellama:7b');
        if ($guardResponse = $this->guardModelAccess($user, $model)) {
            return $guardResponse;
        }
        $apiKeys = $request->input('api_keys', []);
        $config  = $this->getProviderConfig($model, $apiKeys);

        if (!$config) return response()->json(['error' => 'Missing API Key for selected model'], 400);

        $prompt = "You are an expert code completion engine. Output ONLY the code to complete the following {$request->language} snippet. Do not use Markdown blocks. Context:\n\n" . $request->code;

        try {
            $startTime = microtime(true);
            $payload   = [];

            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => $prompt]]]]];
            } else {
                $payload = [
                    'model'    => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are a code completion tool. Output only raw code.'],
                        ['role' => 'user',   'content' => $prompt]
                    ],
                    'max_tokens'  => 100,
                    'temperature' => 0.2,
                    'stream'      => false
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(30)->post($config['url'], $payload);

            if (!$response->successful()) throw new \Exception('Provider Error: ' . $response->body());

            $result  = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $result['candidates'][0]['content']['parts'][0]['text'] ?? '';
            } else {
                $content = $result['choices'][0]['message']['content'] ?? '';
            }

            $latency = (microtime(true) - $startTime) * 1000;

            UsageLog::create([
                'user_id'      => $user->id,
                'request_type' => 'completion',
                'model_used'   => $model,
                'latency_ms'   => $latency,
                'success'      => true,
                'ip_address'   => $request->ip(),
            ]);

            return response()->json([
                'completion'        => $content,
                'model'             => $model,
                'cached'            => false,
                'remaining_requests' => $this->remainingAiRequests($user)
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
            'model'    => 'nullable|string',
            'api_keys' => 'nullable|array'
        ]);

        $user    = $request->user();
        // chat() had no rate limiting at all before this — every other
        // AI-calling endpoint in this controller did. Closing that gap here.
        if ($guardResponse = $this->guardAiRequest($user)) {
            return $guardResponse;
        }

        $model   = $request->model ?? 'gpt-3.5-turbo';
        if ($guardResponse = $this->guardModelAccess($user, $model)) {
            return $guardResponse;
        }
        $apiKeys = $request->input('api_keys', []);

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) {
            return response()->json(['error' => 'Missing API Key'], 400);
        }

        try {
            $payload = [];

            if ($config['provider'] === 'gemini') {
                $geminiMessages    = [];
                $systemInstruction = null;

                foreach ($request->messages as $msg) {
                    if ($msg['role'] === 'system') {
                        $systemInstruction = ['parts' => [['text' => $msg['content']]]];
                    } else {
                        $role             = ($msg['role'] === 'assistant') ? 'model' : 'user';
                        $geminiMessages[] = ['role' => $role, 'parts' => [['text' => $msg['content']]]];
                    }
                }

                $payload = ['contents' => $geminiMessages];
                if ($systemInstruction) {
                    $payload['systemInstruction'] = $systemInstruction;
                }
            } elseif ($config['provider'] === 'ollama') {
                $payload = [
                    'model'    => $config['model_name'],
                    'messages' => $request->messages,
                    'stream'   => false,
                ];
            } else {
                $payload = [
                    'model'      => $config['model_name'],
                    'messages'   => $request->messages,
                    'stream'     => false,
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);

            if (!$response->successful()) {
                throw new \Exception('AI Provider Error: ' . $response->body());
            }

            $data    = $response->json();
            $content = '';

            if ($config['provider'] === 'gemini') {
                $content = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
            } else {
                $content = $data['choices'][0]['message']['content'] ?? $data['message']['content'] ?? '';
            }

            return response()->json([
                'message' => ['role' => 'assistant', 'content' => $content],
                'model'   => $model
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
            'code'        => 'required|string',
            'language'    => 'required|string',
            'model'       => 'nullable|string',
            'review_type' => 'nullable|array',
            'api_keys'    => 'nullable|array'
        ]);

        $user           = $request->user();
        if ($guardResponse = $this->guardAiRequest($user)) {
            return $guardResponse;
        }

        $model       = $request->model ?? 'gpt-4o';
        if ($guardResponse = $this->guardModelAccess($user, $model)) {
            return $guardResponse;
        }
        $apiKeys     = $request->input('api_keys', []);
        $reviewTypes = $request->review_type ?? ['security', 'performance', 'best_practices'];
        $prompt      = "Review the following {$request->language} code for " . implode(', ', $reviewTypes) . ":\n\n{$request->code}\n\nProvide a detailed review with specific suggestions.";

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) return response()->json(['error' => 'Missing API Key'], 400);

        try {
            $payload = [];
            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => "You are an expert code reviewer.\n" . $prompt]]]]];
            } else {
                $payload = [
                    'model'    => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are an expert code reviewer.'],
                        ['role' => 'user',   'content' => $prompt]
                    ],
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);
            if (!$response->successful()) throw new \Exception($response->body());

            $result  = $response->json();
            $content = $config['provider'] === 'gemini'
                ? ($result['candidates'][0]['content']['parts'][0]['text'] ?? 'No review generated')
                : ($result['choices'][0]['message']['content'] ?? 'No review generated');

            return response()->json([
                'review'             => $content,
                'model'              => $model,
                'remaining_requests' => $this->remainingAiRequests($user)
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
            'code'          => 'required|string',
            'error_message' => 'required|string',
            'language'      => 'required|string',
            'model'         => 'nullable|string',
            'api_keys'      => 'nullable|array'
        ]);

        $user           = $request->user();
        if ($guardResponse = $this->guardAiRequest($user)) {
            return $guardResponse;
        }

        $model   = $request->model ?? 'gpt-4o';
        if ($guardResponse = $this->guardModelAccess($user, $model)) {
            return $guardResponse;
        }
        $apiKeys = $request->input('api_keys', []);
        $prompt  = "Debug this {$request->language} code that produces the following error:\n\nError: {$request->error_message}\n\nCode:\n{$request->code}\n\nExplain the issue and provide a fix.";

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) return response()->json(['error' => 'Missing API Key'], 400);

        try {
            $payload = [];
            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => "You are an expert debugger.\n" . $prompt]]]]];
            } else {
                $payload = [
                    'model'    => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are an expert debugger.'],
                        ['role' => 'user',   'content' => $prompt]
                    ],
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);
            if (!$response->successful()) throw new \Exception($response->body());

            $result  = $response->json();
            $content = $config['provider'] === 'gemini'
                ? ($result['candidates'][0]['content']['parts'][0]['text'] ?? 'No solution found')
                : ($result['choices'][0]['message']['content'] ?? 'No solution found');

            return response()->json([
                'solution'           => $content,
                'model'              => $model,
                'remaining_requests' => $this->remainingAiRequests($user)
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
            'code'     => 'required|string',
            'language' => 'required|string',
            'model'    => 'nullable|string',
            'api_keys' => 'nullable|array'
        ]);

        $user           = $request->user();
        if ($guardResponse = $this->guardAiRequest($user)) {
            return $guardResponse;
        }

        $model   = $request->model ?? 'gpt-4o';
        if ($guardResponse = $this->guardModelAccess($user, $model)) {
            return $guardResponse;
        }
        $apiKeys = $request->input('api_keys', []);
        $prompt  = "Explain this {$request->language} code in detail:\n\n{$request->code}";

        $config = $this->getProviderConfig($model, $apiKeys);
        if (!$config) return response()->json(['error' => 'Missing API Key'], 400);

        try {
            $payload = [];
            if ($config['provider'] === 'gemini') {
                $payload = ['contents' => [['role' => 'user', 'parts' => [['text' => "You are a helpful programming teacher.\n" . $prompt]]]]];
            } else {
                $payload = [
                    'model'    => $config['model_name'],
                    'messages' => [
                        ['role' => 'system', 'content' => 'You are a helpful programming teacher.'],
                        ['role' => 'user',   'content' => $prompt]
                    ],
                    'max_tokens' => 2048
                ];
            }

            $response = Http::withHeaders($config['headers'])->timeout(120)->post($config['url'], $payload);
            if (!$response->successful()) throw new \Exception($response->body());

            $result  = $response->json();
            $content = $config['provider'] === 'gemini'
                ? ($result['candidates'][0]['content']['parts'][0]['text'] ?? 'No explanation found')
                : ($result['choices'][0]['message']['content'] ?? 'No explanation found');

            return response()->json([
                'explanation'        => $content,
                'model'              => $model,
                'remaining_requests' => $this->remainingAiRequests($user)
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Explanation failed', 'details' => $e->getMessage()], 500);
        }
    }
}