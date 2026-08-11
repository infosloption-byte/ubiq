<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F1d (PLAN_SYSTEM_TASKS.md Phase F / UBIQ_ENHANCEMENT_ROADMAP.md "Ephemeral
 * preview links"): the in-container port nginx and getBuildLog()'s
 * readiness probe need to reach a sandbox by container name + internal
 * port now that the app container no longer publishes a host port at all
 * (see runProject()'s docker-run command and the F0d-pattern network join
 * this same effort added to nginx in docker-compose.yml).
 *
 * `port` (the 8100-8899 allocation) still exists and is still claimed —
 * it remains the atomic per-run reservation/locking primitive
 * claimPortAndReserve() uses to avoid two concurrent requests colliding,
 * see that method's docblock — but it no longer corresponds to anything
 * published on the host, so every call site that actually needs to reach
 * the running app (nginx's preview proxy, getBuildLog's port_ready check)
 * needs the container's *internal* listening port instead. That's this
 * column: the same value selectDockerImage() already computes and used to
 * feed straight into `-p {port}:{internalPort}` — now persisted so it
 * survives past the request that started the container.
 *
 * Nullable, same graceful-degradation precedent as container_name
 * (2026-08-09) and exec_secret (2026-08-11 earlier today): rows created
 * before this shipped simply have no way to resolve a preview link or a
 * container-name-based readiness probe until their next run.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->unsignedInteger('internal_port')->nullable()->after('port');
        });
    }

    public function down(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->dropColumn('internal_port');
        });
    }
};
