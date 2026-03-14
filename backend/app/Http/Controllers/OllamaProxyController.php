<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OllamaProxyController extends Controller
{
    /**
     * Allowed model name pattern.
     * Must be alphanumeric, dashes, underscores, dots, colon for tags.
     * Rejects path traversal, shell injection, null bytes, etc.
     * Examples: "llama3", "codellama:7b", "mistral:latest"
     */
    private const MODEL_PATTERN = '/^[a-zA-Z0-9][a-zA-Z0-9._:\-]{0,99}$/';

    private function ollamaBase(): string
    {
        return rtrim(env('OLLAMA_BASE_URL', 'http://localhost:11434'), '/');
    }

    private function validateModel(?string $model): bool
    {
        if (empty($model)) return false;
        return (bool) preg_match(self::MODEL_PATTERN, $model);
    }

    /**
     * GET /api/v1/ollama/tags
     * Proxies Ollama model list. Fixes Mixed Content errors.
     */
    public function tags(Request $request)
    {
        try {
            $response = Http::timeout(10)->get($this->ollamaBase() . '/api/tags');
            if ($response->failed()) {
                return response()->json(['error' => 'Ollama unreachable'], 502);
            }
            return response()->json($response->json());
        } catch (\Exception $e) {
            Log::warning('Ollama tags proxy failed', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Ollama service unavailable'], 503);
        }
    }

    /**
     * POST /api/v1/ollama/chat
     * Validates model name and sanitises payload before forwarding.
     */
    public function chat(Request $request)
    {
        $model = $request->input('model');

        if (!$this->validateModel($model)) {
            return response()->json([
                'error' => 'Invalid model name. Use format like "llama3" or "codellama:7b".',
            ], 422);
        }

        // Only forward known-safe keys — never pass arbitrary user data through
        $payload = [
            'model'  => $model,
            'prompt' => (string) $request->input('prompt', ''),
            'stream' => false,
            'options' => [],
        ];

        foreach (['temperature', 'top_p', 'top_k', 'num_predict', 'stop'] as $opt) {
            if ($request->has("options.{$opt}")) {
                $payload['options'][$opt] = $request->input("options.{$opt}");
            }
        }

        // Support chat messages array format
        if ($request->has('messages')) {
            $payload['messages'] = collect($request->input('messages'))->map(fn($m) => [
                'role'    => in_array($m['role'] ?? '', ['user', 'assistant', 'system']) ? $m['role'] : 'user',
                'content' => (string) ($m['content'] ?? ''),
            ])->toArray();
            unset($payload['prompt']);
        }

        try {
            $response = Http::timeout(300)->post(
                $this->ollamaBase() . '/api/generate',
                $payload
            );

            if ($response->failed()) {
                return response()->json([
                    'error' => 'Ollama returned an error. Is the model loaded?',
                ], 502);
            }

            return response()->json($response->json());

        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            return response()->json(['error' => 'Cannot reach Ollama. Is it running?'], 503);
        } catch (\Exception $e) {
            Log::error('Ollama chat proxy failed', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Proxy error.'], 500);
        }
    }
}