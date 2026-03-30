<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\File;
use App\Models\SandboxRun;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File as FileSystem; 
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Log;

class ProjectController extends Controller
{
    /**
     * Helper: Get the physical workspace path for a project
     * Structure: storage/app/workspaces/{user_id}/{project_id}
     */
    private function getProjectPath(Project $project)
    {
        $path = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        if (!FileSystem::exists($path)) {
            // Ensure recursive creation with correct permissions
            FileSystem::makeDirectory($path, 0777, true);
        }
        chmod($path, 0777);
        return $path;
    }

    // ── Storage constants — must stay in sync with User::STORAGE_LIMIT_* ─
    const STORAGE_LIMIT_FREE = 536870912;   // 512 MB
    const STORAGE_LIMIT_PRO  = 5368709120;  // 5 GB

    private function getStorageLimitBytes($user): int
    {
        return ($user->subscription_tier === 'pro')
            ? self::STORAGE_LIMIT_PRO
            : self::STORAGE_LIMIT_FREE;
    }

    /** Live DB sum — never reads the stale storage_used column */
    private function getUserUsedBytes($user): int
    {
        return (int) \Illuminate\Support\Facades\DB::table('files')
            ->join('projects', 'files.project_id', '=', 'projects.id')
            ->where('projects.user_id', $user->id)
            ->where('files.is_deleted', false)
            ->sum('files.size_bytes');
    }

    /**
     * GET /user/storage
     * Returns storage usage stats for the frontend storage bar.
     */
    public function storageStats(Request $request)
    {
        $user       = $request->user();
        $usedBytes  = $this->getUserUsedBytes($user);
        $limitBytes = $this->getStorageLimitBytes($user);

        return response()->json([
            'used_bytes'  => $usedBytes,
            'used_mb'     => round($usedBytes / 1048576, 2),
            'limit_bytes' => $limitBytes,
            'limit_mb'    => round($limitBytes / 1048576, 2),
            'percent'     => $limitBytes > 0 ? round(($usedBytes / $limitBytes) * 100, 1) : 0,
        ]);
    }
    
    public function index(Request $request)
    {
        $user = $request->user();
        $projects = Project::where('user_id', $user->id)
            ->when($request->input('archived') !== 'true', fn($q) => $q->where('is_archived', false))
            ->with('files:id,project_id,name,language')
            ->withCount('files')
            ->withSum(['files as storage_bytes' => fn($q) => $q->where('is_deleted', false)], 'size_bytes')
            ->orderBy('updated_at', 'desc')
            ->get();
        
        return response()->json(['projects' => $projects]);
    }

    /**
     * [NEW] Save multiple files at once (Used by Client-Side AI Generation)
     */
    public function scaffold(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $request->validate([
            'files' => 'required|array',
            'files.*.path' => 'required|string',
            'files.*.content' => 'required|string',
        ]);

        $savedCount = 0;
        $projectPath = $this->getProjectPath($project);

        foreach ($request->input('files') as $fileData) {
            $path = $fileData['path'];
            $content = $fileData['content'];

            // 1. Save to DB
            $project->files()->updateOrCreate(
                ['path' => $path],
                [
                    'name' => basename($path),
                    'content' => $content,
                    'language' => $this->detectLanguage(pathinfo($path, PATHINFO_EXTENSION)),
                    'size_bytes' => strlen($content)
                ]
            );

            // 2. Save to Disk
            $fullPath = $projectPath . '/' . $path;
            if (!FileSystem::exists(dirname($fullPath))) {
                FileSystem::makeDirectory(dirname($fullPath), 0755, true);
            }
            file_put_contents($fullPath, $content);
            $savedCount++;
        }

        return response()->json(['message' => "Scaffolded $savedCount files successfully"]);
    }

    /**
     * Save the initial conversation (User Prompt + AI Confirmation)
     * Seed the initial chat history (Prompt + AI Response)
     */
    public function seedChat(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $request->validate([
            'prompt' => 'required|string',
            'ai_response' => 'required|string', // NEW: We accept the summary from frontend
            'model' => 'required|string',
        ]);

        // 1. Create Session
        $session = \App\Models\ChatSession::create([
            'project_id' => $project->id,
            'user_id' => $request->user()->id,
            'title' => 'Project Generation',
            // 'model' => $request->model // Uncomment if your table has this column
        ]);

        // 2. User Prompt
        \App\Models\ChatMessage::create([
            'session_id' => $session->id,
            'role' => 'user',
            'content' => $request->prompt,
            'created_at' => now(),
        ]);

        // 3. AI Summary (Dynamic)
        \App\Models\ChatMessage::create([
            'session_id' => $session->id,
            'role' => 'assistant',
            'content' => $request->ai_response, // Use the summary sent from frontend
            'created_at' => now(),
        ]);

        return response()->json(['message' => 'Chat seeded']);
    }
    
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'description' => 'nullable|string',
            'visibility' => 'nullable|in:private,public',
            'source' => 'nullable|in:manual,github',
            'repository_url' => 'nullable|required_if:source,github|url',
            'github_token' => 'nullable|string',
        ]);
        
        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        // ── Storage quota check (byte-based) ──────────────────────────────
        $usedBytes  = $this->getUserUsedBytes($request->user());
        $limitBytes = $this->getStorageLimitBytes($request->user());
        if ($usedBytes >= $limitBytes) {
            $limitMb = round($limitBytes / 1048576);
            return response()->json([
                'error' => "Storage limit reached ({$limitMb} MB). Delete unused projects or upgrade your plan."
            ], 403);
        }
        
        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => 'mixed',
            'visibility' => $request->visibility ?? 'private',
            'source' => $request->source ?? 'manual',
            'repository_url' => $request->repository_url,
        ]);

        try {
            $projectPath = $this->getProjectPath($project);
            
            if ($project->source === 'manual') {
                $init = Process::path($projectPath)->run('git init');
                if ($init->failed()) {
                    throw new \Exception("Git init failed: " . $init->errorOutput());
                }

                $this->setupGitConfig($projectPath);
                $this->createReadme($project, $projectPath);
                Process::path($projectPath)->run('git add .');
                Process::path($projectPath)->run('git commit -m "Initial commit"');
                
            } elseif ($project->source === 'github') {
                $this->importFromGithub($project, $request->github_token, $projectPath);
            }
        } catch (\Exception $e) {
            // Never log the github_token — mask it before writing to log
            Log::error('Project Creation Failed', [
                'user_id' => $request->user()->id,
                'name'    => $request->name,
                'source'  => $request->source,
                'error'   => $e->getMessage(),
            ]);
            
            $project->delete();
            if (FileSystem::exists($projectPath)) {
                FileSystem::deleteDirectory($projectPath);
            }
            return response()->json(['error' => 'Creation failed: ' . $e->getMessage()], 500);
        }
        
        return response()->json(['message' => 'Project created successfully', 'project' => $project], 201);
    }

    private function importFromGithub(Project $project, ?string $token, string $destinationPath)
    {
        // Storage limit is checked by the caller (store()) before invoking this method.

        $repoUrl = $project->repository_url;

        // Build authenticated URL using the PAT as the password (x-access-token is the username).
        // Format: https://x-access-token:TOKEN@github.com/owner/repo
        // This is GitHub's recommended way — avoids interactive password prompts.
        if ($token) {
            $urlParts = parse_url($repoUrl);
            $repoUrl = $urlParts['scheme'] . '://x-access-token:' . $token . '@' . $urlParts['host'] . $urlParts['path'];
        }

        if (FileSystem::exists($destinationPath)) {
            FileSystem::deleteDirectory($destinationPath);
        }

        // GIT_TERMINAL_PROMPT=0 — prevents git from hanging waiting for stdin input
        // GIT_ASKPASS=echo     — returns empty string for any credential prompt (fails fast)
        // -c credential.helper='' — disables any system credential store
        $result = Process::env([
                'GIT_TERMINAL_PROMPT' => '0',
                'GIT_ASKPASS'         => 'echo',
            ])
            ->timeout(120)
            ->run("git -c credential.helper='' clone " . escapeshellarg($repoUrl) . " " . escapeshellarg($destinationPath));

        if ($result->failed()) {
            // Strip the token from the error message before surfacing it to the user
            $errorOutput = $token
                ? str_replace($token, '***', $result->errorOutput())
                : $result->errorOutput();
            throw new \Exception("Git clone failed: " . $errorOutput);
        }

        $this->setupGitConfig($destinationPath);
        $this->scanAndSaveFiles($project, $destinationPath);
    }

    /**
     * POST /projects/{project}/stop
     * Kills the running sandbox container without deleting project data.
     */
    public function stopProject(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $containerName = "ubiq_project_{$project->id}";
        Process::run("docker stop {$containerName}");
        Process::run("docker rm {$containerName}");

        // Stamp the most recent open audit run for this project
        SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->latest('started_at')
            ->first()
            ?->update(['stopped_at' => now()]);

        return response()->json(['message' => 'Container stopped.']);
    }

    private function setupGitConfig($path)
    {
        Process::run("git config --global --add safe.directory " . escapeshellarg($path));
        Process::path($path)->run("git config user.name 'Ubiq User'");
        Process::path($path)->run("git config user.email 'user@ubiq-editor.space'");
    }

    private function scanAndSaveFiles(Project $project, string $directory)
    {
        $files = FileSystem::allFiles($directory);

        foreach ($files as $file) {
            $relativePath = $file->getRelativePathname();
            if (str_contains($relativePath, '.git/')) continue;
            if ($file->getSize() > 1024 * 1024) continue;

            try {
                $content = $file->getContents();
                if (strpos($content, "\0") !== false) continue;

                File::create([
                    'project_id' => $project->id,
                    'name' => $file->getFilename(),
                    'path' => $relativePath,
                    'content' => $content,
                    'language' => $this->detectLanguage($file->getExtension()),
                    'size_bytes' => $file->getSize()
                ]);
            } catch (\Exception $e) { continue; }
        }
    }

    private function createReadme($project, $path)
    {
        $content = "# " . $project->name . "\n\nWelcome to your new project!";
        file_put_contents($path . '/README.md', $content);
        
        File::create([
            'project_id' => $project->id,
            'name' => 'README.md',
            'path' => 'README.md',
            'content' => $content,
            'language' => 'markdown',
            'size_bytes' => strlen($content)
        ]);
    }

    public function import(Request $request)
    {
        // ── Byte-based storage quota check ────────────────────────────────
        $usedBytes  = $this->getUserUsedBytes($request->user());
        $limitBytes = $this->getStorageLimitBytes($request->user());
        if ($usedBytes >= $limitBytes) {
            $limitMb = round($limitBytes / 1048576);
            return response()->json([
                'error' => "Storage limit reached ({$limitMb} MB). Delete unused projects or upgrade your plan."
            ], 403);
        }

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'description' => 'nullable|string',
            'file' => 'required|file|mimes:zip|max:20480', 
        ]);

        if ($validator->fails()) return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);

        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => 'mixed',
            'source' => 'upload'
        ]);

        $zip = new \ZipArchive;
        $projectPath = $this->getProjectPath($project);

        if ($zip->open($request->file('file')->path()) === TRUE) {

            // ── ZIP SLIP PROTECTION ────────────────────────────────────────
            // Reject any entry that contains path traversal sequences or
            // absolute paths — these can escape the project directory on extract.
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->getNameIndex($i);
                if ($entry === false) continue;

                // Absolute path or traversal attempt
                if (str_starts_with($entry, '/') ||
                    str_starts_with($entry, '\\') ||
                    str_contains($entry, '../') ||
                    str_contains($entry, '..\\') ||
                    str_contains($entry, "\0")) {
                    $zip->close();
                    $project->delete();
                    return response()->json([
                        'error' => 'Invalid ZIP file: contains unsafe paths. Please re-zip without path traversal entries.'
                    ], 422);
                }
            }
            // ── END ZIP SLIP PROTECTION ───────────────────────────────────

            $zip->extractTo($projectPath);
            $zip->close();
            
            Process::path($projectPath)->run('git init');
            $this->setupGitConfig($projectPath);
            
            Process::path($projectPath)->run('git add .');
            Process::path($projectPath)->run('git commit -m "Initial import"');

            $this->scanAndSaveFiles($project, $projectPath);
        } else {
            return response()->json(['error' => 'Failed to open ZIP file'], 500);
        }

        return response()->json(['message' => 'Project imported successfully', 'project' => $project], 201);
    }

    private function detectLanguage($ext)
    {
        $map = [
            'js' => 'javascript', 'jsx' => 'javascript', 'ts' => 'typescript', 'tsx' => 'typescript',
            'py' => 'python', 'php' => 'php', 'html' => 'html', 'css' => 'css', 
            'json' => 'json', 'md' => 'markdown', 'sql' => 'sql', 'java' => 'java', 
            'go' => 'go', 'rs' => 'rust', 'c' => 'c', 'cpp' => 'cpp', 'env' => 'properties'
        ];
        return $map[strtolower($ext)] ?? 'plaintext';
    }

    public function show(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);
        return response()->json(['project' => $project->load(['files' => fn($q)=>$q->where('is_deleted',false)])]); 
    }

    public function update(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);
        $project->update($request->all()); 
        return response()->json(['project'=>$project]); 
    }

    public function destroy(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);

        // Kill sandbox container first — prevents orphaned containers
        $containerName = "ubiq_project_{$project->id}";
        Process::run("docker stop {$containerName}");
        Process::run("docker rm {$containerName}");

        // Stamp any open audit run as stopped
        \App\Models\SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->update(['stopped_at' => now()]);

        $project->delete();
        FileSystem::deleteDirectory($this->getProjectPath($project));
        return response()->json(['message' => 'Deleted']); 
    }

    public function archive(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);
        $project->update(['is_archived'=>true]); 
        return response()->json(['message'=>'Archived']); 
    }

    public function restore(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);
        $project->update(['is_archived'=>false]); 
        return response()->json(['message'=>'Restored']); 
    }

    public function download(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);

        $zipFileName = 'project_' . $project->id . '.zip';
        // Use system temp dir to avoid permission issues
        $zipPath = sys_get_temp_dir() . '/' . $zipFileName;

        $zip = new \ZipArchive;
        if ($zip->open($zipPath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) === TRUE) {
            $path = $this->getProjectPath($project);
            
            if (!FileSystem::exists($path)) {
                 $zip->close();
                 return response()->json(['error' => 'Project files not found'], 404);
            }

            $files = FileSystem::allFiles($path);
            
            foreach ($files as $file) {
                $relativePath = $file->getRelativePathname();

                // --- NEW: SKIP HEAVY FOLDERS ---
                // We check if the path starts with these folders to exclude them entirely
                if (
                    str_starts_with($relativePath, '.git/') || 
                    str_starts_with($relativePath, 'node_modules/') || 
                    str_starts_with($relativePath, 'vendor/')
                    //str_starts_with($relativePath, 'storage/') // Optional: Skip Laravel storage logs/cache
                ) {
                    continue;
                }
                
                $zip->addFile($file->getPathname(), $relativePath);
            }
            $zip->close();
        } else {
            return response()->json(['error' => 'Could not create zip archive'], 500);
        }

        return response()->download($zipPath)->deleteFileAfterSend(true);
    }

    /**
     * FIX #10: findFreePort with Docker-bind retry to eliminate the TOCTOU race.
     *
     * The old approach:
     *   1. Probe a port with stream_socket_server() to see if it's free.
     *   2. Close the socket immediately.
     *   3. Pass the port number to Docker.
     *
     * Under concurrent load, two requests could complete step 2 before either
     * reaches step 3, letting both get the same port. Docker would then fail
     * to start the second container with "address already in use".
     *
     * The correct mitigation is NOT trying to eliminate the race (impossible
     * with a probe-then-use pattern) but to catch the Docker failure and retry
     * with a new port. That's what runProject() now does.
     *
     * findFreePort() itself is kept as a fast pre-check to avoid obviously
     * occupied ports; the retry loop in runProject() is the real safety net.
     *
     * @param  int $start  First port in the scan range (inclusive)
     * @param  int $end    Last port in the scan range (inclusive)
     * @return int         A port that appeared free at probe time
     * @throws \RuntimeException if the entire range is occupied
     */
    private function findFreePort(int $start = 8100, int $end = 8899): int
    {
        for ($port = $start; $port <= $end; $port++) {
            $sock = @stream_socket_server("tcp://127.0.0.1:{$port}", $errno, $errstr);
            if ($sock !== false) {
                fclose($sock);
                return $port;
            }
        }
        throw new \RuntimeException("No free port found in range {$start}-{$end}");
    }
 
    /**
     * Start a Docker Sandbox container to run the project.
     *
     * FIX #10: Wraps the docker run call in a retry loop (up to 3 attempts).
     * If Docker reports "address already in use" — which happens when two
     * concurrent requests race through findFreePort — we probe for a new port
     * and retry rather than returning a 500 to the user.
     */
    public function runProject(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }
 
        $workspacePath = $this->getProjectPath($project);
        $baseHostPath  = env('HOST_WORKSPACE_PATH', '/home/ubuntu/ubiq/backend/storage/app/workspaces');
        $hostMountPath = $baseHostPath . "/{$project->user_id}/{$project->id}";
 
        // 1. Detect Runtime
        $runtimeInfo   = $this->detectRuntime($workspacePath);
        $runtime       = $runtimeInfo['runtime'];
        $framework     = $runtimeInfo['framework'];
 
        // 2. Generate startup.sh
        $startupScript = $this->generateStartupScript($runtime, $framework);
        $startupScript = str_replace(["\r\n", "\r"], "\n", $startupScript);
 
        file_put_contents($workspacePath . '/startup.sh', $startupScript);
        chmod($workspacePath . '/startup.sh', 0755);
 
        $project->files()->updateOrCreate(
            ['path' => 'startup.sh'],
            [
                'name'       => 'startup.sh',
                'content'    => $startupScript,
                'language'   => 'shell',
                'size_bytes' => strlen($startupScript),
                'is_deleted' => false
            ]
        );
 
        $logPlaceholder = "[Ubiq] Build process started. Check the 'Live Server Logs' panel for real-time output.";
        $project->files()->updateOrCreate(
            ['path' => 'startup.log'],
            [
                'name'       => 'startup.log',
                'content'    => $logPlaceholder,
                'language'   => 'plaintext',
                'size_bytes' => strlen($logPlaceholder),
                'is_deleted' => false
            ]
        );
 
        file_put_contents($workspacePath . '/startup.log', "[Ubiq] Initializing Container...\n");
        chmod($workspacePath . '/startup.log', 0777);
        chmod($workspacePath . '/startup.sh', 0777);
        chmod($workspacePath, 0777);
 
        // 3. Container config
        $containerName = "ubiq_project_{$project->id}";
        Process::run("docker stop {$containerName}");
        Process::run("docker rm   {$containerName}");
 
        // 4. Select Image
        $image        = "nginx:alpine";
        $internalPort = 80;
 
        switch ($runtime) {
            case 'node':   $image = "node:20-alpine";            $internalPort = 5173; break;
            case 'php':    $image = "composer:2.7";              $internalPort = 8000; break;
            case 'python': $image = "python:3.11-alpine";        $internalPort = 8000; break;
            case 'java':   $image = "amazoncorretto:17-alpine-jdk"; $internalPort = 8080; break;
        }
 
        // 5. Run Docker with port-collision retry
        // FIX #10: If Docker reports "address already in use" we pick a new port
        // and retry up to MAX_ATTEMPTS times. This handles the TOCTOU window
        // between findFreePort() releasing the probe socket and Docker binding.
        $maxAttempts = 3;
        $result      = null;
        $port        = null;
        $lastError   = '';
 
        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                $port = $this->findFreePort(8100, 8899);
            } catch (\RuntimeException $e) {
                return response()->json(['error' => 'No free ports available. Try again later.'], 503);
            }
 
            $cmd = implode(' ', [
                'docker run -d',
                '--name',   escapeshellarg($containerName),
                '-p',       "{$port}:{$internalPort}",
                '-e',       "PORT={$internalPort}",
                '-v',       escapeshellarg($hostMountPath) . ':/app',
                '-w',       '/app',
                '--memory=512m',
                '--memory-swap=512m',
                '--cpus=0.75',
                '--pids-limit=100',
                '--ulimit', 'nofile=512:512',
                '--ulimit', 'nproc=50:50',
                '--network=ubiq_sandbox',
                '--cap-drop=ALL',
                '--cap-add=NET_BIND_SERVICE',
                '--security-opt', 'no-new-privileges:true',
                '--log-driver=json-file',
                '--log-opt', 'max-size=10m',
                '--log-opt', 'max-file=1',
                '--restart=no',
                $image,
                "sh -c 'sh startup.sh > /app/startup.log 2>&1 || tail -f /dev/null'",
            ]);
 
            $result = Process::timeout(120)->run($cmd);
 
            if ($result->successful()) {
                break; // Docker bound the port — we're done
            }
 
            $lastError = $result->errorOutput();
 
            // Only retry on port-collision errors; surface everything else immediately
            if (!str_contains($lastError, 'address already in use') &&
                !str_contains($lastError, 'port is already allocated')) {
                break;
            }
 
            Log::warning("[Sandbox] Port {$port} collision on attempt {$attempt}/{$maxAttempts} for project {$project->id}. Retrying.");
 
            // Clean up any half-created container before retrying
            Process::run("docker stop {$containerName} 2>/dev/null || true");
            Process::run("docker rm   {$containerName} 2>/dev/null || true");
        }
 
        if (!$result->successful()) {
            return response()->json([
                'error'   => 'Docker failed to start the sandbox.',
                'details' => $lastError,
            ], 500);
        }
 
        $serverIp = env('SERVER_PUBLIC_IP', $request->getHost());
 
        SandboxRun::create([
            'user_id'    => $request->user()->id,
            'project_id' => $project->id,
            'ip_address' => $request->ip(),
            'user_agent' => substr($request->userAgent() ?? '', 0, 500),
            'started_at' => now(),
            'port'       => $port,
            'runtime'    => $runtime,
            'framework'  => $framework,
        ]);
 
        return response()->json([
            'message'   => 'Project booting...',
            'url'       => "http://{$serverIp}:{$port}",
            'port'      => $port,
            'runtime'   => $runtime,
            'framework' => $framework,
        ]);
    }

    /**
     * NEW: Fetch the real-time build logs
     */
    public function getBuildLog(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) abort(403);
        
        $logPath = $this->getProjectPath($project) . '/startup.log';
        
        if (file_exists($logPath)) {
            $content = file_get_contents($logPath);
            return response()->json(['log' => $content]);
        }
        
        return response()->json(['log' => 'Waiting for logs...']);
    }

    private function detectRuntime($path)
    {
        if (\Illuminate\Support\Facades\File::exists($path . '/pom.xml') || \Illuminate\Support\Facades\File::exists($path . '/build.gradle')) {
            return ['runtime' => 'java', 'framework' => 'spring'];
        }
        
        // 1. Aggressive Laravel Detection
        // AI often forgets artisan or composer.json, but it usually creates routes/ or app/
        $hasComposerLaravel = \Illuminate\Support\Facades\File::exists($path . '/composer.json') && str_contains(file_get_contents($path . '/composer.json'), '"laravel/framework"');
        
        if (\Illuminate\Support\Facades\File::exists($path . '/artisan') || 
            \Illuminate\Support\Facades\File::exists($path . '/routes/web.php') || 
            \Illuminate\Support\Facades\File::isDirectory($path . '/app/Http') ||
            $hasComposerLaravel) {
            return ['runtime' => 'php', 'framework' => 'laravel'];
        }
        
        // 2. Raw PHP Detection
        if (\Illuminate\Support\Facades\File::exists($path . '/composer.json') || \Illuminate\Support\Facades\File::exists($path . '/index.php')) {
            return ['runtime' => 'php', 'framework' => 'raw'];
        }

        if (\Illuminate\Support\Facades\File::exists($path . '/manage.py')) {
            return ['runtime' => 'python', 'framework' => 'django'];
        }
        
        if (\Illuminate\Support\Facades\File::exists($path . '/requirements.txt') || \Illuminate\Support\Facades\File::exists($path . '/app.py') || \Illuminate\Support\Facades\File::exists($path . '/main.py')) {
            return ['runtime' => 'python', 'framework' => 'flask']; 
        }
        
        if (\Illuminate\Support\Facades\File::exists($path . '/package.json')) {
            $content = file_get_contents($path . '/package.json');
            if (str_contains($content, '"next"')) return ['runtime' => 'node', 'framework' => 'nextjs'];
            if (str_contains($content, '"react"')) return ['runtime' => 'node', 'framework' => 'react'];
            if (str_contains($content, '"vue"')) return ['runtime' => 'node', 'framework' => 'vue'];
            return ['runtime' => 'node', 'framework' => 'node'];
        }
        
        return ['runtime' => 'static', 'framework' => 'html'];
    }

    private function generateStartupScript($runtime, $framework)
    {
        $header = "#!/bin/sh\n"
            . "\n"
            . "# --- UBIQ AUTO-GENERATED STARTUP SCRIPT ---\n"
            . "echo \"[Ubiq] Booting {$framework}...\"\n"
            . "\n"
            . "# Redirect temp file writes to /tmp to avoid volume permission issues\n"
            . "export TMPDIR=/tmp\n"
            . "mkdir -p /tmp/.cache\n";

        if ($runtime === 'node') $header .= "apk add --no-cache git\n\n";
        elseif ($runtime === 'php') $header .= "apk add --no-cache git zip unzip libzip-dev sqlite-dev nodejs npm\n\n";
        elseif ($runtime === 'python') $header .= "apk add --no-cache git build-base libffi-dev\n\n";
        else $header .= "\n";

        switch ($framework) {

            case 'react':
            case 'vue':
                return $header
                    . "echo \"[Ubiq] Installing NPM packages...\"\n"
                    . "npm install\n"
                    . "\n"
                    . "export TMPDIR=/tmp\n"
                    . "export VITE_CACHE_DIR=/tmp/.vite-cache\n"
                    . "mkdir -p /tmp/.vite-cache\n"
                    . "\n"
                    . "if [ -f \"public/index.html\" ] && [ ! -f \"index.html\" ]; then\n"
                    . "    echo \"[Ubiq] Detected index.html in public/. Moving to root for Vite compatibility...\"\n"
                    . "    mv public/index.html .\n"
                    . "fi\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting Development Server...\"\n"
                    . "if [ -f \"vite.config.js\" ] || [ -f \"vite.config.ts\" ]; then\n"
                    . "    echo \"[Ubiq] Detected Vite config. Launching via npx...\"\n"
                    . "    npx vite --host 0.0.0.0 --port 5173\n"
                    . "else\n"
                    . "    npm run dev -- --host 0.0.0.0 --port 5173\n"
                    . "fi\n";

            case 'nextjs':
                return $header
                    . "echo \"[Ubiq] Installing NPM packages...\"\n"
                    . "npm install\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting Next.js...\"\n"
                    . "npx next dev -p 5173 -H 0.0.0.0\n";

            case 'node':
                return $header
                    . "echo \"[Ubiq] Installing dependencies...\"\n"
                    . "npm install\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting Node...\"\n"
                    . "if grep -q '\"start\":' package.json; then\n"
                    . "    npm start\n"
                    . "elif [ -f index.js ]; then\n"
                    . "    node index.js\n"
                    . "elif [ -f app.js ]; then\n"
                    . "    node app.js\n"
                    . "else\n"
                    . "    echo \"Error: Could not determine entry point.\"\n"
                    . "    exit 1\n"
                    . "fi\n";

            case 'django':
                return $header
                    . "echo \"[Ubiq] Installing Python requirements...\"\n"
                    . "if [ -f requirements.txt ]; then pip install -r requirements.txt; fi\n"
                    . "\n"
                    . "echo \"[Ubiq] Migrating Database...\"\n"
                    . "python manage.py migrate\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting Django Server...\"\n"
                    . "python manage.py runserver 0.0.0.0:8000\n";

            case 'flask':
                return $header
                    . "echo \"[Ubiq] Installing Python requirements...\"\n"
                    . "if [ -f requirements.txt ]; then pip install -r requirements.txt; fi\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting Flask Server...\"\n"
                    . "if [ -f app.py ]; then\n"
                    . "    flask run --host=0.0.0.0 --port=8000 || python app.py\n"
                    . "elif [ -f main.py ]; then\n"
                    . "    python main.py\n"
                    . "else\n"
                    . "    echo \"Error: No entry point found.\"\n"
                    . "    exit 1\n"
                    . "fi\n";

            case 'spring':
                return $header
                    . "echo \"[Ubiq] Preparing Java Environment...\"\n"
                    . "chmod +x mvnw 2>/dev/null || true\n"
                    . "chmod +x gradlew 2>/dev/null || true\n"
                    . "\n"
                    . "if [ -f mvnw ]; then\n"
                    . "    echo \"[Ubiq] Running Maven...\"\n"
                    . "    ./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=8080\n"
                    . "elif [ -f gradlew ]; then\n"
                    . "    echo \"[Ubiq] Running Gradle...\"\n"
                    . "    ./gradlew bootRun --args='--server.port=8080'\n"
                    . "else\n"
                    . "    echo \"Error: No build wrapper found.\"\n"
                    . "    exit 1\n"
                    . "fi\n";

            case 'raw':
                return $header
                    . "export COMPOSER_MEMORY_LIMIT=-1\n"
                    . "echo \"[Ubiq] Installing Composer dependencies...\"\n"
                    . "if [ -f composer.json ]; then composer install --ignore-platform-reqs --no-interaction; fi\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting PHP Built-in Server...\"\n"
                    . "if [ -d \"public\" ]; then\n"
                    . "    php -S 0.0.0.0:8000 -t public\n"
                    . "else\n"
                    . "    php -S 0.0.0.0:8000\n"
                    . "fi\n";

            case 'laravel':
                return $header
                    . "echo \"[Ubiq] Scaffolding required directories...\"\n"
                    . "mkdir -p storage/framework/sessions storage/framework/views storage/framework/cache storage/logs bootstrap/cache database routes config app/Http/Controllers 2>/dev/null || true\n"
                    . "chmod -R 777 storage bootstrap/cache database routes config 2>/dev/null || true\n"
                    . "\n"
                    . "echo \"[Ubiq] Verifying artisan script...\"\n"
                    . "cat > artisan << 'ARTISAN_SCRIPT'\n"
                    . "#!/usr/bin/env php\n"
                    . "<?php\n"
                    . "define('LARAVEL_START', microtime(true));\n"
                    . "if (file_exists(__DIR__.'/vendor/autoload.php')) {\n"
                    . "    require __DIR__.'/vendor/autoload.php';\n"
                    . "} else {\n"
                    . "    fwrite(STDERR, \"Vendor autoload not found.\\n\");\n"
                    . "    exit(1);\n"
                    . "}\n"
                    . '$app = require_once __DIR__."/bootstrap/app.php";' . "\n"
                    . '$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);' . "\n"
                    . '$status = $kernel->handle($input = new Symfony\Component\Console\Input\ArgvInput, new Symfony\Component\Console\Output\ConsoleOutput);' . "\n"
                    . '$kernel->terminate($input, $status);' . "\n"
                    . 'exit($status);' . "\n"
                    . "ARTISAN_SCRIPT\n"
                    . "chmod +x artisan 2>/dev/null || true\n"
                    . "\n"
                    // --- SMART HYBRID BOOTSTRAP (Supports L10 & L11) ---
                    . "if [ ! -f bootstrap/app.php ]; then\n"
                    . "    echo \"[Ubiq] AI forgot bootstrap/app.php! Creating Smart Hybrid Bootstrap...\"\n"
                    . "    cat > bootstrap/app.php << 'BOOTSTRAP_EOF'\n"
                    . '<?php' . "\n"
                    . 'if (class_exists("Illuminate\Foundation\Configuration\Middleware")) {' . "\n"
                    . '    return Illuminate\Foundation\Application::configure(basePath: dirname(__DIR__))' . "\n"
                    . '        ->withRouting(web: __DIR__."/../routes/web.php", commands: __DIR__."/../routes/console.php", health: "/up")' . "\n"
                    . '        ->withMiddleware(function ($middleware) {})' . "\n"
                    . '        ->withExceptions(function ($exceptions) {})' . "\n"
                    . '        ->create();' . "\n"
                    . '} else {' . "\n"
                    . '    $app = new Illuminate\Foundation\Application(dirname(__DIR__));' . "\n"
                    . '    $app->singleton("Illuminate\Contracts\Http\Kernel", class_exists("App\Http\Kernel") ? "App\Http\Kernel" : "Illuminate\Foundation\Http\Kernel");' . "\n"
                    . '    $app->singleton("Illuminate\Contracts\Console\Kernel", class_exists("App\Console\Kernel") ? "App\Console\Kernel" : "Illuminate\Foundation\Console\Kernel");' . "\n"
                    . '    $app->singleton("Illuminate\Contracts\Debug\ExceptionHandler", class_exists("App\Exceptions\Handler") ? "App\Exceptions\Handler" : "Illuminate\Foundation\Exceptions\Handler");' . "\n"
                    . '    return $app;' . "\n"
                    . '}' . "\n"
                    . "BOOTSTRAP_EOF\n"
                    . "fi\n"
                    . "\n"
                    // --- MODERN LARAVEL 11 FALLBACK COMPOSER ---
                    . "if [ ! -f composer.json ]; then\n"
                    . "    echo \"[Ubiq] AI forgot composer.json! Creating default (Laravel 11)...\"\n"
                    . "    cat > composer.json << 'COMPOSER_EOF'\n"
                    . "{\n"
                    . "    \"name\": \"laravel/laravel\",\n"
                    . "    \"require\": {\n"
                    . "        \"php\": \"^8.2\",\n"
                    . "        \"laravel/framework\": \"^11.0\",\n"
                    . "        \"laravel/tinker\": \"^2.9\"\n"
                    . "    },\n"
                    . "    \"autoload\": {\n"
                    . "        \"psr-4\": {\n"
                    . "            \"App\\\\\": \"app/\",\n"
                    . "            \"Database\\\\Factories\\\\\": \"database/factories/\",\n"
                    . "            \"Database\\\\Seeders\\\\\": \"database/seeders/\"\n"
                    . "        }\n"
                    . "    }\n"
                    . "}\n"
                    . "COMPOSER_EOF\n"
                    . "fi\n"
                    . "\n"
                    . "export COMPOSER_MEMORY_LIMIT=-1\n"
                    . "echo \"[Ubiq] Installing Composer dependencies...\"\n"
                    . "composer config -g platform-check false\n"
                    . "composer install --ignore-platform-reqs --no-interaction\n"
                    . "\n"
                    . "if [ -f package.json ]; then\n"
                    . "    echo \"[Ubiq] Installing Frontend Dependencies...\"\n"
                    . "    npm install\n"
                    . "    if [ -f resources/js/app.js ] && [ ! -f resources/js/bootstrap.js ]; then\n"
                    . "        echo \"[Ubiq] Creating default bootstrap.js...\"\n"
                    . "        printf \"import axios from 'axios';\\nwindow.axios = axios;\\nwindow.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';\\n\" > resources/js/bootstrap.js\n"
                    . "    fi\n"
                    . "    echo \"[Ubiq] Building Frontend Assets...\"\n"
                    . "    npm run build\n"
                    . "fi\n"
                    . "\n"
                    . "if [ ! -f .env ]; then\n"
                    . "    echo \"[Ubiq] Creating .env file...\"\n"
                    . "    if [ -f .env.example ]; then\n"
                    . "        cp .env.example .env\n"
                    . "    else\n"
                    . "        touch .env 2>/dev/null || true\n"
                    . "        echo 'APP_KEY=' >> .env 2>/dev/null || true\n"
                    . "    fi\n"
                    . "fi\n"
                    . "\n"
                    . "if ! grep -q \"^APP_KEY=base64:\" .env; then\n"
                    . "    echo \"[Ubiq] Generating missing App Key...\"\n"
                    . "    php artisan key:generate --force\n"
                    . "fi\n"
                    . "\n"
                    // --- PERMISSION BYPASS FOR SQLITE ---
                    . "if [ ! -f database/database.sqlite ]; then\n"
                    . "    echo \"[Ubiq] Creating database...\"\n"
                    . "    mkdir -p database 2>/dev/null || true\n"
                    . "    touch database/database.sqlite 2>/dev/null || true\n"
                    . "    chmod 666 database/database.sqlite 2>/dev/null || true\n"
                    . "fi\n"
                    . "sed -i 's/DB_CONNECTION=.*/DB_CONNECTION=sqlite/g' .env 2>/dev/null || true\n"
                    . "sed -i 's/DB_DATABASE=.*/DB_DATABASE=\\/app\\/database\\/database.sqlite/g' .env 2>/dev/null || true\n"
                    . "\n"
                    . "echo \"[Ubiq] Running migrations...\"\n"
                    . "php artisan migrate --force\n"
                    . "MIGRATE_EXIT=\$?\n"
                    . "if [ \$MIGRATE_EXIT -ne 0 ]; then\n"
                    . "    echo \"[Ubiq] WARNING: migrations failed. Server will still start.\"\n"
                    . "fi\n"
                    . "\n"
                    . "echo \"[Ubiq] Starting Server...\"\n"
                    . "php artisan serve --host=0.0.0.0 --port=8000\n";

            default:
                return $header
                    . "if [ -f \"public/index.html\" ] && [ ! -f \"index.html\" ]; then\n"
                    . "    echo \"[Ubiq] Promoting public/index.html to root...\"\n"
                    . "    mv public/index.html .\n"
                    . "fi\n"
                    . "echo '[Ubiq] Static site ready.'\n"
                    . "tail -f /dev/null\n";
        }
    }
}