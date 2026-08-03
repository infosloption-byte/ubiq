<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Audit log for every sandbox container run (SandboxRun model).
 * $timestamps = false on the model — started_at/stopped_at are managed
 * manually, so this table intentionally has no created_at/updated_at.
 * Previously referenced by ProjectController with no migration ever
 * creating the table — this fills that gap.
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
            $table->string('user_agent', 500)->nullable();
            $table->timestamp('started_at');
            $table->timestamp('stopped_at')->nullable();
            $table->unsignedInteger('port')->nullable();
            $table->string('runtime')->nullable();
            $table->string('framework')->nullable();

            $table->index(['project_id', 'stopped_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sandbox_runs');
    }
};
