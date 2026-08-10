<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P0 fix (see UBIQ_ENHANCEMENT_ROADMAP.md, "concurrent sandbox slots leak
 * on every re-run" / PLAN_SYSTEM_TASKS.md F0b).
 *
 * Root cause being fixed: the Docker container name was
 * `ubiq_project_{$project->id}` — identical across every run of the same
 * project, with no run ID in it. reapStaleSandboxes() and the other
 * container-state checks had no way to tell an old SandboxRun row's
 * container apart from a brand-new run's container sharing the same name,
 * so a re-run's genuinely-alive new container made every check believe
 * the *old* row's container was still running too, and that row's
 * concurrent-sandbox slot never got released.
 *
 * container_name is now stamped once per run, immediately after the row
 * is created (see ProjectController::claimPortAndReserve()), as
 * "ubiq_project_{project_id}_run{run_id}" — unique per row by
 * construction. Nullable and left null on existing rows; every call site
 * that reads it falls back to the old project-scoped name for those
 * legacy rows (SandboxRun::getDockerNameAttribute()).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->string('container_name')->nullable()->after('port');
        });
    }

    public function down(): void
    {
        Schema::table('sandbox_runs', function (Blueprint $table) {
            $table->dropColumn('container_name');
        });
    }
};
