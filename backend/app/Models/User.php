<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Paddle\Billable; // 1. Import Paddle Billable Trait

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable, Billable; // 2. Add Billable here

    protected $fillable = [
        'username',
        'email',
        'password',
        'google_id',
        'avatar',
        'storage_used',
        'api_key',
        'paddle_id',            // ✅ ADDED — needed for listener Step 1
        'subscription_status',  // ✅ ADDED — needed for listener Step 2
        'subscription_tier',    // ✅ ADDED — needed for listener Step 2
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
        'email_verified_at' => 'datetime',
        'trial_ends_at' => 'datetime',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'password' => 'hashed',
        'is_admin' => 'boolean',
    ];

    // --- RELATIONSHIPS ---

    public function preferences() { return $this->hasOne(UserPreference::class); }
    public function projects() { return $this->hasMany(Project::class); }
    public function chatSessions() { return $this->hasMany(ChatSession::class); }
    public function usageLogs() { return $this->hasMany(UsageLog::class); }
    public function rateLimits() { return $this->hasMany(RateLimit::class); }
    public function files() { return $this->hasMany(File::class); }

    // --- STORAGE LOGIC ---

    public function getTotalStorageLimitInBytes()
    {
        $baseLimit = ($this->subscription_tier === 'pro') ? 20 : 5;
        return $baseLimit * 1024 * 1024 * 1024;
    }

    /**
     * Accessor for Human Readable Storage
     */
    public function getStorageUsedHumanAttribute()
    {
        return number_format($this->storage_used / (1024 * 1024 * 1024), 2) . ' GB';
    }

    // ✅ trial_days_left kept as an accessor — reads DB column, no Cashier dependency
    public function getTrialDaysLeftAttribute()
    {
        if ($this->subscription_status === 'trialing' && $this->trial_ends_at) {
            return max(0, now()->diffInDays($this->trial_ends_at, false));
        }
        return 0;
    }
}