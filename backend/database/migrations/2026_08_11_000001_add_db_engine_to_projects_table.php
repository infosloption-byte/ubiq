<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F1c (PLAN_SYSTEM_TASKS.md Phase F, roadmap section F1c — re-scoped
 * 2026-08-11 after the F1b compose-as-execution-engine attempt hit the
 * socket-proxy's NETWORKS:0 wall, see that decision-log entry for the
 * full story): opt-in real database service for a project's sandbox,
 * started as a second `docker run --network=ubiq_sandbox` alongside
 * the existing app container — same mechanism already in production
 * use, no Docker Networks/Volumes API calls either way.
 *
 * Nullable, defaults to null on every existing and new row — purely
 * additive. With `db_engine` null (the default), a project's sandbox
 * behaves exactly as before this migration: SQLite forced for Laravel
 * (see `defaultStartCommands()`'s Laravel branch), no `db` container
 * started at all. Only a project that explicitly opts in via
 * `PATCH /projects/{project}/db-engine` gets a `db` container and a
 * real MySQL/Postgres connection wired into its startup script.
 *
 * Scoped to Laravel only for this pass — the one framework with an
 * active hardcoded SQLite override to work around. See the
 * decision-log entry for why Django/others weren't touched here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('db_engine')->nullable()->after('storage_path');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('db_engine');
        });
    }
};
