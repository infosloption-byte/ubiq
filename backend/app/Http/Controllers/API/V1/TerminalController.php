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

        // F0d: `docker exec` used to run here, but FIX #9's socket-proxy
        // rejects it for every container by design (EXEC:0 in
        // docker-compose.yml) — that's the actual root cause of the
        // "Terminal panel doesn't run anything" report this fixes.
        // Widening the proxy back to a global exec capability would undo
        // exactly what FIX #9 was for: a compromised Laravel process
        // would inherit exec-into-anything rather than exec-into-nothing.
        //
        // Instead, this talks directly to a tiny listener running inside
        // that one container (started in generateStartupScript()'s exec-
        // listener snippet), reached over the internal `ubiq_sandbox`
        // network by container name — never through the Docker API, so
        // the proxy's EXEC setting has no bearing on it either way. The
        // listener only executes what it receives if the request also
        // carries this run's own `exec_secret` (generated once in
        // claimPortAndReserve(), injected into the container as
        // UBIQ_EXEC_SECRET, never sent to the frontend — see
        // SandboxRun::$hidden). Any other container reachable on that
        // same shared bridge network — true of every sandbox today, not
        // a new exposure this introduces — can open a TCP connection to
        // this port too, but can't get it to run anything without also
        // knowing that per-run secret.
        if (empty($openRun->exec_secret)) {
            // Only possible for a run started before this migration
            // shipped — nothing to authenticate with, and no way to
            // retrofit a secret into an already-running container's env.
            return response()->json([
                'output' => "This sandbox was started before the Terminal panel's exec listener existed. Click RESTART to pick up the new one, then try again.",
            ], 409);
        }

        $socket = @fsockopen($containerName, 7411, $errno, $errstr, 2.0);
        if (!$socket) {
            // Most likely `apk add socat` failed inside the container
            // (transient registry issue, non-fatal by design — see the
            // startup-script snippet) or the listener hasn't finished
            // booting yet immediately after RUN. Either way this is a
            // clean, actionable failure, not a raw connection error.
            Log::warning("[Terminal] Could not reach exec listener for {$containerName} ({$errno}: {$errstr}).");
            return response()->json([
                'output' => "Couldn't reach this sandbox's terminal listener. If the sandbox just started, wait a few seconds and try again; otherwise click RESTART.",
            ], 409);
        }

        stream_set_timeout($socket, 60);
        fwrite($socket, $openRun->exec_secret . "\n");
        fwrite($socket, base64_encode($command) . "\n");

        $output = '';
        while (!feof($socket)) {
            $chunk = fread($socket, 8192);
            if ($chunk === false) {
                break;
            }
            $output .= $chunk;
        }
        $meta = stream_get_meta_data($socket);
        fclose($socket);

        if ($meta['timed_out']) {
            return response()->json([
                'output' => rtrim($output) . "\n[Ubiq] Command timed out after 60s.",
            ]);
        }

        return response()->json([
            'output' => $output !== '' ? $output : ""
        ]);
    }
}
