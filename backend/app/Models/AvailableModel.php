<?php

// ============================================================
// File: app/Models/AvailableModel.php
// ============================================================

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class AvailableModel extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'display_name',
        'model_type',
        'size',
        'context_window',
        'is_active',
        'tier_required',
        'description',
        'parameters_count',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'context_window' => 'integer',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    public function scopeForTier($query, $tier)
    {
        return $query->where(function ($q) use ($tier) {
            $q->where('tier_required', $tier)
              ->orWhere('tier_required', 'free');
        });
    }
}