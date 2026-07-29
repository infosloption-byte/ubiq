<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use App\Models\SandboxRun;
use App\Services\PlanGuard;
use App\Services\PlanService;

class CleanupSandboxes extends Command
{
    protected $signature   = 'ubiq:cleanup-sandboxes
                                {--dry-run : List containers that would be stopped without stopping them}
                                {--hours= : Override — stop ALL open sandboxes older than this many hours, ignoring each user\'s plan-specific idle timeout. Omit to use per-tier sandbox.idle_timeout_minutes instead.}';

    protected $description = 'Stop Docker sandbox containers that have been idle past their plan\'s timeout, or past an explicit --hours override.';

    public function __construct(private PlanGuard $planGuard, private PlanService $planService)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $dryRun = $this->option('dry-run');

        // --hours, when explicitly passed, is a flat manual override
        // (e.g. an emergency sweep) that ignores per-tier timeouts
        // entirely. Without it, each open sandbox is checked against its
        // OWNER's plan.sandbox.idle_timeout_minutes — this is what makes
        // the timeout actually tier-aware instead of one flat number for
        // every user regardless of plan.
        $hasOverride = $this->input->hasParameterOption('--hours');
        $overrideMinutes = $hasOverride ? ((int) $this->option('hours')) * 60 : null;

        // Table stays small — global concurrency is capped at ~2-3
        // sandboxes total across the whole box (see capacity analysis in
        // PLAN_SYSTEM_TASKS.md) — so a full scan of open rows is cheap and
        // avoids having to pre-guess a query-level cutoff before we know
        // each row's owner's specific limit.
        $open = SandboxRun::with('user')
            ->whereNull('stopped_at')
            ->get();

        $stale = $open->filter(function ($run) use ($overrideMinutes) {
            $idleMinutes = $overrideMinutes
                ?? (int) ($this->planService->limitFor($run->user, 'sandbox.idle_timeout_minutes') ?? 20);

            return $run->started_at->lt(now()->subMinutes($idleMinutes));
        });

        if ($stale->isEmpty()) {
            $this->info($hasOverride
                ? "No sandboxes found older than {$this->option('hours')}h."
                : 'No sandboxes have exceeded their plan\'s idle timeout.');
            return self::SUCCESS;
        }

        $this->info("Found {$stale->count()} stale sandbox(es):");

        foreach ($stale as $run) {
            $containerName = "ubiq_project_{$run->project_id}";
            $age           = $run->started_at->diffForHumans(now(), true);
            $tierNote      = $run->user
                ? ' (plan: ' . (optional($this->planService->planFor($run->user))->key ?? 'unknown') . ')'
                : '';

            $this->line("  → {$containerName} (project {$run->project_id}, running {$age}{$tierNote})");

            if ($dryRun) {
                continue;
            }

            // Stop and remove the container.
            // We don't check success — the container may already be stopped
            // (crashed, OOM-killed, etc.). Either way we stamp stopped_at.
            Process::run("docker stop {$containerName}");
            Process::run("docker rm   {$containerName}");

            $run->update(['stopped_at' => now()]);

            if ($run->user) {
                $this->planGuard->release($run->user, 'active_sandboxes');
            }

            $this->line("    Stopped and stamped.");
        }

        if ($dryRun) {
            $this->warn('Dry run — no containers were stopped.');
        } else {
            $this->info("Done. {$stale->count()} container(s) cleaned up.");
        }

        return self::SUCCESS;
    }
}
