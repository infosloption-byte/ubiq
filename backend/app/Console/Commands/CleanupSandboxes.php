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
                                {--hours= : Override — stop ALL open sandboxes older than this many hours, ignoring each user\'s plan-specific idle timeout. Omit to use per-tier sandbox.idle_timeout_minutes instead.}
                                {--abandoned-minutes=2 : Also stop any open sandbox whose last heartbeat is older than this many minutes, regardless of tier idle timeout. Set to 0 to disable this check.}';

    protected $description = 'Stop Docker sandbox containers that have been idle past their plan\'s timeout, past an explicit --hours override, or abandoned (no heartbeat) past --abandoned-minutes.';

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

        // FIX #11: abandoned-minutes catches tabs/laptops that vanished
        // (sleep, dropped network, crash) without a clean beforeunload or
        // React-unmount firing — see useSandboxAutoStop.ts. This runs
        // independently of, and typically much faster than, the per-tier
        // idle timeout below, which is for sandboxes that are still open
        // and heartbeating but genuinely unused. Rows written before the
        // heartbeat_at migration have heartbeat_at = null and are simply
        // skipped by this check (they still fall through to the timeout
        // check below via started_at).
        $abandonedMinutes = (int) $this->option('abandoned-minutes');

        $stale = $open->filter(function ($run) use ($overrideMinutes, $abandonedMinutes) {
            if ($abandonedMinutes > 0 && $run->heartbeat_at && $run->heartbeat_at->lt(now()->subMinutes($abandonedMinutes))) {
                return true;
            }

            $idleMinutes = $overrideMinutes
                ?? (int) ($this->planService->limitFor($run->user, 'sandbox.idle_timeout_minutes') ?? 20);

            return $run->started_at->lt(now()->subMinutes($idleMinutes));
        });

        if ($stale->isEmpty()) {
            $this->info($hasOverride
                ? "No sandboxes found older than {$this->option('hours')}h."
                : 'No sandboxes have exceeded their plan\'s idle timeout or gone quiet on heartbeat.');
            return self::SUCCESS;
        }

        $this->info("Found {$stale->count()} stale sandbox(es):");

        foreach ($stale as $run) {
            // P0 fix (F0b): use this run's own container name (falls back
            // to the old project-scoped name for pre-migration rows via
            // the docker_name accessor) — otherwise this cron could kill
            // a *different*, currently-active run of the same project
            // that happens to share the old naming scheme.
            $containerName = $run->docker_name;
            $age           = $run->started_at->diffForHumans(now(), true);
            $tierNote      = $run->user
                ? ' (plan: ' . (optional($this->planService->planFor($run->user))->key ?? 'unknown') . ')'
                : '';

            $this->line("  → {$containerName} (project {$run->project_id}, running {$age}{$tierNote})");

            if ($dryRun) {
                continue;
            }

            // Force-remove the container. -f skips a graceful-stop attempt
            // (and the hang that comes with trying to gracefully stop a
            // container that's already crashed/OOM-killed) and guarantees
            // the host port is released.
            //
            // FIX #13: this used to stamp stopped_at unconditionally,
            // treating "already gone" and "rm silently failed" the same
            // way. That's exactly how an orphaned container (still holding
            // its host port) can end up with zero record anywhere in
            // sandbox_runs — the row says stopped, the container doesn't
            // know that. Now we verify removal actually took before
            // closing the row; if it didn't, we leave the row open (still
            // charged against the user's counter, still visible here on
            // the next cron pass) rather than silently losing track of it.
            Process::run("docker rm -f {$containerName} 2>/dev/null || true");
            // F1c (PLAN_SYSTEM_TASKS.md Phase F): same no-op-if-absent
            // companion removal every other cleanup site has — this cron
            // doesn't know (or need to know) whether this particular run
            // ever had a db container.
            Process::run("docker rm -f {$containerName}-db 2>/dev/null || true");

            $stillThere = Process::run("docker ps -a --filter name=^/{$containerName}\$ --format '{{.Names}}'");
            if (trim($stillThere->output()) !== '') {
                $this->error("  ✗ Failed to remove {$containerName} — leaving run #{$run->id} open. Manual cleanup needed: docker rm -f {$containerName}");
                continue;
            }

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
