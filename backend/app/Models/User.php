<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = [
        'username',
        'email',
        'password',
        'google_id',
        'avatar',
        'api_key',
        'paypal_subscription_id',
        'subscription_status',
        'subscription_tier',
        'trial_ends_at',
        'subscription_ends_at',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $appends = [
        'storage_used_human',
        'trial_days_left'
    ];

    protected $casts = [
        'email_verified_at'    => 'datetime',
        'trial_ends_at'        => 'datetime',
        'subscription_ends_at' => 'datetime',
        'created_at'        => 'datetime',
        'updated_at'        => 'datetime',
        'password'          => 'hashed',
        'is_admin'          => 'boolean',
    ];

    // --- RELATIONSHIPS ---

    public function preferences() { return $this->hasOne(UserPreference::class); }
    public function projects()    { return $this->hasMany(Project::class); }
    public function chatSessions(){ return $this->hasMany(ChatSession::class); }
    public function usageLogs()   { return $this->hasMany(UsageLog::class); }
    public function rateLimits()  { return $this->hasMany(RateLimit::class); }

    // Files belong to Projects, not directly to Users — use hasManyThrough
    public function files()
    {
        return $this->hasManyThrough(File::class, Project::class);
    }

    // --- STORAGE LOGIC ---

    // Limits must match ProjectController constants:
    // Free = 512 MB (536,870,912 bytes)
    // Pro  = 5 GB  (5,368,709,120 bytes)
    const STORAGE_LIMIT_FREE = 536870912;
    const STORAGE_LIMIT_PRO  = 5368709120;

    public function getTotalStorageLimitInBytes(): int
    {
        return $this->subscription_tier === 'pro'
            ? self::STORAGE_LIMIT_PRO
            : self::STORAGE_LIMIT_FREE;
    }

    /**
     * Dynamically sum size_bytes from all non-deleted files across all projects.
     * Never reads a stale `storage_used` column — always reflects reality.
     */
    public function getUsedStorageBytes(): int
    {
        return (int) \DB::table('files')
            ->join('projects', 'files.project_id', '=', 'projects.id')
            ->where('projects.user_id', $this->id)
            ->where('files.is_deleted', false)
            ->sum('files.size_bytes');
    }

    /**
     * Returns true when the user has used all of their allocated storage.
     */
    public function isOverStorageLimit(): bool
    {
        return $this->getUsedStorageBytes() >= $this->getTotalStorageLimitInBytes();
    }

    // --- ACCESSORS ---

    public function getStorageUsedHumanAttribute(): string
    {
        $bytes = $this->getUsedStorageBytes();
        if ($bytes < 1048576) return number_format($bytes / 1024, 1) . ' KB';
        if ($bytes < 1073741824) return number_format($bytes / 1048576, 1) . ' MB';
        return number_format($bytes / 1073741824, 2) . ' GB';
    }

    public function getTrialDaysLeftAttribute(): int
    {
        if ($this->subscription_status === 'trialing' && $this->trial_ends_at) {
            return max(0, now()->diffInDays($this->trial_ends_at, false));
        }
        return 0;
    }
}