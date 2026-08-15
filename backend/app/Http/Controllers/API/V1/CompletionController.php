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
     * Win-win policy, settled after initially defaulting to "restrict
     * everything" without a real answer: self-hosted models (Ollama) stay
     * tier-gated — that's the one place THIS platform incurs a real cost.
     * BYO-key models (the user supplies their own Gemini/OpenAI/OpenRouter/
     * Mistral key) are allowed on ANY tier — blocking a model the user is
     * paying for themselves is a pure paywall with no cost justification.
     * AI request rate limits (guardAiRequest, above) still apply
     * regardless of provider, so the upgrade incentive doesn't disappear —
     * it just shifts to throughput/concurrency rather than model choice.
     */
    private function hasByoKeyFor(string $modelId, array $apiKeys): bool
    {
        return match (true) {
            str_contains($modelId, 'gemini')                                        => !empty($apiKeys['google']),
            str_starts_with($modelId, 'gpt-')                                       => !empty($apiKeys['openai']),
            str_starts_with($modelId, 'openrouter/')                                 => !empty($apiKeys['openrouter']),
            str_contains($modelId, 'mistral') || str_contains($modelId, 'codestral') => !empty($apiKeys['mistral']),
            default => false, // bare/ollama-style model names have no BYO concept
        };
    }

    /**
     * Returns a 403 JsonResponse if denied, null if allowed — same calling
     * convention as guardAiRequest() so call sites stay a simple
     * `if ($r = $this->guardModelAccess(...)) return $r;` one-liner.
     */
    private function guardModelAccess($user, string $modelId, array $apiKeys = []): ?\Illuminate\Http\JsonResponse
    {
        if ($this->hasByoKeyFor($modelId, $apiKeys)) {
            return null;
        }

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
     * D8 fix (PLAN_SYSTEM_TASKS.md Phase D): previously every endpoint below
     * trusted whatever `api_keys` the client sent in the request body —
     * meaning the browser had to hold each provider's raw secret in
     * localStorage indefinitely and re-transmit it on every single AI call.
     * Provider secrets are now resolved from encrypted server-side storage
     * (see App\Models\UserAiKey) instead; any google/openai/openrouter/
     * mistral value the client still sends is silently ignored, not an
     * error — old frontend builds or cached JS keep working, they just stop
     * being the source of truth.
     *
     * `ollama_url` is deliberately NOT resolved here — it's a per-request
     * proxy target (which Ollama instance to call *this time*), not a
     * bearer-token secret, and the backend has no way to know it without
     * the client sending it (a user might run local Ollama in one session
     * and point at a remote box in another). It keeps passing straight
     * through from the client, unchanged from before this fix.
     */
    private function mergeServerKeys($user, array $clientSuppliedKeys = []): array
    {
        $serverKeys = \App\Models\UserAiKey::where('user_id', $user->id)
            ->whereIn('provider', ['google', 'openai', 'openrouter', 'mistral'])
            ->get()
            ->mapWithKeys(fn ($row) => [$row->provider => $row->value]) // decrypted transiently via the model cast
            ->toArray();

        return array_merge(
            ['ollama_url' => $clientSuppliedKeys['ollama_url'] ?? null],
            $serverKeys
        );
    }

    /**
     * D8 fix: bumps last_used_at for whichever stored provider key actually
     * served this request — lets a user tell, from the settings UI, whether
     * a key they suspect is compromised is still actively being used.
     * Ollama has no stored key to touch (see mergeServerKeys above).
     */
    private function touchKeyUsage($user, ?array $providerConfig): void
    {
        if (!$providerConfig) return;

        $providerKeyName = match ($providerConfig['provider'] ?? null) {
            'gemini' => 'google',
            'openai', 'openrouter', 'mistral' => $providerConfig['provider'],
            default => null,
        };

        if ($providerKeyName) {
            \App\Models\UserAiKey::where('user_id', $user->id)
                ->where('provider', $providerKeyName)
                ->update(['last_used_at' => now()]);
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
        $apiKeys = $this->mergeServerKeys($request->user(), $request->input('api_keys', [])); // D8 fix
        if ($guardResponse = $this->guardModelAccess($request->user(), $model, $apiKeys)) {
            return $guardResponse;
        }
        $config  = $this->getProviderConfig($model, $apiKeys);
        $this->touchKeyUsage($request->user(), $config); // D8 fix

        if (!$config) {
            return response()->json(['error' => "Configuration failed for model: {$model}. Please check your API keys."], 400);
        }

        $workspacePath  = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        $userPrompt     = $request->prompt;

        // ── STEP 1: Detect framework ─────────────────────────────────────────
        // G2b: only detect-from-prompt on a project's FIRST generate() call.
        // Once scaffolded, the framework is a stored fact (see the migration
        // adding this column), not something to re-derive from whatever the
        // user happens to type in a follow-up prompt — a second prompt with
        // different wording silently detecting a DIFFERENT boilerplate key
        // than what's actually on disk would compute the wrong
        // protected-paths list against an already-scaffolded project.
        if ($project->boilerplate_key) {
            $boilerplateKey = $project->boilerplate_key;
            Log::info("[Ubiq] generate() — using stored boilerplate: {$boilerplateKey} for project {$project->id}");
        } else {
            $boilerplateKey = \App\Services\BoilerplateManager::detectFromPrompt($userPrompt);
            $project->boilerplate_key = $boilerplateKey;
            $project->save();
            Log::info("[Ubiq] generate() — detected and stored boilerplate: {$boilerplateKey} for project {$project->id}");
        }

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

            // ── STEP 6: Build proposed file set for review — NOT written yet ──
            // G2b: this used to file_put_contents() + DB-sync every AI file
            // immediately, same principle violation G2a was built specifically
            // to close on the chat path — the user never saw or approved
            // anything the AI wrote before it was already on disk. Same shape
            // as G2a's `ReviewFile[]` (frontend/src/components/
            // MultiFileReviewScreen.tsx) so this can feed the exact same
            // screen once something calls this endpoint — see
            // PLAN_SYSTEM_TASKS.md's G2b entry for why nothing does yet.
            //
            // Protected files are included here, not silently dropped — the
            // point of surfacing them is so the person can SEE the AI tried
            // to touch a protected scaffold file, not have it vanish with
            // only a log line as the only record. `isProtected: true` is
            // enforced again, independently, server-side in
            // FileController::store()/update() when a proposal is actually
            // accepted — the flag here is informational for the review
            // screen, not the only thing standing between a protected file
            // and being overwritten.
            $protected = \App\Services\BoilerplateManager::getProtectedPaths($boilerplateKey);
            $proposals = [];

            foreach ($aiFiles as $filePath => $code) {
                // Sanitize path
                $filePath = ltrim(str_replace(['../', '..\\', '\\'], ['', '', '/'], $filePath), '/');

                if (trim((string)$code) === '') {
                    Log::warning("[Ubiq] AI generated empty file: {$filePath} — skipping");
                    continue;
                }

                $existing = $project->files()->where('path', $filePath)->where('is_deleted', false)->first();

                $proposals[] = [
                    'path'         => $filePath,
                    'language'     => $this->detectLanguage($filePath),
                    'old_content'  => $existing?->content ?? '',
                    'new_content'  => $code,
                    'status'       => $existing ? 'modified' : 'new',
                    'is_protected' => in_array($filePath, $protected, true),
                ];
            }

            $proposalCount = count($proposals);
            Log::info("[Ubiq] generate() complete — boilerplate: {$boilerplateKey}, {$proposalCount} file(s) proposed for review, project: {$project->id}");

            // Scaffold files (Step 2/3) are already written and synced —
            // those are deterministic template output, not AI content, so
            // they never went through review and still don't. Only the
            // AI-authored proposals above are gated behind acceptance.
            $scaffoldFiles = $project->files()
                ->where('is_deleted', false)
                ->get(['id', 'path', 'name', 'language', 'size_bytes'])
                ->toArray();

            return response()->json([
                'message'      => "Scaffolded {$boilerplateKey} and proposed {$proposalCount} file(s) for review",
                'boilerplate'  => $boilerplateKey,
                'model_used'   => $model,
                'proposals'    => $proposals,
                'files'        => $scaffoldFiles,
            ]);

        } catch (\Exception $e) {
            Log::error("[Ubiq] generate() failed: " . $e->getMessage(), ['project_id' => $project->id]);
            return response()->json(['error' => 'Generation failed: ' . $e->getMessage()], 500);
        }
    }

    // NOTE: getProtectedPaths() used to live here as a private method with
    // its own hardcoded, independently-maintained copy of this list — one
    // that had quietly drifted from BoilerplateManager::getProtectedPaths()
    // (the version ProjectController.php has always called directly) into
    // a materially DIFFERENT, less complete list: missing several
    // Laravel config files (auth.php, mail.php, queue.php, services.php,
    // filesystems.php, logging.php) and app/Http/Controllers/Controller.php
    // entirely, and protecting the wrong set of Angular files altogether
    // (angular.json + src/index.html here vs. vite.config.ts + tsconfig.json
    // + src/styles.css in the real list). generate() has been silently
    // under-protecting scaffold files relative to what ProjectController
    // already enforces correctly, for as long as these two copies existed.
    // Removed rather than fixed-in-place — see generate()'s call site
    // and FileController's new enforcement below, both now call
    // BoilerplateManager::getProtectedPaths() directly, so there is
    // exactly one list to ever get out of sync with itself again.

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
        $apiKeys = $this->mergeServerKeys($user, $request->input('api_keys', [])); // D8 fix
        if ($guardResponse = $this->guardModelAccess($user, $model, $apiKeys)) {
            return $guardResponse;
        }
        $config  = $this->getProviderConfig($model, $apiKeys);
        $this->touchKeyUsage($user, $config); // D8 fix

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
        $apiKeys = $this->mergeServerKeys($user, $request->input('api_keys', [])); // D8 fix
        if ($guardResponse = $this->guardModelAccess($user, $model, $apiKeys)) {
            return $guardResponse;
        }

        $config = $this->getProviderConfig($model, $apiKeys);
        $this->touchKeyUsage($user, $config); // D8 fix
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
        $apiKeys     = $this->mergeServerKeys($user, $request->input('api_keys', [])); // D8 fix
        if ($guardResponse = $this->guardModelAccess($user, $model, $apiKeys)) {
            return $guardResponse;
        }
        $reviewTypes = $request->review_type ?? ['security', 'performance', 'best_practices'];
        $prompt      = "Review the following {$request->language} code for " . implode(', ', $reviewTypes) . ":\n\n{$request->code}\n\nProvide a detailed review with specific suggestions.";

        $config = $this->getProviderConfig($model, $apiKeys);
        $this->touchKeyUsage($user, $config); // D8 fix
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
        $apiKeys = $this->mergeServerKeys($user, $request->input('api_keys', [])); // D8 fix
        if ($guardResponse = $this->guardModelAccess($user, $model, $apiKeys)) {
            return $guardResponse;
        }
        $prompt  = "Debug this {$request->language} code that produces the following error:\n\nError: {$request->error_message}\n\nCode:\n{$request->code}\n\nExplain the issue and provide a fix.";

        $config = $this->getProviderConfig($model, $apiKeys);
        $this->touchKeyUsage($user, $config); // D8 fix
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
        $apiKeys = $this->mergeServerKeys($user, $request->input('api_keys', [])); // D8 fix
        if ($guardResponse = $this->guardModelAccess($user, $model, $apiKeys)) {
            return $guardResponse;
        }
        $prompt  = "Explain this {$request->language} code in detail:\n\n{$request->code}";

        $config = $this->getProviderConfig($model, $apiKeys);
        $this->touchKeyUsage($user, $config); // D8 fix
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