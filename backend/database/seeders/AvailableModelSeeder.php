<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * B3d — Populates available_models, which was previously empty and
 * unqueried anywhere in the app.
 *
 * UPDATE: as of the BYO-key policy decision, tier_required here only
 * actually gates access for self-hosted (Ollama) models — CompletionController::
 * hasByoKeyFor() exempts any model the user supplies their own provider
 * key for, regardless of what's set here. The Gemini/OpenAI/OpenRouter/
 * Mistral rows below are kept for resolveModelTier()'s fallback path
 * (used only if somehow no api_key is present for a commercial model,
 * which getProviderConfig() would reject anyway) and for future display
 * purposes — not as an active BYO restriction.
 *
 * Tier assignment for the Ollama rows follows real cost: larger models
 * cost more CPU-time on the shared box even at $0 per-token, so bigger
 * self-hosted models are reserved for higher tiers.
 *
 * Starting catalog, not exhaustive — add rows any time via the DB
 * directly (or the B5 admin UI). CompletionController's resolveModelTier()
 * falls back to the same family logic for any model NOT in this table.
 *
 * Re-runnable: upserts by `name`.
 */
class AvailableModelSeeder extends Seeder
{
    public function run(): void
    {
        $models = [
            // Ollama — self-hosted, free tier by default
            ['name' => 'codellama:7b',        'display_name' => 'CodeLlama 7B',         'model_type' => 'code', 'size' => '7b',  'tier_required' => 'free',    'context_window' => 4096,  'parameters_count' => '7B'],
            ['name' => 'llama3:8b',           'display_name' => 'Llama 3 8B',           'model_type' => 'chat', 'size' => '8b',  'tier_required' => 'free',    'context_window' => 8192,  'parameters_count' => '8B'],
            // Larger self-hosted models cost more CPU-time even though
            // they're still $0 per-token — reserved for higher tiers so
            // Free/Starter users don't tie up disproportionate sandbox CPU.
            ['name' => 'deepseek-coder:33b',  'display_name' => 'DeepSeek Coder 33B',   'model_type' => 'code', 'size' => '33b', 'tier_required' => 'creator', 'context_window' => 16384, 'parameters_count' => '33B'],
            ['name' => 'codellama:34b',       'display_name' => 'CodeLlama 34B',        'model_type' => 'code', 'size' => '34b', 'tier_required' => 'creator', 'context_window' => 16384, 'parameters_count' => '34B'],

            // Mistral / Codestral — cheap commercial API, BYO key
            ['name' => 'codestral-latest',    'display_name' => 'Codestral',            'model_type' => 'code', 'size' => null,  'tier_required' => 'starter', 'context_window' => 32768, 'parameters_count' => null],
            ['name' => 'mistral-large-latest','display_name' => 'Mistral Large',        'model_type' => 'chat', 'size' => null,  'tier_required' => 'starter', 'context_window' => 32768, 'parameters_count' => null],

            // Gemini — capable, moderate cost, BYO key
            ['name' => 'gemini-1.5-flash',    'display_name' => 'Gemini 1.5 Flash',     'model_type' => 'both', 'size' => null,  'tier_required' => 'creator', 'context_window' => 1048576, 'parameters_count' => null],
            ['name' => 'gemini-1.5-pro',      'display_name' => 'Gemini 1.5 Pro',       'model_type' => 'both', 'size' => null,  'tier_required' => 'pro',     'context_window' => 2097152, 'parameters_count' => null],

            // OpenRouter — wide catalog, moderate cost, BYO key
            ['name' => 'openrouter/anthropic/claude-3-haiku', 'display_name' => 'Claude 3 Haiku (via OpenRouter)', 'model_type' => 'both', 'size' => null, 'tier_required' => 'creator', 'context_window' => 200000, 'parameters_count' => null],

            // OpenAI — priciest family, BYO key
            ['name' => 'gpt-3.5-turbo',       'display_name' => 'GPT-3.5 Turbo',        'model_type' => 'both', 'size' => null,  'tier_required' => 'pro',     'context_window' => 16385, 'parameters_count' => null],
            ['name' => 'gpt-4o',              'display_name' => 'GPT-4o',               'model_type' => 'both', 'size' => null,  'tier_required' => 'pro',     'context_window' => 128000, 'parameters_count' => null],
        ];

        foreach ($models as $model) {
            DB::table('available_models')->updateOrInsert(
                ['name' => $model['name']],
                array_merge($model, [
                    'is_active' => true,
                    'description' => null,
                    'updated_at' => now(),
                    'created_at' => now(),
                ])
            );
        }
    }
}
