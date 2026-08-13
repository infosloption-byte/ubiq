<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * G1d (PLAN_SYSTEM_TASKS.md Phase F): plan_action_logs was originally
 * indexed on (user_id, created_at) and (action_key, allowed, created_at)
 * — both fine for the per-user "recent denials" query G1a shipped
 * (UsageController::planUsage(), filtered by user_id first). But
 * neither index covers a plain `WHERE allowed = false ORDER BY
 * created_at DESC` scan across *all* users, which is exactly what an
 * instance-wide version of that same query needs once Bucket 3's admin
 * analytics gets picked up — G1d's whole point was confirming that
 * generalization is actually free before assuming it, and it wasn't
 * quite. Adding the missing composite index now, while the table is
 * still small, rather than leaving it as a surprise full-table-scan
 * whenever that admin view eventually reuses
 * UsageController::recentDenialsQuery($userId = null, ...).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plan_action_logs', function (Blueprint $table) {
            $table->index(['allowed', 'created_at'], 'plan_action_logs_allowed_created_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('plan_action_logs', function (Blueprint $table) {
            $table->dropIndex('plan_action_logs_allowed_created_at_index');
        });
    }
};
