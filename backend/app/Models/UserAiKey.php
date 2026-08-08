<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A single BYOK provider secret (Google/OpenAI/OpenRouter/Mistral), scoped
 * to one user. The `value` cast below is what actually does the encryption
 * — Eloquent transparently encrypts on write and decrypts on read using
 * Laravel's Crypt facade (AES-256-CBC, keyed by APP_KEY). Never bypass this
 * cast by touching the raw DB column directly.
 *
 * See migration 2026_08_07_000001_create_user_ai_keys_table and
 * PLAN_SYSTEM_TASKS.md Phase D, task D8, for the full rationale.
 */
class UserAiKey extends Model
{
    protected $fillable = ['user_id', 'provider', 'value', 'last_used_at'];

    protected $casts = [
        'value' => 'encrypted',
        'last_used_at' => 'datetime',
    ];

    /**
     * Never include the raw decrypted value in a toArray()/toJson() call by
     * accident — the API layer (AiKeyController) builds its own masked
     * response shape by hand instead of serializing this model directly,
     * but hiding it here too is a cheap extra guardrail against a future
     * accidental `return $userAiKey;` from some other endpoint.
     */
    protected $hidden = ['value'];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
