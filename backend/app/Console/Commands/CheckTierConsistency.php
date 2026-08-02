<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Run this periodically before actually dropping subscription_tier
 * (deliberately NOT dropped yet — see PLAN_SYSTEM_TASKS.md B4). If this
 * reports zero mismatches for a couple of weeks of real traffic, that's
 * the actual evidence needed to drop the column with confidence, rather
 * than dropping it on a deadline and hoping.
 */
class CheckTierConsistency extends Command
{
    protected $signature = 'ubiq:check-tier-consistency';

    protected $description = 'Check for any drift between users.subscription_tier and users.plan_id (via plans.key).';

    public function handle(): int
    {
        $mismatches = User::with('plan')
            ->whereNotNull('plan_id')
            ->get()
            ->filter(fn ($user) => $user->plan && $user->plan->key !== $user->subscription_tier);

        $nullPlanCount = User::whereNull('plan_id')->count();

        if ($mismatches->isEmpty() && $nullPlanCount === 0) {
            $this->info('✓ No drift found. subscription_tier and plan_id agree for every user, and every user has a plan_id set.');
            return self::SUCCESS;
        }

        if ($nullPlanCount > 0) {
            $this->warn("{$nullPlanCount} user(s) still have plan_id = NULL. These fall back to subscription_tier via PlanService — not broken, but worth backfilling if this number isn't shrinking.");
        }

        if ($mismatches->isNotEmpty()) {
            $this->error("Found {$mismatches->count()} user(s) where plan_id's plan.key disagrees with subscription_tier:");
            $this->table(
                ['User ID', 'Email', 'subscription_tier', 'plan.key'],
                $mismatches->map(fn ($u) => [$u->id, $u->email, $u->subscription_tier, $u->plan->key])
            );
        }

        return self::FAILURE;
    }
}
