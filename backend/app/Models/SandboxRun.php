<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Audit log for every sandbox container run.
 *
 * Columns:
 *   id, user_id, project_id, ip_address, user_agent,
 *   started_at, stopped_at, port, runtime, framework
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
        'runtime',
        'framework',
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
}