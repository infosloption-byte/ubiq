<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OllamaProxyController extends Controller
{
    private const MODEL_PATTERN = '/^[a-zA-Z0-9][a-zA-Z0-9._:\-]{0,99}$/';

    /**
     * Validates that a URL is safe to proxy to.
     * Allows only http/https, blocks AWS metadata, internal cloud endpoints,
     * and private/loopback ranges that shouldn't be reachable from the server.
     */
    private function validateOllamaUrl(?string $url): bool
    {
        if (empty($url)) return false;

        // Must be http or https
        if (!preg_match('/^https?:\/\//i', $url)) return false;

        $parts = parse_url($url);
        if (!isset($parts['host'])) return false;

        $host = strtolower($parts['host']);

        // Block AWS/GCP/Azure metadata endpoints
        $blockedHosts = [
            '169.254.169.254',    // AWS / Azure / GCP metadata
            'metadata.google.internal',
            'fd00:ec2::254',      // AWS IPv6 metadata
        ];
        foreach ($blockedHosts as $blocked) {
            if ($host === $blocked) return false;
        }

        // Block private IP ranges the server should not reach
        // (These are internal network addresses, not legitimate Ollama servers)
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            // Allow localhost explicitly — valid for local Ollama
            if (in_array($host, ['127.0.0.1', '::1'])) return true;

            // Block RFC-1918 private ranges when accessed from the server
            // (prevents scanning internal network topology)
            $privateRanges = [
                '/^10\./',
                '/^172\.(1[6-9]|2[0-9]|3[0-1])\./',
                '/^192\.168\./',
                '/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./', // CGNAT
            ];
            foreach ($privateRanges as $range) {
                if (preg_match($range, $host)) return false;
            }
        }

        return true;
    }

    private function ollamaBase(Request $request): ?string
    {
        // Accept URL from request body (chat) or query param (tags)
        // but always run it through the validator first.
        $url = $request->input('url') ?? $request->query('url');

        if ($url) {
            if (!$this->validateOllamaUrl($url)) {
                return null; // caller returns 422
            }
            return rtrim($url, '/');
        }

        // Fallback to server-configured default
        return rtrim(env('OLLAMA_BASE_URL', 'http://localhost:11434'), '/');
    }

    private function validateModel(?string $model): bool
    {
        if (empty($model)) return false;
        return (bool) preg_match(self::MODEL_PATTERN, $model);
    }

    public function tags(Request $request)
    {
        $base = $this->ollamaBase($request);
        if (!$base) {
            return response()->json(['error' => 'Invalid or disallowed Ollama URL.'], 422);
        }

        try {
            $response = Http::timeout(10)->get($base . '/api/tags');
            if ($response->failed()) {
                return response()->json(['error' => 'Ollama unreachable'], 502);
            }
            return response()->json($response->json());
        } catch (\Exception $e) {
            Log::warning('Ollama tags proxy failed', ['error' => $e->getMessage()]);
            return response()->json(['error' => 'Ollama service unavailable'], 503);
        }
    }

    public function chat(Request $request)
    {
        $base = $this->ollamaBase($request);
        if (!$base) {
            return response()->json(['error' => 'Invalid or disallowed Ollama URL.'], 422);
        }

        $model = $request->input('model');
        if (!$this->validateModel($model)) {
            return response()->json([
                'error' => 'Invalid model name. Use format like "llama3" or "codellama:7b".',
            ], 422);
        }

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

        if ($request->has('messages')) {
            $payload['messages'] = collect($request->input('messages'))->map(fn($m) => [
                'role'    => in_array($m['role'] ?? '', ['user', 'assistant', 'system']) ? $m['role'] : 'user',
                'content' => (string) ($m['content'] ?? ''),
            ])->toArray();
            unset($payload['prompt']);
        }

        try {
            $response = Http::timeout(300)->post(
                $base . '/api/generate',
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