<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * URGENT — sandbox_runs was never actually migrated, ever, despite being
 * used throughout ProjectController (runProject, stopProject, destroy)
 * and CleanupSandboxes since before this session started. Confirmed via
 * grep: zero migrations, zero mentions in schema.sql. This was silently
 * breaking production: every project delete and every sandbox stop path
 * that touches this table threw a raw QueryException (caught by nothing,
 * surfacing as a generic 500 to the user — "Failed to delete project",
 * "Failed to start sandbox").
 *
 * Same bug pattern as google_id, the cache table, and storage columns
 * found earlier this session — a model existed and code assumed the
 * table existed, but no migration ever created it. Schema matches
 * SandboxRun model's own docblock exactly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sandbox_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('project_id')->constrained()->cascadeOnDelete();
            $table->string('ip_address')->nullable();
            $table->string('user_agent')->nullable();
            $table->timestamp('started_at');
            $table->timestamp('stopped_at')->nullable();
            $table->unsignedInteger('port')->nullable();
            $table->string('runtime')->nullable();
            $table->string('framework')->nullable();

            $table->index(['project_id', 'stopped_at']);
            $table->index(['user_id', 'stopped_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sandbox_runs');
    }
};
