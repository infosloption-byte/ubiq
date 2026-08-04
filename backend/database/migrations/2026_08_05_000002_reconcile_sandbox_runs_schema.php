<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Reconciles the two duplicate, divergent sandbox_runs migrations
 * (2026_08_03_000001 and _000002) into one consistent schema, without
 * needing to know up front which of the two actually ran:
 *
 *   000001 has: user_agent varchar(255), indexes [project_id,stopped_at]
 *               AND [user_id,stopped_at]
 *   000002 has: user_agent varchar(500), index  [project_id,stopped_at]
 *               only
 *
 * Both are needed:
 *   - varchar(500), because ProjectController truncates user_agent to
 *     500 chars before inserting (substr($ua, 0, 500)) — under strict
 *     SQL mode a 255-column silently rejects/truncates that insert.
 *   - the [user_id, stopped_at] index, because reapStaleSandboxes()
 *     (FIX #11) runs `where('user_id', ...)->whereNull('stopped_at')`
 *     on literally every runProject() call — an unindexed scan there
 *     defeats the point of that check being "cheap enough to run
 *     synchronously on every request."
 *
 * Every step below is guarded (hasColumn/hasIndex) so this migration is
 * safe to run against either base schema, and safe to re-run if it's
 * ever accidentally run twice.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Widen user_agent to 500 chars if it's still the narrower
        //    varchar(255) from the 000001 migration. Doctrine DBAL (used
        //    by ->change()) can't easily introspect a column's current
        //    length across drivers, so rather than add a DBAL dependency
        //    just to check, we do this unconditionally — re-running
        //    string(500)->change() when the column is already 500 is a
        //    harmless no-op.
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->string('user_agent', 500)->nullable()->change();
        });

        // 2. Add the [user_id, stopped_at] index only if it isn't
        //    already there (present if 000001 ran, absent if 000002 ran).
        if (!Schema::hasIndex('sandbox_runs', ['user_id', 'stopped_at'])) {
            Schema::table('sandbox_runs', function (Blueprint $table) {
                $table->index(['user_id', 'stopped_at'], 'sandbox_runs_user_id_stopped_at_index');
            });
        }
    }

    public function down(): void
    {
        // Down doesn't attempt to narrow user_agent back to 255 — that's
        // a lossy, driver-fragile operation to reverse and nothing
        // depends on the column being narrow. It only drops the index
        // this migration is responsible for adding.
        if (Schema::hasIndex('sandbox_runs', ['user_id', 'stopped_at'])) {
            Schema::table('sandbox_runs', function (Blueprint $table) {
                $table->dropIndex('sandbox_runs_user_id_stopped_at_index');
            });
        }
    }
};
