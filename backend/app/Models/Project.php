<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Project extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'name',
        'description',
        'language',
        'visibility',
        'is_archived',
        'source',
        'repository_url',
        'branch',
        'github_token',
        'storage_path',
        'db_engine', // F1c — null | 'mysql' | 'postgres', opt-in real DB in the sandbox
    ];

    protected $casts = [
        'is_archived' => 'boolean',
        'github_token' => 'encrypted', // Automatically encrypt/decrypt
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function files()
    {
        return $this->hasMany(File::class);
    }

    public function chatSessions()
    {
        return $this->hasMany(ChatSession::class);
    }
}