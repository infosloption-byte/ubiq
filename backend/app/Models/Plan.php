<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    protected $fillable = [
        'key', 'name', 'price_cents', 'currency', 'billing_interval',
        'paypal_plan_id', 'is_active', 'sort_order',
    ];

    protected $casts = [
        'price_cents' => 'integer',
        'is_active' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function features()
    {
        return $this->hasMany(PlanFeature::class);
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }
}
