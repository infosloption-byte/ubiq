<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Confirmed via full grep before writing this: zero code references to
 * RateLimit::, the raw 'rate_limits' table name, or any query against it
 * anywhere in app/. Superseded entirely by usage_counters (Phase A3) since
 * B3a. Safe to drop — unlike subscription_tier, which is still actively
 * dual-written and read by several display endpoints, this table has had
 * no live consumer since B3a shipped.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('rate_limits');
    }

    public function down(): void
    {
        // Recreate the original shape if ever needed to roll back —
        // matches the original 2025_01_30 migration's definition.
        Schema::create('rate_limits', function ($table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('request_count')->default(0);
            $table->timestamp('window_start');
            $table->timestamp('window_end');
            $table->timestamps();
        });
    }
};
