<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\SandboxRun;
use App\Services\PlanGuard;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;

/**
 * Sandboxes — cross-project view over `sandbox_runs`.
 *
 * ProjectController already owns the full sandbox lifecycle
 * (run/stop/heartbeat, port allocation, reaping) scoped to a single
 * project at a time — this controller doesn't duplicate any of that.
 * It exists because there was previously no way for a user to see
 * *all* of their sandboxes (across every project) in one place, which
 * is what the new "Sandboxes" left-nav page needs: a live inventory of
 * what's running, what's stopped, and basic health/vitals for each,
 * with the ability to stop one from the list without opening its
 * project.
 *
 * `stop()` intentionally reuses the exact kill → verify → stamp →
 * release sequence `ProjectController::stopProject()` already
 * established (see that method's comments for why each step exists),
 * just keyed off a `SandboxRun` id instead of "the latest open run for
 * this project" — the list page operates on individual run rows, not
 * projects.
 */
class SandboxController extends Controller
{
    public function __construct(private PlanGuard $planGuard)
    {
    }

    /**
     * GET /sandboxes
     *
     * Returns every currently-open sandbox for the user (reconciled
     * against live Docker state, so a row that's open in the DB but
     * whose container actually died shows up as "crashed" rather than
     * silently claiming to be running), plus a short recent history of
     * stopped runs for context, plus the user's current usage vs. their
     * plan's concurrent-sandbox limit.
     */
    public function index(Request $request)
    {
        $user = $request->user();

        $openRuns = SandboxRun::with('project:id,name,language,source')
            ->where('user_id', $user->id)
            ->whereNull('stopped_at')
            ->orderByDesc('started_at')
            ->get();

        $recentStopped = SandboxRun::with('project:id,name,language,source')
            ->where('user_id', $user->id)
            ->whereNotNull('stopped_at')
            ->orderByDesc('stopped_at')
            ->limit(15)
            ->get();

        $sandboxes = $openRuns->map(function (SandboxRun $run) {
            $containerName = $run->docker_name;
            $health = $this->dockerHealth($containerName);

            // DB says "open" (no stopped_at yet) but Docker disagrees —
            // same class of drift reapStaleSandboxes() self-heals on the
            // next `run` click; here we just need to *report* it
            // honestly rather than showing a dead sandbox as running.
            $status = match (true) {
                $health['docker_status'] === 'running' => 'running',
                $health['docker_status'] === 'missing' => 'crashed',
                default => 'stopped',
            };

            $stats = $status === 'running' ? $this->dockerStats($containerName) : $this->emptyStats();

            return $this->formatSandbox($run, $status, $health, $stats);
        })->values();

        $history = $recentStopped->map(
            fn (SandboxRun $run) => $this->formatSandbox(
                $run,
                'stopped',
                ['docker_status' => 'missing', 'health' => null],
                $this->emptyStats()
            )
        )->values();

        return response()->json([
            'sandboxes' => $sandboxes,
            'history' => $history,
            'usage' => $this->planGuard->remaining($user, 'sandbox.start'),
        ]);
    }

    /**
     * POST /sandboxes/{sandboxRun}/stop
     *
     * Stops (and removes) the Docker container for a single sandbox
     * run, identified by its own id rather than "the project's latest
     * run" — the Sandboxes list can show runs for several projects at
     * once, so the action has to target the exact row the user clicked
     * stop on. Functionally identical to
     * `ProjectController::stopProject()`, just addressed differently;
     * see that method for the reasoning behind each step (force-remove
     * with `-f`, verify removal before stamping `stopped_at`, always
     * release the plan counter).
     */
    public function stop(Request $request, SandboxRun $sandboxRun)
    {
        if ($sandboxRun->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        if ($sandboxRun->stopped_at !== null) {
            return response()->json(['message' => 'Sandbox is already stopped.']);
        }

        $containerName = $sandboxRun->docker_name;

        // -f so this can never hang behind a graceful-stop timeout and
        // leave the port/slot held — same reasoning as stopProject().
        Process::run("docker rm -f {$containerName} 2>/dev/null || true");
        // F1c companion DB container — harmless no-op if this run never
        // had one.
        Process::run("docker rm -f {$containerName}-db 2>/dev/null || true");

        $stillThere = Process::run("docker ps -a --filter name=^/{$containerName}\$ --format '{{.Names}}'");
        if (trim($stillThere->output()) !== '') {
            Log::error("[Sandbox] SandboxController::stop failed to remove {$containerName} for run #{$sandboxRun->id}.");
            return response()->json(['error' => 'Could not stop the sandbox cleanly. Please try again.'], 500);
        }

        $sandboxRun->update(['stopped_at' => now()]);
        $this->planGuard->release($request->user(), 'active_sandboxes');

        return response()->json(['message' => 'Sandbox stopped and removed.']);
    }

    /**
     * Live Docker state for a container: is it actually running, and
     * (if the image defines one) what does its HEALTHCHECK report.
     * Returns 'missing' for docker_status when the container doesn't
     * exist at all (already removed, crashed and reaped, or the row
     * predates this project ever having run) — that maps to the
     * "crashed" status shown in the list rather than a raw error.
     */
    private function dockerHealth(string $containerName): array
    {
        $inspect = Process::run(
            "docker inspect -f '{{.State.Status}}|{{.State.Health.Status}}' {$containerName} 2>/dev/null"
        );
        $output = trim($inspect->output());

        if ($output === '' || !$inspect->successful()) {
            return ['docker_status' => 'missing', 'health' => null];
        }

        [$status, $health] = array_pad(explode('|', $output, 2), 2, null);

        return [
            'docker_status' => $status ?: 'unknown',
            // Containers without a HEALTHCHECK report the literal
            // string "<no value>" from the Go template — normalize
            // that to null rather than showing it to the user.
            'health' => ($health && $health !== '<no value>') ? $health : null,
        ];
    }

    /**
     * Point-in-time resource usage for a running container. `docker
     * stats --no-stream` blocks for one sampling interval per call
     * (~1-2s) rather than streaming, which is the right trade-off here
     * — this only runs for containers already confirmed `running`, and
     * the list is a handful of rows at most (global sandbox concurrency
     * is capped around 3, see PlanGuard's SANDBOX_GLOBAL_CONCURRENT_LIMIT).
     */
    private function dockerStats(string $containerName): array
    {
        $stats = Process::timeout(5)->run(
            "docker stats {$containerName} --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}' 2>/dev/null"
        );
        $output = trim($stats->output());

        if ($output === '') {
            return $this->emptyStats();
        }

        [$cpu, $mem, $memPct, $net] = array_pad(explode('|', $output, 4), 4, null);

        return [
            'cpu_percent' => $cpu,
            'mem_usage' => $mem,
            'mem_percent' => $memPct,
            'net_io' => $net,
        ];
    }

    private function emptyStats(): array
    {
        return [
            'cpu_percent' => null,
            'mem_usage' => null,
            'mem_percent' => null,
            'net_io' => null,
        ];
    }

    private function formatSandbox(SandboxRun $run, string $status, array $health, array $stats): array
    {
        return [
            'id' => $run->id,
            'project_id' => $run->project_id,
            'project_name' => $run->project?->name ?? 'Deleted project',
            'project_language' => $run->project?->language,
            'status' => $status, // running | stopped | crashed
            'runtime' => $run->runtime,
            'framework' => $run->framework,
            'port' => $run->port,
            'container_name' => $run->docker_name,
            'started_at' => $run->started_at,
            'stopped_at' => $run->stopped_at,
            'heartbeat_at' => $run->heartbeat_at,
            'duration_seconds' => $run->duration_seconds,
            'docker_status' => $health['docker_status'],
            'health' => $health['health'],
            'cpu_percent' => $stats['cpu_percent'],
            'mem_usage' => $stats['mem_usage'],
            'mem_percent' => $stats['mem_percent'],
            'net_io' => $stats['net_io'],
        ];
    }
}
