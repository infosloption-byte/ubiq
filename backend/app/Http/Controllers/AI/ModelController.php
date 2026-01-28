<?php

// ============================================================
// File: app/Http/Controllers/AI/ModelController.php
// ============================================================

namespace App\Http\Controllers\AI;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\AvailableModel;
use Illuminate\Support\Facades\Http;

class ModelController extends Controller
{
    protected $inferenceUrl;
    
    public function __construct()
    {
        $this->inferenceUrl = env('INFERENCE_API_URL', 'http://localhost:8001');
    }
    
    public function index(Request $request)
    {
        $user = $request->user();
        
        // Get models from database
        $models = AvailableModel::active()
            ->forTier($user->subscription_tier)
            ->get();
        
        // Optionally check which models are actually available in Ollama
        try {
            $response = Http::timeout(5)->get($this->inferenceUrl . '/v1/models');
            
            if ($response->successful()) {
                $ollamaModels = collect($response->json()['models'] ?? []);
                $availableModelNames = $ollamaModels->pluck('name')->toArray();
                
                // Mark models as available if they're in Ollama
                $models = $models->map(function ($model) use ($availableModelNames) {
                    $model->available_in_ollama = in_array($model->name, $availableModelNames);
                    return $model;
                });
            }
        } catch (\Exception $e) {
            // If Ollama check fails, continue without availability info
        }
        
        return response()->json([
            'models' => $models,
            'user_tier' => $user->subscription_tier
        ]);
    }
    
    public function show(Request $request, $modelName)
    {
        $model = AvailableModel::where('name', $modelName)->first();
        
        if (!$model) {
            return response()->json([
                'error' => 'Model not found'
            ], 404);
        }
        
        return response()->json([
            'model' => $model
        ]);
    }
}

