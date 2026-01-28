<?php

// ============================================================
// File: app/Models/RateLimit.php
// ============================================================

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class RateLimit extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'request_count',
        'window_start',
        'window_end',
    ];

    protected $casts = [
        'request_count' => 'integer',
        'window_start' => 'datetime',
        'window_end' => 'datetime',
        'created_at' => 'datetime',
    ];

    public $timestamps = false;

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

