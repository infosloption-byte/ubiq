<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlanActionLog extends Model
{
    public $timestamps = false; // created_at only, set explicitly

    protected $fillable = [
        'user_id', 'plan_id_at_time', 'action_key', 'allowed',
        'limit_value', 'current_usage', 'reason', 'metadata', 'created_at',
    ];

    protected $casts = [
        'allowed' => 'boolean',
        'metadata' => 'array',
        'created_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
