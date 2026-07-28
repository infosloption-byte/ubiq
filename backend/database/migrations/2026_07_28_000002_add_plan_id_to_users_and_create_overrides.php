<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Phase A2 — User/plan linkage.
 *
 * `subscription_tier` is kept for now (deprecated, not dropped) so the old
 * scattered checks keep working in parallel while PlanGuard is rolled out
 * action-by-action (see PLAN_SYSTEM_TASKS.md Phase B3). Drop it only in B4
 * once every controller reads from PlanGuard/PlanService instead.
 *
 * `user_plan_overrides` lets a specific user get a comped/adjusted limit
 * (e.g. extra sandboxes, waived cap) without inventing a fake plan for them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('plan_id')->nullable()->after('subscription_tier')
                ->constrained('plans')->nullOnDelete();
        });

        Schema::create('user_plan_overrides', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('feature_key');
            $table->string('override_value');
            $table->string('reason')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'feature_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_plan_overrides');

        Schema::table('users', function (Blueprint $table) {
            $table->dropForeign(['plan_id']);
            $table->dropColumn('plan_id');
        });
    }
};
