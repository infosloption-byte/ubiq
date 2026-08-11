<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Audit log for every sandbox container run.
 *
 * Columns:
 *   id, user_id, project_id, ip_address, user_agent,
 *   started_at, stopped_at, port, container_name, exec_secret, runtime,
 *   framework
 */
class SandboxRun extends Model
{
    public $timestamps = false; // We manage started_at / stopped_at manually

    protected $fillable = [
        'user_id',
        'project_id',
        'ip_address',
        'user_agent',
        'started_at',
        'heartbeat_at',
        'stopped_at',
        'port',
        'container_name',
        'exec_secret',
        'runtime',
        'framework',
    ];

    protected $hidden = [
        // F0d: never let this leak out through an accidental toArray()/
        // toJson() on a SandboxRun — nothing in the frontend needs it, it
        // only ever travels container-side as an env var and server-side
        // inside TerminalController::execute().
        'exec_secret',
    ];

    protected $casts = [
        'started_at'   => 'datetime',
        'heartbeat_at' => 'datetime',
        'stopped_at'   => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    /** Duration in seconds, null if not yet stopped */
    public function getDurationSecondsAttribute(): ?int
    {
        if (!$this->stopped_at) return null;
        return $this->started_at->diffInSeconds($this->stopped_at);
    }

    /**
     * P0 fix (see migration 2026_08_09_000003): the actual Docker
     * container name for this run. Rows created after F0b ship have a
     * unique-per-run `container_name` stamped in claimPortAndReserve();
     * rows from before that (or before the migration ran) fall back to
     * the old shared project-scoped name. Every call site that needs a
     * container name for a specific run should read this accessor
     * instead of re-deriving "ubiq_project_{$id}" inline, so there's one
     * place this fallback lives.
     */
    public function getDockerNameAttribute(): string
    {
        return $this->container_name ?? "ubiq_project_{$this->project_id}";
    }
}