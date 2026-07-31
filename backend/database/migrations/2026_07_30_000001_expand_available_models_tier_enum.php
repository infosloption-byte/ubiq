<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * B3d — available_models.tier_required was ENUM('free','pro') only, and
 * (confirmed via grep before writing this) the table was never actually
 * seeded or queried anywhere in the app — dead schema. This expands the
 * enum to the full 4-tier vocabulary so AvailableModelSeeder can populate
 * it meaningfully, ahead of CompletionController actually enforcing it via
 * PlanGuard's 'model.access' action.
 *
 * Raw ALTER (MySQL doesn't support modifying an enum via Schema::table
 * column changes without doctrine/dbal) — same approach as the earlier
 * fix_subscription_tier_enum migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE available_models MODIFY COLUMN tier_required ENUM('free','starter','creator','pro') NOT NULL DEFAULT 'free'");
    }

    public function down(): void
    {
        // Anything not 'free' or 'pro' collapses to 'pro' on rollback so no
        // row ends up with a value the narrower enum can't represent.
        DB::statement("UPDATE available_models SET tier_required = 'pro' WHERE tier_required NOT IN ('free','pro')");
        DB::statement("ALTER TABLE available_models MODIFY COLUMN tier_required ENUM('free','pro') NOT NULL DEFAULT 'free'");
    }
};
