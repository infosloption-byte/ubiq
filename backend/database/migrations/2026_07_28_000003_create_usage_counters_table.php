<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase A3 — Usage counters (fast path for enforcement).
 *
 * This is deliberately separate from usage_logs/chat_messages, which are
 * for analytics. This table exists purely so PlanGuard can answer "can this
 * action happen right now" with a single indexed lookup instead of a slow
 * COUNT(*) over historical log tables at request time.
 *
 * window_type:
 *   'hour'       — window_start truncated to the hour, count resets each hour
 *   'day'        — window_start truncated to the day
 *   'concurrent' — window_start unused (or set to session start); count is
 *                  incremented on start and decremented on stop/cleanup,
 *                  representing "currently active", not a time window
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('usage_counters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('counter_key'); // e.g. ai_requests, active_sandboxes
            $table->enum('window_type', ['hour', 'day', 'concurrent']);
            $table->timestamp('window_start');
            $table->unsignedInteger('count')->default(0);
            $table->timestamps();

            $table->unique(['user_id', 'counter_key', 'window_type', 'window_start'], 'usage_counters_unique_window');
            $table->index(['counter_key', 'window_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('usage_counters');
    }
};
