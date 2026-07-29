<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserPlanOverride extends Model
{
    protected $fillable = ['user_id', 'feature_key', 'override_value', 'reason', 'expires_at'];

    protected $casts = [
        'expires_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }
}
