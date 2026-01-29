<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;

class ModelController extends Controller
{
    protected $inferenceUrl;

    public function __construct()
    {
        $this->inferenceUrl = env('INFERENCE_API_URL', 'http://localhost:8001');
    }

    /**
     * Get list of available AI models from the Inference Server (Ollama)
     */
    public function index()
    {
        // Cache the model list for 5 minutes to avoid hitting the python server constantly
        return Cache::remember('ai_models_list', 300, function () {
            try {
                $response = Http::timeout(5)->get($this->inferenceUrl . '/v1/models');
                
                if ($response->successful()) {
                    $data = $response->json();
                    
                    // Transform Ollama's response into a standardized format for the frontend
                    // Ollama returns: { models: [{ name: 'codellama:7b', size: ..., ... }] }
                    $formattedModels = collect($data['models'] ?? [])->map(function ($model) {
                        return [
                            'id' => $model['name'], // e.g., 'deepseek-coder:6.7b'
                            'name' => $model['name'],
                            'display_name' => $this->formatModelName($model['name']),
                            'size' => $this->formatSize($model['size'] ?? 0),
                            'family' => $model['details']['family'] ?? 'unknown',
                            'parameter_size' => $model['details']['parameter_size'] ?? 'unknown',
                        ];
                    });

                    return response()->json(['models' => $formattedModels]);
                }
                
                // Fallback if inference server is reachable but errors
                return response()->json(['models' => $this->getFallbackModels()]);
                
            } catch (\Exception $e) {
                // Fallback if inference server is down
                return response()->json(['models' => $this->getFallbackModels()]);
            }
        });
    }

    /**
     * Helper to format model names prettily (e.g. "deepseek-coder:6.7b" -> "DeepSeek Coder 6.7B")
     */
    private function formatModelName($name)
    {
        $name = str_replace([':', '-'], ' ', $name);
        return ucwords($name);
    }

    private function formatSize($bytes)
    {
        if ($bytes > 1073741824) {
            return round($bytes / 1073741824, 1) . ' GB';
        }
        return round($bytes / 1048576, 1) . ' MB';
    }

    private function getFallbackModels()
    {
        return [
            [
                'id' => 'codellama:7b',
                'name' => 'codellama:7b',
                'display_name' => 'CodeLlama 7B (Offline)',
                'size' => '3.8 GB',
                'family' => 'llama',
            ]
        ];
    }
}