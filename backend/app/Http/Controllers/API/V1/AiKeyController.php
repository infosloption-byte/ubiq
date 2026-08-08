<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\UserAiKey;
use Illuminate\Http\Request;

/**
 * D8 fix (PLAN_SYSTEM_TASKS.md Phase D): the only place BYOK provider
 * secrets (Google/OpenAI/OpenRouter/Mistral) are ever entered or updated
 * from now on. The raw value is written once here, encrypted at rest via
 * UserAiKey's cast, and never sent back to the browser afterward — every
 * response from this controller returns a masked preview only. Rotation is
 * "type a new value and save" (overwrites); revocation is DELETE (removes
 * the row outright, not a soft-delete — nothing lingers if a user decides
 * they don't trust a key that's been on this server).
 *
 * Ollama URLs (local/remote) are NOT managed here — they're per-request
 * connection targets, not secrets, and still travel with each AI request
 * from the client the same as before. See CompletionController's
 * mergeServerKeys() and the 2026-08-07 decision-log entry.
 */
class AiKeyController extends Controller
{
    private const ALLOWED_PROVIDERS = ['google', 'openai', 'openrouter', 'mistral'];

    /**
     * GET /ai-keys — one row per provider the user has configured. No
     * row at all for providers they haven't set up (not even a masked
     * placeholder), so the frontend can render "not configured" correctly.
     */
    public function index(Request $request)
    {
        $keys = UserAiKey::where('user_id', $request->user()->id)
            ->whereIn('provider', self::ALLOWED_PROVIDERS)
            ->get()
            ->map(fn (UserAiKey $key) => [
                'provider'     => $key->provider,
                'masked'       => $this->mask($key->value), // decrypted only transiently, in memory, to build the mask
                'updated_at'   => $key->updated_at,
                'last_used_at' => $key->last_used_at,
            ])
            ->values();

        return response()->json(['keys' => $keys]);
    }

    /**
     * PUT /ai-keys/{provider} — create or overwrite this provider's key.
     * Always returns the masked value, never the raw one, so the frontend
     * has no legitimate way to display the real secret after this call
     * either — same guarantee as index().
     */
    public function update(Request $request, string $provider)
    {
        if (!in_array($provider, self::ALLOWED_PROVIDERS, true)) {
            return response()->json(['error' => 'Unknown provider.'], 422);
        }

        $request->validate([
            'value' => 'required|string|min:8|max:2048',
        ]);

        $key = UserAiKey::updateOrCreate(
            ['user_id' => $request->user()->id, 'provider' => $provider],
            ['value' => trim($request->input('value'))]
        );

        return response()->json([
            'provider'   => $key->provider,
            'masked'     => $this->mask($key->value),
            'updated_at' => $key->updated_at,
        ]);
    }

    /**
     * DELETE /ai-keys/{provider} — actually removes the row (revocation,
     * not soft-delete). Idempotent: deleting a provider that was never
     * configured is a no-op 204, not a 404, since the end state the caller
     * wants ("this provider has no key") is already true either way.
     */
    public function destroy(Request $request, string $provider)
    {
        if (!in_array($provider, self::ALLOWED_PROVIDERS, true)) {
            return response()->json(['error' => 'Unknown provider.'], 422);
        }

        UserAiKey::where('user_id', $request->user()->id)
            ->where('provider', $provider)
            ->delete();

        return response()->json(null, 204);
    }

    /**
     * Shows only the last 4 characters, capped so a very long key doesn't
     * produce an unreasonably long string of bullets in the UI.
     */
    private function mask(string $value): string
    {
        $length = strlen($value);
        if ($length <= 4) {
            return str_repeat('•', max($length, 4));
        }

        $dots = min($length - 4, 20);
        return str_repeat('•', $dots) . substr($value, -4);
    }
}
