<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\AvailableModel;

/**
 * Was two parallel, duplicated implementations of the same provider-
 * routing logic across this file and CompletionController — this file
 * had its own hardcoded $cloudModels array (including gemini-2.5-flash,
 * which Google pulled early for some accounts ahead of its official
 * Oct 16 2026 shutdown, and grok-beta, which CompletionController's
 * actual getProviderConfig() never supported at all, meaning that
 * dropdown option never worked) and its own copy of chat()+
 * getProviderConfig() that was confirmed UNROUTED — dead code, not a
 * live bypass of PlanGuard, but a maintenance trap: a future edit here
 * could easily be mistaken for live behavior.
 *
 * Removed the dead chat()/getProviderConfig() duplicate entirely.
 * getModels() now reads from available_models (the same DB table B3d's
 * PlanGuard tier-gating already uses) instead of a hardcoded array —
 * updating the model list is now a DB edit via the B5 admin UI, not a
 * code deploy. This directly addresses the actual failure mode: Google's
 * Gemini API deprecates models faster than typical release cycles.
 */
class AiController extends Controller
{
    /**
     * GET /ai/models — same response shape the frontend's ModelSelector
     * already expects ({id, name, display_name, provider, size,
     * parameter_size}), just DB-backed now. `provider` is derived by the
     * same family pattern-matching used in CompletionController's
     * resolveModelTier()/getProviderConfig(), so a model only appears
     * here if getProviderConfig() can actually route it — no more
     * dropdown options (like grok-beta before) that can never work.
     */
    public function getModels()
    {
        $models = AvailableModel::where('is_active', true)
            ->orderBy('tier_required')
            ->orderBy('display_name')
            ->get()
            ->map(function ($m) {
                return [
                    'id' => $m->name,
                    'name' => $m->name,
                    'display_name' => $m->display_name,
                    'provider' => $this->deriveProvider($m->name),
                    'size' => $m->size,
                    'parameter_size' => $m->parameters_count ?? 'Unknown',
                ];
            })
            ->values();

        return response()->json(['models' => $models]);
    }

    /**
     * Same family logic as CompletionController::resolveModelTier()'s
     * fallback and hasByoKeyFor() — kept in sync manually since it's a
     * simple display-label mapping, not business logic; if this list of
     * families ever grows, update both places.
     */
    private function deriveProvider(string $modelId): string
    {
        return match (true) {
            str_contains($modelId, 'gemini') => 'Google',
            str_starts_with($modelId, 'gpt-') => 'OpenAI',
            str_starts_with($modelId, 'openrouter/') => 'OpenRouter',
            str_contains($modelId, 'mistral') || str_contains($modelId, 'codestral') => 'Mistral',
            default => 'Ollama',
        };
    }
}
