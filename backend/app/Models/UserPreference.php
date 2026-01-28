<?php
// ============================================================
// File: app/Models/UserPreference.php
// ============================================================

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UserPreference extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'preferred_model',
        'theme',
        'editor_settings',
        'auto_complete',
        'code_suggestions',
    ];

    protected $casts = [
        'auto_complete' => 'boolean',
        'code_suggestions' => 'boolean',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}

