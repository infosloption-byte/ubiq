<?php

// ============================================================
// File: app/Models/UsageLog.php
// ============================================================

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UsageLog extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'request_type',
        'model_used',
        'tokens_input',
        'tokens_output',
        'latency_ms',
        'success',
        'error_message',
        'ip_address',
        'user_agent',
    ];

    protected $casts = [
        'success' => 'boolean',
        'tokens_input' => 'integer',
        'tokens_output' => 'integer',
        'latency_ms' => 'integer',
        'created_at' => 'datetime',
    ];

    public $timestamps = false;

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

