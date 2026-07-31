<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * B4 — Backfill plan_id for every existing user based on their current
 * subscription_tier, so PlanService's subscription_tier fallback branch
 * becomes a defensive safety net rather than something actually load-bearing
 * for real traffic. New users get plan_id set explicitly at creation
 * (AuthController) and on every tier change (PayPalController webhook) —
 * this migration only needs to run once, for users who existed before B4.
 *
 * Deliberately NOT dropping subscription_tier in this migration — that's
 * a separate, later step once this has been live long enough to trust,
 * consistent with how every other "old field" retirement this session has
 * gone (deprecate/dual-write first, remove only once confirmed safe).
 */
return new class extends Migration
{
    public function up(): void
    {
        $plans = DB::table('plans')->pluck('id', 'key');

        foreach ($plans as $key => $planId) {
            DB::table('users')
                ->where('subscription_tier', $key)
                ->whereNull('plan_id')
                ->update(['plan_id' => $planId]);
        }

        // Anyone left with plan_id still null (subscription_tier had an
        // unexpected/legacy value, e.g. the old 'premium') falls back to
        // Free rather than staying unresolved.
        $freePlanId = $plans['free'] ?? null;
        if ($freePlanId !== null) {
            DB::table('users')->whereNull('plan_id')->update(['plan_id' => $freePlanId]);
        }
    }

    public function down(): void
    {
        // Intentionally a no-op — reverting this would set plan_id back to
        // null for users who may have had it set independently since, e.g.
        // via a manual admin change or a paid upgrade. Backfills aren't
        // safely reversible once real writes have happened on top of them.
    }
};
