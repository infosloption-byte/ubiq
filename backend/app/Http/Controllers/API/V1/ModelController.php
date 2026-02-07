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

    public function index()
    {
        // Cache for 60 seconds (short cache to reflect local model changes quickly)
        return Cache::remember('ai_models_list_v2', 60, function () {
            try {
                $response = Http::timeout(5)->get($this->inferenceUrl . '/v1/models');
                
                if ($response->successful()) {
                    $data = $response->json();
                    
                    // The Python server now returns a unified list with 'provider'
                    // We just need to map it to ensure all keys exist for the frontend
                    $formattedModels = collect($data['models'] ?? [])->map(function ($model) {
                        return [
                            'id' => $model['name'], 
                            'name' => $model['name'],
                            'display_name' => $this->formatModelName($model['name']),
                            'provider' => $model['provider'] ?? 'Unknown', // PASS THIS THROUGH
                            'size' => $model['size'] ?? 'Unknown',
                            'parameter_size' => $model['parameter_size'] ?? 'Unknown',
                        ];
                    });

                    return response()->json(['models' => $formattedModels]);
                }
                
                return response()->json(['models' => $this->getFallbackModels()]);
                
            } catch (\Exception $e) {
                return response()->json(['models' => $this->getFallbackModels()]);
            }
        });
    }

    private function formatModelName($name)
    {
        // Clean up prefixes for display
        $name = str_replace(['openrouter/', 'mistral/'], '', $name);
        $name = str_replace([':', '-'], ' ', $name);
        return ucwords($name);
    }

    private function getFallbackModels()
    {
        // Fallback shows at least one local option if python server is dead
        return [
            [
                'id' => 'codellama:7b',
                'name' => 'codellama:7b',
                'display_name' => 'CodeLlama 7B (Offline)',
                'provider' => 'Ollama',
                'size' => 'Unknown',
                'parameter_size' => '7B',
            ]
        ];
    }
}