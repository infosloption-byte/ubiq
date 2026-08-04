<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FIX #11 (port-allocation robustness pass).
 *
 * Adds heartbeat_at, pinged by the frontend every ~30s while a sandbox's
 * preview is actually open (see useSandboxAutoStop.ts / heartbeat()).
 *
 * Why this exists: the previous idle-detection story was
 *   1. beforeunload / component-unmount hooks (don't fire on sleep/crash/
 *      dropped network), backed up by
 *   2. a per-tier cron timeout (20-180 min) as the only real fallback.
 * That left a wide window where a dead-but-not-cleaned-up sandbox could
 * sit on a port. heartbeat_at lets CleanupSandboxes reclaim abandoned
 * sandboxes within ~2 minutes of the last heartbeat, while still
 * respecting the longer tier timeout for sandboxes that are open but
 * genuinely idle (heartbeat still ticking, user just not interacting).
 *
 * Nullable and defaults to started_at at write time (see ProjectController
 * claimPortAndReserve()) — existing/older rows without a heartbeat simply
 * fall back to the old started_at-based timeout in CleanupSandboxes.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->timestamp('heartbeat_at')->nullable()->after('started_at');
        });
    }

    public function down(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->dropColumn('heartbeat_at');
        });
    }
};
