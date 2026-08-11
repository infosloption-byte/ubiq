<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F0d (PLAN_SYSTEM_TASKS.md Phase F): replaces `docker exec` (blocked at
 * the socket-proxy — EXEC:0, see docker-compose.yml's FIX #9 note) with a
 * per-container command listener reachable only over the `ubiq_sandbox`
 * network, not via the Docker API. See TerminalController::execute() and
 * ProjectController's exec-listener startup snippet for the full design;
 * this migration just adds the one new column the design needs.
 *
 * `exec_secret` is a random per-run token, generated once in
 * claimPortAndReserve() and injected into the sandbox container as the
 * UBIQ_EXEC_SECRET env var. It's the only thing standing between "any
 * container on the shared ubiq_sandbox bridge network can reach this
 * listener" (true today, same as any other in-container service port —
 * see the docker-compose.yml note on this network) and "any container can
 * actually get it to run something". Nullable: legacy/in-flight rows from
 * before this shipped simply have no working terminal until their next
 * run, same graceful-degradation precedent as container_name's rollout in
 * the 2026-08-09 migration above.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->string('exec_secret')->nullable()->after('container_name');
        });
    }

    public function down(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->dropColumn('exec_secret');
        });
    }
};
