<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * FIX A: subscription_tier ENUM mismatch.
 *
 * The original migration defined the column as ENUM('free', 'premium'),
 * but the entire codebase writes 'pro' — PaddleWebhookListener, CheckSubscription,
 * ProjectController, and the frontend all use 'pro'. SQLite silently accepts
 * any value so it works in dev, but MySQL enforces ENUMs strictly and will
 * silently reject every subscription activation with a constraint error.
 *
 * This migration:
 *   1. Updates any existing 'premium' rows to 'pro' (data safety).
 *   2. Changes the column definition to ENUM('free', 'pro').
 *
 * For SQLite (dev): column type changes are emulated via table rebuild — Laravel
 * handles this automatically when doctrine/dbal is installed.
 * For MySQL (production): ALTER TABLE modifies the enum in place.
 */
return new class extends Migration
{
    public function up(): void
    {
        // Step 1: Migrate any legacy 'premium' values to 'pro' before changing the enum.
        // This must run before the column type change or MySQL will reject the update.
        DB::table('users')
            ->where('subscription_tier', 'premium')
            ->update(['subscription_tier' => 'pro']);

        // Step 2: Change the enum definition.
        // Using a raw statement because Laravel's Blueprint::enum() on an existing
        // column requires dropping/recreating on some drivers. The raw ALTER is
        // more reliable across MySQL versions.
        $driver = DB::getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE users MODIFY COLUMN subscription_tier ENUM('free', 'pro') NOT NULL DEFAULT 'free'");
        } else {
            // SQLite / testing: use Schema builder (doctrine/dbal handles emulation)
            Schema::table('users', function (Blueprint $table) {
                $table->enum('subscription_tier', ['free', 'pro'])->default('free')->change();
            });
        }
    }

    public function down(): void
    {
        // Revert 'pro' back to 'premium' in data first
        DB::table('users')
            ->where('subscription_tier', 'pro')
            ->update(['subscription_tier' => 'premium']);

        $driver = DB::getDriverName();

        if ($driver === 'mysql' || $driver === 'mariadb') {
            DB::statement("ALTER TABLE users MODIFY COLUMN subscription_tier ENUM('free', 'premium') NOT NULL DEFAULT 'free'");
        } else {
            Schema::table('users', function (Blueprint $table) {
                $table->enum('subscription_tier', ['free', 'premium'])->default('free')->change();
            });
        }
    }
};