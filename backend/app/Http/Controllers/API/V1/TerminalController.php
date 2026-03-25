<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Project;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\File;
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

        $containerName = "ubiq_project_{$project->id}";
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

        // 1. Check if container is running
        $check = Process::run("docker ps -q -f name={$containerName}");
        
        // --- AUTO-HEALING: Start Container if Missing ---
        if (empty(trim($check->output()))) {
            $this->startContainer($project, $containerName);
            
            // Wait up to 5 seconds for the container to be ready
            for ($i = 0; $i < 10; $i++) {
                usleep(500000); // 0.5s
                $checkRetry = Process::run("docker ps -q -f name={$containerName}");
                if (!empty(trim($checkRetry->output()))) break;
            }
        }

        // 2. Execute Command
        // We use 'sh -c' to allow piping, variable expansion, and combined commands
        $execCmd = "docker exec -w /app {$containerName} sh -c " . escapeshellarg($command . " 2>&1");
        
        $result = Process::timeout(60)->run($execCmd);

        return response()->json([
            'output' => $result->output() ?: $result->errorOutput() ?: ""
        ]);
    }

    /**
     * Helper to auto-boot the container if it crashed or stopped.
     * Logic mirrors ProjectController::runProject
     */
    // private function startContainer(Project $project, string $containerName)
    // {
    //     $baseHostPath = env('HOST_WORKSPACE_PATH', '/home/ubuntu/ubiq/backend/storage/app/workspaces');
    //     $hostMountPath = $baseHostPath . "/{$project->user_id}/{$project->id}";
    //     $workspacePath = storage_path("app/workspaces/{$project->user_id}/{$project->id}");

    //     // 1. Detect Runtime
    //     $runtime = 'static';
    //     if (File::exists($workspacePath . '/ubiq.json')) {
    //         $config = json_decode(file_get_contents($workspacePath . '/ubiq.json'), true);
    //         $runtime = $config['runtime'] ?? 'static';
    //     }

    //     // Auto-detect override
    //     if (File::exists($workspacePath . '/package.json')) $runtime = 'node';
    //     elseif (File::exists($workspacePath . '/composer.json') || File::exists($workspacePath . '/artisan')) $runtime = 'php';
    //     elseif (File::exists($workspacePath . '/requirements.txt') || File::exists($workspacePath . '/main.py')) $runtime = 'python';

    //     // 2. Cleanup Old
    //     Process::run("docker stop {$containerName}");
    //     Process::run("docker rm {$containerName}");

    //     // 3. Start Command
    //     $port = 8000 + ($project->id % 1000); 
    //     $cmd = "";

    //     if ($runtime === 'node') {
    //         $cmd = "docker run -d --name {$containerName} -p {$port}:5173 -v " . escapeshellarg($hostMountPath) . ":/app -w /app node:20-alpine sh -c 'npm install && npm run dev -- --host 0.0.0.0'";
    //     } elseif ($runtime === 'php') {
    //         $cmd = "docker run -d --name {$containerName} -p {$port}:8000 -v " . escapeshellarg($hostMountPath) . ":/app -w /app composer:2.7 sh -c 'if [ -f composer.json ]; then composer install --ignore-platform-reqs; fi && if [ -f artisan ]; then php artisan serve --host=0.0.0.0 --port=8000; else php -S 0.0.0.0:8000; fi'";
    //     } elseif ($runtime === 'python') {
    //         $cmd = "docker run -d --name {$containerName} -p {$port}:8000 -v " . escapeshellarg($hostMountPath) . ":/app -w /app python:3.11-alpine sh -c 'if [ -f requirements.txt ]; then pip install -r requirements.txt; fi && python main.py'";
    //     } else {
    //         // Static default
    //         $cmd = "docker run -d --name {$containerName} -p {$port}:80 -v " . escapeshellarg($hostMountPath) . ":/usr/share/nginx/html nginx:alpine";
    //     }

    //     Process::run($cmd);
    // }

    /**
     * Helper to auto-boot the container using the NEW startup.sh recipe
     */
    private function startContainer(Project $project, string $containerName)
    {
        $baseHostPath = env('HOST_WORKSPACE_PATH', '/home/ubuntu/ubiq/backend/storage/app/workspaces');
        $hostMountPath = $baseHostPath . "/{$project->user_id}/{$project->id}";
        $workspacePath = storage_path("app/workspaces/{$project->user_id}/{$project->id}");

        // Reuse the same detection logic (simplified for Terminal)
        $runtime = 'static';
        $image = 'nginx:alpine';
        $internalPort = 80;

        if (\Illuminate\Support\Facades\File::exists($workspacePath . '/package.json')) {
            $runtime = 'node'; $image = 'node:20-alpine'; $internalPort = 5173;
        } elseif (\Illuminate\Support\Facades\File::exists($workspacePath . '/composer.json')) {
            $runtime = 'php'; $image = 'composer:2.7'; $internalPort = 8000;
        } elseif (\Illuminate\Support\Facades\File::exists($workspacePath . '/requirements.txt')) {
            $runtime = 'python'; $image = 'python:3.11-alpine'; $internalPort = 8000;
        }

        // Cleanup
        Process::run("docker stop {$containerName}");
        Process::run("docker rm {$containerName}");

        // CRITICAL: Ensure startup.sh exists. 
        // If it doesn't (user never clicked Run Project), we create a basic fallback.
        if (!\Illuminate\Support\Facades\File::exists($workspacePath . '/startup.sh')) {
            file_put_contents($workspacePath . '/startup.sh', "#!/bin/sh\necho 'Fallback shell'\ntail -f /dev/null");
            chmod($workspacePath . '/startup.sh', 0755);
        }

        $port = 8000 + ($project->id % 1000); 

        // THE FIX: Use the exact same command structure as ProjectController
        $cmd = "docker run -d --name {$containerName} -p {$port}:{$internalPort} -e PORT={$internalPort} -v " . escapeshellarg($hostMountPath) . ":/app -w /app {$image} sh -c 'sh startup.sh || tail -f /dev/null'";

        Process::run($cmd);
    }
}