<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase A4 — Audit log.
 *
 * Every PlanGuard check/authorize call — allowed or denied — writes one row
 * here. This is what lets us later answer "how often does Creator tier
 * actually hit its AI limit" for the 60-day pricing revisit, and is also the
 * first thing to check when a user says "my action failed and I don't know
 * why."
 *
 * Written asynchronously (queued) so logging never blocks the guarded
 * request itself.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plan_action_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('plan_id_at_time')->nullable()->constrained('plans')->nullOnDelete();
            $table->string('action_key'); // e.g. sandbox.start, ai.completion, model.access, project.create, sharing.enable
            $table->boolean('allowed');
            $table->string('limit_value')->nullable();
            $table->string('current_usage')->nullable();
            $table->string('reason')->nullable(); // e.g. concurrent_limit_exceeded, plan_lookup_failed
            $table->json('metadata')->nullable(); // e.g. requested model, requested sandbox resources
            $table->timestamp('created_at')->nullable();

            $table->index(['user_id', 'created_at']);
            $table->index(['action_key', 'allowed', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_action_logs');
    }
};
