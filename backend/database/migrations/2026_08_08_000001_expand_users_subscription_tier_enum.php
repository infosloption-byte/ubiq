<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * E2a (PLAN_SYSTEM_TASKS.md Phase E) — CRITICAL, latent production bug.
 *
 * users.subscription_tier has been ENUM('free','pro') since
 * 2025_02_01_000000_fix_subscription_tier_enum, and was never widened when
 * the 4-tier Plan system landed — unlike available_models.tier_required,
 * which WAS expanded for the same reason in
 * 2026_07_30_000001_expand_available_models_tier_enum.
 *
 * PayPalController::applySubscriptionState() already writes
 * `$targetPlan->key` into this column, which can be 'starter' or
 * 'creator' — values this enum has never accepted. While neither plan has
 * a real `paypal_plan_id` configured yet, the plan-resolution logic there
 * always falls back to 'free' before that write happens, so this hasn't
 * surfaced yet. The moment a real Starter/Creator PayPal plan ID is
 * configured, a successful PayPal payment would hit this enum constraint
 * on the very next `$user->update([...])` — either throwing outright
 * (strict SQL mode) or truncating to an allowed value silently, in both
 * cases leaving a paying customer without the tier they paid for.
 *
 * Same raw-ALTER approach as the available_models migration — MySQL can't
 * modify an enum via Schema::table without doctrine/dbal installed.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE users MODIFY COLUMN subscription_tier ENUM('free','starter','creator','pro') NOT NULL DEFAULT 'free'");
    }

    public function down(): void
    {
        // Same safety pattern as the available_models rollback: collapse
        // anything the narrower enum can't represent to 'pro' first, so
        // shrinking the enum back never fails on existing rows.
        DB::statement("UPDATE users SET subscription_tier = 'pro' WHERE subscription_tier NOT IN ('free','pro')");
        DB::statement("ALTER TABLE users MODIFY COLUMN subscription_tier ENUM('free','pro') NOT NULL DEFAULT 'free'");
    }
};
