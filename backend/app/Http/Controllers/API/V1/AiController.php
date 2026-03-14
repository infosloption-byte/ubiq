<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

class AiController extends Controller
{
    // Updated list to match Frontend "Model" interface
    private $cloudModels = [
        [
            "id" => "grok-beta", 
            "name" => "grok-beta", 
            "display_name" => "xAI Grok Beta", 
            "provider" => "xAI", 
            "size" => "Cloud", 
            "parameter_size" => "Unknown"
        ],
        [
            "id" => "mistral-large-latest", 
            "name" => "mistral-large-latest", 
            "display_name" => "Mistral Large", 
            "provider" => "Mistral", 
            "size" => "Cloud", 
            "parameter_size" => "Large"
        ],
        [
            "id" => "codestral-latest", 
            "name" => "codestral-latest", 
            "display_name" => "Codestral (Code)", 
            "provider" => "Mistral", 
            "size" => "Cloud", 
            "parameter_size" => "22B"
        ],
        [
            "id" => "openrouter/anthropic/claude-3.5-sonnet", 
            "name" => "openrouter/anthropic/claude-3.5-sonnet", 
            "display_name" => "Claude 3.5 Sonnet", 
            "provider" => "OpenRouter", 
            "size" => "Cloud", 
            "parameter_size" => "Huge"
        ],
        [
            "id" => "openrouter/openai/gpt-4o", 
            "name" => "openrouter/openai/gpt-4o", 
            "display_name" => "GPT-4o", 
            "provider" => "OpenRouter", 
            "size" => "Cloud", 
            "parameter_size" => "Huge"
        ],
        [
            "id" => "gemini-2.5-pro", 
            "name" => "gemini-2.5-pro", 
            "display_name" => "Gemini 2.5 Pro", 
            "provider" => "Google", 
            "size" => "Cloud", 
            "parameter_size" => "Pro"
        ],
        [
            "id" => "gemini-2.5-flash", 
            "name" => "gemini-2.5-flash", 
            "display_name" => "Gemini 2.5 Flash", 
            "provider" => "Google", 
            "size" => "Cloud", 
            "parameter_size" => "Fast"
        ],
    ];

    public function getModels()
    {
        return response()->json(['models' => $this->cloudModels]);
    }

    public function chat(Request $request)
    {
        $request->validate([
            'messages' => 'required|array',
            'model'    => 'required|string',
            'api_keys' => 'nullable|array'
        ]);

        $modelId = $request->model;
        $apiKeys = $request->input('api_keys', []);

        $config = $this->getProviderConfig($modelId, $apiKeys);

        if (!$config) {
            return response()->json([
                'error' => "Missing API Key for this model. Please add it in Settings."
            ], 400);
        }

        try {
            $payload = [];

            if ($config['provider'] === 'gemini') {
                $geminiMessages = [];
                $systemInstruction = null;
                foreach ($request->messages as $msg) {
                    if ($msg['role'] === 'system') {
                        $systemInstruction = ['parts' => [['text' => $msg['content']]]];
                    } else {
                        $role = ($msg['role'] === 'assistant') ? 'model' : 'user';
                        $geminiMessages[] = ['role' => $role, 'parts' => [['text' => $msg['content']]]];
                    }
                }
                $payload = ['contents' => $geminiMessages];
                if ($systemInstruction) $payload['systemInstruction'] = $systemInstruction;
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

            $response = Http::withHeaders($config['headers'])
                ->timeout(60)
                ->post($config['url'], $payload);

            if (!$response->successful()) {
                return response()->json([
                    'error' => 'Provider Error: ' . ($response->json()['error']['message'] ?? $response->body())
                ], $response->status());
            }

            $data = $response->json();

            if ($config['provider'] === 'gemini') {
                $content = $data['candidates'][0]['content']['parts'][0]['text'] ?? '';
            } else {
                $content = $data['choices'][0]['message']['content'] ?? $data['message']['content'] ?? '';
            }

            return response()->json([
                'message' => ['role' => 'assistant', 'content' => $content]
            ]);

        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    private function getProviderConfig($modelId, $apiKeys)
    {
        // ... (Keep your existing provider config logic here) ...
        // 1. MISTRAL
        if (str_contains($modelId, 'mistral') || str_contains($modelId, 'codestral')) {
            $key = $apiKeys['mistral'] ?? null;
            if (!$key) return null;
            
            return [
                'url' => 'https://api.mistral.ai/v1/chat/completions',
                'headers' => ['Authorization' => "Bearer $key"],
                'model_name' => $modelId
            ];
        }

        // 2. GROK (xAI)
        if (str_contains($modelId, 'grok')) {
            $key = $apiKeys['grok'] ?? null;
            if (!$key) return null;

            return [
                'url' => 'https://api.x.ai/v1/chat/completions',
                'headers' => ['Authorization' => "Bearer $key"],
                'model_name' => $modelId
            ];
        }

        // 3. OPENROUTER
        if (str_starts_with($modelId, 'openrouter/')) {
            $key = $apiKeys['openrouter'] ?? null;
            if (!$key) return null;
            
            $cleanName = str_replace('openrouter/', '', $modelId);

            return [
                'url' => 'https://openrouter.ai/api/v1/chat/completions',
                'headers' => [
                    'Authorization' => "Bearer $key",
                    'HTTP-Referer' => config('app.url'),
                    'X-Title' => 'Ubiq Editor'
                ],
                'model_name' => $cleanName
            ];
        }

        // 4. GOOGLE GEMINI (native API)
        if (str_contains($modelId, 'gemini')) {
            $key = $apiKeys['google'] ?? null;
            if (!$key) return null;
            $cleanModel = str_replace('models/', '', $modelId);
            return [
                'provider' => 'gemini',
                'url' => "https://generativelanguage.googleapis.com/v1beta/models/{$cleanModel}:generateContent?key={$key}",
                'headers' => ['Content-Type' => 'application/json'],
                'model_name' => $cleanModel
            ];
        }

        // 5. OLLAMA (local or remote)
        $baseUrl = 'http://host.docker.internal:11434';
        if (!empty($apiKeys['ollama_url']) && filter_var($apiKeys['ollama_url'], FILTER_VALIDATE_URL)) {
            $baseUrl = rtrim($apiKeys['ollama_url'], '/');
        }
        return [
            'provider' => 'ollama',
            'url' => "{$baseUrl}/api/chat",
            'headers' => [],
            'model_name' => $modelId
        ];
    }
}