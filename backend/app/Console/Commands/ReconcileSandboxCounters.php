<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use App\Models\SandboxRun;
use App\Models\UsageCounter;

/**
 * FIX #12: one-off / on-demand repair for the counter-drift bug described
 * in ProjectController::runProject() (FIX #12 docblock) — a Pro user
 * stuck at "Sandbox limit reached" (usage == limit) with zero actual
 * containers running.
 *
 * The 'active_sandboxes' usage_counters row is an independently
 * incremented/decremented ledger, not a live count — it can drift upward
 * forever if a release() call is ever skipped (which FIX #12 closes going
 * forward, but doesn't retroactively fix any account already stuck today).
 *
 * This recomputes each affected user's counter from ground truth: open
 * SandboxRun rows whose container Docker actually reports as running.
 * Anything else — open rows with dead containers, or a counter value with
 * no open rows behind it at all — gets corrected to match reality.
 *
 * Usage:
 *   php artisan ubiq:reconcile-sandbox-counters             # all users
 *   php artisan ubiq:reconcile-sandbox-counters --user=123  # one user
 *   php artisan ubiq:reconcile-sandbox-counters --dry-run
 */
class ReconcileSandboxCounters extends Command
{
    protected $signature = 'ubiq:reconcile-sandbox-counters
                                {--user= : Limit to a single user ID}
                                {--dry-run : Show what would change without writing anything}';

    protected $description = 'Recompute active_sandboxes usage counters from real Docker state, fixing any drift.';

    public function handle(): int
    {
        $dryRun = $this->option('dry-run');
        $userId = $this->option('user');

        $counters = UsageCounter::query()
            ->where('counter_key', 'active_sandboxes')
            ->where('window_type', 'concurrent')
            ->when($userId, fn ($q) => $q->where('user_id', $userId))
            ->get();

        if ($counters->isEmpty()) {
            $this->info('No active_sandboxes counters found.');
            return self::SUCCESS;
        }

        $fixed = 0;

        foreach ($counters as $counter) {
            // Ground truth: open rows for this user whose container Docker
            // actually reports as running right now. Same check as
            // ProjectController::reapStaleSandboxes(), reused here for
            // consistency rather than trusting stopped_at alone (a row can
            // be "open" in the DB while its container is long dead).
            $openRuns = SandboxRun::where('user_id', $counter->user_id)
                ->whereNull('stopped_at')
                ->get();

            $trueCount = 0;
            foreach ($openRuns as $run) {
                $containerName = "ubiq_project_{$run->project_id}";
                $state = Process::run("docker inspect -f '{{.State.Running}}' {$containerName}");

                if (trim($state->output()) === 'true') {
                    $trueCount++;
                } else {
                    $this->line("  → closing dead row: project {$run->project_id} (user {$counter->user_id})");
                    if (!$dryRun) {
                        $run->update(['stopped_at' => now()]);
                    }
                }
            }

            if ($counter->count !== $trueCount) {
                $this->info("User {$counter->user_id}: counter={$counter->count}, actual running={$trueCount}" . ($dryRun ? ' (dry-run, not written)' : ' — correcting'));
                if (!$dryRun) {
                    $counter->update(['count' => $trueCount]);
                }
                $fixed++;
            }
        }

        $this->info($fixed > 0
            ? ($dryRun ? "{$fixed} counter(s) would be corrected." : "{$fixed} counter(s) corrected.")
            : 'All counters already match reality — nothing to fix.');

        return self::SUCCESS;
    }
}
