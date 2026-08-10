<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's GitHub OAuth connection (F3, PLAN_SYSTEM_TASKS.md Phase F).
 * The `access_token` cast below transparently encrypts on write and
 * decrypts on read using Laravel's Crypt facade (AES-256-CBC, keyed by
 * APP_KEY) — same pattern as App\Models\UserAiKey. Never bypass this
 * cast by touching the raw DB column directly.
 *
 * One row per user (unique user_id) — connecting again overwrites the
 * previous token rather than appending a second row.
 *
 * See migration 2026_08_09_000004_create_user_github_tokens_table and
 * UBIQ_ENHANCEMENT_ROADMAP.md F3 for the full rationale.
 */
class UserGithubToken extends Model
{
    protected $fillable = [
        'user_id',
        'access_token',
        'github_username',
        'github_avatar_url',
        'scopes',
        'connected_at',
        'last_used_at',
    ];

    protected $casts = [
        'access_token' => 'encrypted',
        'connected_at' => 'datetime',
        'last_used_at' => 'datetime',
    ];

    /**
     * Never include the raw decrypted token in a toArray()/toJson() call
     * by accident — GithubOAuthController builds its own response shape
     * by hand instead of serializing this model directly, but hiding it
     * here too is a cheap extra guardrail, same reasoning as
     * UserAiKey::$hidden.
     */
    protected $hidden = ['access_token'];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
