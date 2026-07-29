<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UsageCounter extends Model
{
    protected $fillable = ['user_id', 'counter_key', 'window_type', 'window_start', 'count'];

    protected $casts = [
        'window_start' => 'datetime',
        'count' => 'integer',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
