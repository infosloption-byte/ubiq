<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PlanFeature extends Model
{
    protected $fillable = ['plan_id', 'feature_key', 'feature_value', 'value_type'];

    public function plan()
    {
        return $this->belongsTo(Plan::class);
    }

    /**
     * Cast the raw stored string according to value_type.
     * -1 is the "unlimited" sentinel for int values (caller decides how to
     * treat it — PlanGuard checks for it explicitly before comparing).
     */
    public function castValue(): int|bool|string
    {
        return match ($this->value_type) {
            'int' => (int) $this->feature_value,
            'bool' => filter_var($this->feature_value, FILTER_VALIDATE_BOOLEAN),
            default => $this->feature_value,
        };
    }
}
