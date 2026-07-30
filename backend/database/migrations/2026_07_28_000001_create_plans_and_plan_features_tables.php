<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase A1 — Core plan tables.
 *
 * `plans` is the source of truth for tiers (free/starter/creator/pro).
 * `plan_features` is an EAV-style table so limits are fully DB-editable —
 * adding a brand new limit type later is an INSERT, not a migration.
 *
 * feature_key vocabulary (keep this list in sync with PlanGuard action keys):
 *   sandbox.max_concurrent      (int)
 *   sandbox.cpu                 (string, e.g. "0.75")
 *   sandbox.memory_mb           (int)
 *   sandbox.idle_timeout_minutes(int)
 *   ai.requests_per_hour        (int)
 *   ai.requests_per_day         (int)
 *   ai.max_model_tier           (string, matches available_models.tier_required)
 *   projects.max_count          (int)
 *   sharing.enabled             (bool)
 *   storage.max_mb              (int) — added Phase B3c, alongside projects.max_count
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('key')->unique(); // free | starter | creator | pro
            $table->string('name');
            $table->unsignedInteger('price_cents')->default(0);
            $table->string('currency', 3)->default('USD');
            $table->string('billing_interval')->default('month'); // month | year
            $table->string('paypal_plan_id')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        Schema::create('plan_features', function (Blueprint $table) {
            $table->id();
            $table->foreignId('plan_id')->constrained()->cascadeOnDelete();
            $table->string('feature_key');
            $table->string('feature_value'); // cast on read using value_type
            $table->enum('value_type', ['int', 'bool', 'string'])->default('string');
            $table->timestamps();

            $table->unique(['plan_id', 'feature_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('plan_features');
        Schema::dropIfExists('plans');
    }
};
