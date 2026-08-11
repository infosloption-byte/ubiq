<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Project;
use App\Models\SandboxRun;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Log;

class TerminalController extends Controller
{
    public function execute(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $request->validate([
            'command' => 'required|string|max:1000',
        ]);

        $command = $request->command;

        // ── Server-side blocklist ─────────────────────────────────────────────
        // Mirrors the frontend list but enforced here so HTTP clients that
        // bypass the UI cannot execute destructive commands.
        $blocked = [
            'rm -rf /',
            'rm -rf /*',
            'mkfs',
            ':(){:|:&};:',
            'dd if=/dev/zero',
            'dd if=/dev/urandom',
            '> /dev/sda',
            'chmod -R 777 /',
            'shutdown',
            'reboot',
            'halt',
            'init 0',
            'kill -9 -1',
        ];

        $normalised = strtolower(trim($command));
        foreach ($blocked as $pattern) {
            if (str_contains($normalised, strtolower($pattern))) {
                return response()->json([
                    'output' => "Command blocked for safety: {$command}"
                ], 422);
            }
        }
        // ── End blocklist ─────────────────────────────────────────────────────

        // Bug fix (2026-08-11, PLAN_SYSTEM_TASKS.md Phase F): this used to
        // hardcode `"ubiq_project_{$project->id}"`, the container-naming
        // scheme that predates the F0/P0 concurrent-slot-leak fix
        // (2026-08-09). Every other call site that needs a specific run's
        // container name was switched over to `SandboxRun::docker_name`
        // at that time (see ProjectController::runProject,
        // reapStaleSandboxes, stopProject, destroy, getBuildLog) — this
        // controller was missed, so it was checking for a container name
        // that no longer exists for any project run after that fix
        // shipped, always reporting "No such container" even while the
        // real, run-scoped container was live and serving.
        $openRun = SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->latest('id')
            ->first();

        if (!$openRun) {
            return response()->json([
                'output' => "No sandbox is currently running for this project. Click RUN to start one, then try again.",
            ], 409);
        }

        $containerName = $openRun->docker_name;

        // Confirm the container this run row points at is actually alive
        // right now — a `SandboxRun` can still be "open" (no stopped_at)
        // if the container crashed or was reaped outside the normal
        // stop path. Deliberately NOT auto-healing this by booting a
        // replacement container here: that used to be this controller's
        // own separate, out-of-date reimplementation of sandbox startup
        // (generic base images, no Dockerfile, no framework detection,
        // no SandboxRun bookkeeping) — exactly the kind of second,
        // drifting copy of boot logic that caused this bug in the first
        // place. Startup belongs to ProjectController::runProject() alone;
        // this just tells the user to use RESTART so that stays true.
        $check = Process::run("docker ps -q -f name=" . escapeshellarg('^/' . $containerName . '$'));
        if (empty(trim($check->output()))) {
            return response()->json([
                'output' => "Sandbox container '{$containerName}' isn't running (it may have crashed or been stopped outside the editor). Click RESTART to bring it back up, then try again.",
            ], 409);
        }

        // Execute the command inside the confirmed-live, run-scoped container.
        // 'sh -c' allows piping, variable expansion, and combined commands.
        $execCmd = "docker exec -w /app " . escapeshellarg($containerName) . " sh -c " . escapeshellarg($command . " 2>&1");

        $result = Process::timeout(60)->run($execCmd);

        return response()->json([
            'output' => $result->output() ?: $result->errorOutput() ?: ""
        ]);
    }
}
