<?php

// ============================================================
// File: app/Models/ChatMessage.php
// ============================================================

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ChatMessage extends Model
{
    use HasFactory;

    protected $fillable = [
        'session_id',
        'role',
        'content',
        'code_context',
        'tokens_used',
    ];

    protected $casts = [
        'tokens_used' => 'integer',
        'created_at' => 'datetime',
    ];

    public $timestamps = false;

    public function session()
    {
        return $this->belongsTo(ChatSession::class, 'session_id');
    }
}

