<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;
use App\Models\SandboxRun;

class CleanupSandboxes extends Command
{
    protected $signature   = 'ubiq:cleanup-sandboxes
                                {--dry-run : List containers that would be stopped without stopping them}
                                {--hours=2 : Stop containers running longer than this many hours}';

    protected $description = 'Stop Docker sandbox containers that have been running too long or were abandoned.';

    public function handle(): int
    {
        $hours  = (int) $this->option('hours');
        $dryRun = $this->option('dry-run');
        $cutoff = now()->subHours($hours);

        // Find audit rows that are still open (stopped_at IS NULL) and
        // started more than $hours ago. These are orphaned containers —
        // the user closed their browser without stopping the sandbox.
        $stale = SandboxRun::whereNull('stopped_at')
            ->where('started_at', '<', $cutoff)
            ->get();

        if ($stale->isEmpty()) {
            $this->info("No stale sandboxes found (cutoff: {$hours}h).");
            return self::SUCCESS;
        }

        $this->info("Found {$stale->count()} stale sandbox(es) older than {$hours}h:");

        foreach ($stale as $run) {
            $containerName = "ubiq_project_{$run->project_id}";
            $age           = $run->started_at->diffForHumans(now(), true);

            $this->line("  → {$containerName} (project {$run->project_id}, running {$age})");

            if ($dryRun) {
                continue;
            }

            // Stop and remove the container.
            // We don't check success — the container may already be stopped
            // (crashed, OOM-killed, etc.). Either way we stamp stopped_at.
            Process::run("docker stop {$containerName}");
            Process::run("docker rm   {$containerName}");

            $run->update(['stopped_at' => now()]);

            $this->line("    Stopped and stamped.");
        }

        if ($dryRun) {
            $this->warn("Dry run — no containers were stopped.");
        } else {
            $this->info("Done. {$stale->count()} container(s) cleaned up.");
        }

        return self::SUCCESS;
    }
}