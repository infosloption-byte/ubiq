<?php

namespace App\Console\Commands;

use App\Models\Plan;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * C4 — This closes a real gap: PayPalController's cancel() comment said
 * "a scheduled task / next login check should downgrade once
 * subscription_ends_at has passed" — but that task never actually existed
 * anywhere in the codebase (confirmed via grep before writing this).
 *
 * PayPal's cancel API is terminal — once a subscription is cancelled via
 * cancelSubscription(), PayPal does NOT send a further EXPIRED webhook
 * once the grace period lapses, unlike a subscription that naturally
 * fails through retried payments (which DOES eventually fire its own
 * webhook and gets handled by applySubscriptionState). Without this
 * command, a canceled user's subscription_tier/plan_id stays at their old
 * paid tier forever.
 */
class DowngradeExpiredSubscriptions extends Command
{
    protected $signature = 'ubiq:downgrade-expired-subscriptions {--dry-run}';

    protected $description = 'Downgrade users whose canceled subscription grace period has ended to the Free plan.';

    public function handle(): int
    {
        $dryRun = $this->option('dry-run');
        $freePlan = Plan::where('key', 'free')->first();

        if (!$freePlan) {
            $this->error('No Free plan found — cannot downgrade anyone. Check the plans table.');
            return self::FAILURE;
        }

        $expired = User::where('subscription_status', 'canceled')
            ->where('subscription_ends_at', '<', now())
            ->where(function ($q) use ($freePlan) {
                $q->where('plan_id', '!=', $freePlan->id)->orWhereNull('plan_id');
            })
            ->get();

        if ($expired->isEmpty()) {
            $this->info('No expired canceled subscriptions to downgrade.');
            return self::SUCCESS;
        }

        $this->info("Found {$expired->count()} user(s) to downgrade:");

        foreach ($expired as $user) {
            $this->line("  → User {$user->id} ({$user->email}): {$user->subscription_tier} → free, grace period ended {$user->subscription_ends_at}");

            if ($dryRun) {
                continue;
            }

            $user->update([
                'subscription_tier' => 'free',
                'plan_id'            => $freePlan->id,
            ]);

            Log::info("[Billing] User {$user->id} downgraded to free — canceled subscription's grace period ended at {$user->subscription_ends_at}");
        }

        if ($dryRun) {
            $this->warn('Dry run — no users were actually downgraded.');
        } else {
            $this->info("Done. {$expired->count()} user(s) downgraded to Free.");
        }

        return self::SUCCESS;
    }
}
