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
        'plan_id',
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
    public function planOverrides() { return $this->hasMany(\App\Models\UserPlanOverride::class); }
    public function plan()        { return $this->belongsTo(\App\Models\Plan::class); }

    // Files belong to Projects, not directly to Users — use hasManyThrough
    public function files()
    {
        return $this->hasManyThrough(File::class, Project::class);
    }

    // --- STORAGE LOGIC ---

    // DEPRECATED — replaced by plan_features.storage.max_mb (Phase B3c).
    // Kept only because these are public model methods that could have
    // callers outside app/Http/Controllers (grep found none, but a model
    // method is riskier to fully remove than a private controller method
    // — delegating keeps them correct rather than throwing).
    const STORAGE_LIMIT_FREE = 536870912;
    const STORAGE_LIMIT_PRO  = 5368709120;

    public function getTotalStorageLimitInBytes(): int
    {
        $limitMb = app(\App\Services\PlanService::class)->limitFor($this, 'storage.max_mb');

        if ($limitMb === null) {
            // Fallback for the (unexpected) case where plan resolution
            // itself failed — old hardcoded behavior, not a real limit.
            return $this->subscription_tier === 'pro' ? self::STORAGE_LIMIT_PRO : self::STORAGE_LIMIT_FREE;
        }

        return is_int($limitMb) && $limitMb === -1
            ? PHP_INT_MAX // unlimited sentinel — never trips isOverStorageLimit()
            : $limitMb * 1048576;
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