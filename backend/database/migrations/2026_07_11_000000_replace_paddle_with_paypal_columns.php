<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Paddle → PayPal migration.
 *
 * `paddle_id` was referenced in User::$fillable and PaddleWebhookListener but
 * was NEVER actually created by any prior migration — so the Paddle webhook
 * path has never worked end-to-end. No real subscriber data exists to migrate.
 *
 * This adds the columns the app actually needs going forward:
 *   - paypal_subscription_id : PayPal's subscription ID (I-XXXXXXXXXXXX)
 *   - subscription_status    : active | trialing | past_due | canceled | suspended | expired
 *   - trial_ends_at           : when the free trial ends (if applicable)
 *   - subscription_ends_at    : end of current paid period / access cutoff after cancellation
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'paypal_subscription_id')) {
                $table->string('paypal_subscription_id')->nullable()->unique()->after('subscription_tier');
            }
            if (!Schema::hasColumn('users', 'subscription_status')) {
                $table->string('subscription_status')->nullable()->after('paypal_subscription_id');
            }
            if (!Schema::hasColumn('users', 'trial_ends_at')) {
                $table->timestamp('trial_ends_at')->nullable()->after('subscription_status');
            }
            if (!Schema::hasColumn('users', 'subscription_ends_at')) {
                $table->timestamp('subscription_ends_at')->nullable()->after('trial_ends_at');
            }
        });

        // paddle_id was never created by any migration, but drop it defensively
        // in case it was added by hand on any environment.
        if (Schema::hasColumn('users', 'paddle_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('paddle_id');
            });
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['paypal_subscription_id', 'subscription_status', 'trial_ends_at', 'subscription_ends_at']);
        });
    }
};