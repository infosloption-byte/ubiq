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
            FileSystem::makeDirectory($path, 0755, true);
        }
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
     * Scans a port range and returns the first port not in use.
     * Prevents container launch failures from port collisions.
     */
    private function findFreePort(int $start = 8100, int $end = 8899): int
    {
        for ($port = $start; $port <= $end; $port++) {
            // stream_socket_server() actually attempts to bind the port — the only
            // reliable test. @fsockopen() with a short timeout produces false-negatives
            // on a loaded server, which can cause two containers to race for the same port.
            $sock = @stream_socket_server("tcp://127.0.0.1:{$port}", $errno, $errstr);
            if ($sock !== false) {
                fclose($sock); // release immediately — docker will bind it next
                return $port;
            }
        }
        throw new \RuntimeException("No free port found in range {$start}-{$end}");
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
     * Start a Docker Sandbox container to run the project
     */
    public function runProject(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $workspacePath = $this->getProjectPath($project);
        $baseHostPath = env('HOST_WORKSPACE_PATH', '/home/ubuntu/ubiq/backend/storage/app/workspaces');
        $hostMountPath = $baseHostPath . "/{$project->user_id}/{$project->id}";
        
        // 1. Detect Runtime
        $runtimeInfo = $this->detectRuntime($workspacePath);
        $runtime = $runtimeInfo['runtime'];
        $framework = $runtimeInfo['framework'];

        // 2. Generate Recipe (startup.sh)
        $startupScript = $this->generateStartupScript($runtime, $framework);
        
        // --- CRITICAL FIX: Enforce Unix Line Endings (\n) ---
        // Windows uses \r\n, which breaks Linux shells ("install\r: command not found")
        $startupScript = str_replace(["\r\n", "\r"], "\n", $startupScript);

        // WRITE TO DISK
        file_put_contents($workspacePath . '/startup.sh', $startupScript);
        chmod($workspacePath . '/startup.sh', 0755);

        // SYNC TO DATABASE
        $project->files()->updateOrCreate(
            ['path' => 'startup.sh'],
            [
                'name' => 'startup.sh',
                'content' => $startupScript,
                'language' => 'shell',
                'size_bytes' => strlen($startupScript),
                'is_deleted' => false
            ]
        );

        // --- FIX: SYNC LOG TO DB ---
        // We put a placeholder in the DB so the file doesn't look "Empty" in the editor
        // The real logs are still streamed from disk via getBuildLog()
        $logPlaceholder = "[Ubiq] Build process started. Check the 'Live Server Logs' panel for real-time output.";
        $project->files()->updateOrCreate(
            ['path' => 'startup.log'],
            [
                'name' => 'startup.log',
                'content' => $logPlaceholder, 
                'language' => 'plaintext',
                'size_bytes' => strlen($logPlaceholder),
                'is_deleted' => false
            ]
        );

        // RESET LOGS
        file_put_contents($workspacePath . '/startup.log', "[Ubiq] Initializing Container...\n");

        // 3. Container Config
        $containerName = "ubiq_project_{$project->id}";
        $port = $this->findFreePort(8100, 8899);

        Process::run("docker stop {$containerName}");
        Process::run("docker rm {$containerName}");

        // 4. Select Image
        $image = "nginx:alpine"; 
        $internalPort = 80;

        switch ($runtime) {
            case 'node': $image = "node:20-alpine"; $internalPort = 5173; break;
            case 'php': $image = "composer:2.7"; $internalPort = 8000; break;
            case 'python': $image = "python:3.11-alpine"; $internalPort = 8000; break;
            case 'java': $image = "amazoncorretto:17-alpine-jdk"; $internalPort = 8080; break;
        }

        // 5. Run Docker — with strict resource limits to prevent abuse
        $cmd = implode(' ', [
            'docker run -d',
            '--name',          escapeshellarg($containerName),
            '-p',              "{$port}:{$internalPort}",
            '-e',              "PORT={$internalPort}",
            '-v',              escapeshellarg($hostMountPath) . ':/app',
            '-w',              '/app',
            // ── Resource caps ──────────────────────────────────────────
            '--memory=512m',          // Hard RAM limit
            '--memory-swap=512m',     // Disable swap (= no extra swap on top)
            '--cpus=0.75',            // Max 75% of one CPU core
            '--pids-limit=100',       // Prevent fork bombs
            '--ulimit', 'nofile=512:512',   // File descriptor cap
            '--ulimit', 'nproc=50:50',      // Process count cap (belt + suspenders)
            // ── Network isolation ──────────────────────────────────────
            // Use a restricted bridge network instead of host network.
            // Containers can reach the internet for npm install etc,
            // but cannot reach other containers or the EC2 metadata endpoint.
            '--network=ubiq_sandbox',
            // ── Filesystem hardening ───────────────────────────────────
            '--cap-drop=ALL',         // Drop ALL Linux capabilities
            '--cap-add=NET_BIND_SERVICE', // Re-add only what's needed for port binding
            '--security-opt', 'no-new-privileges:true', // Prevent privilege escalation
            // ── Logging ────────────────────────────────────────────────
            '--log-driver=json-file',
            '--log-opt', 'max-size=10m',
            '--log-opt', 'max-file=1',
            // ── Auto-cleanup ───────────────────────────────────────────
            '--restart=no',
            $image,
            "sh -c 'sh startup.sh > /app/startup.log 2>&1 || tail -f /dev/null'",
        ]);

        $result = Process::timeout(120)->run($cmd);

        if ($result->failed()) {
            return response()->json(['error' => 'Docker failed', 'details' => $result->errorOutput()], 500);
        }

        $serverIp = env('SERVER_PUBLIC_IP', $request->getHost());

        // ── Audit log ──────────────────────────────────────────────────────
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
        if (FileSystem::exists($path . '/pom.xml') || FileSystem::exists($path . '/build.gradle')) {
            return ['runtime' => 'java', 'framework' => 'spring'];
        }
        if (FileSystem::exists($path . '/artisan')) {
            return ['runtime' => 'php', 'framework' => 'laravel'];
        }
        if (FileSystem::exists($path . '/composer.json')) {
            return ['runtime' => 'php', 'framework' => 'raw'];
        }
        if (FileSystem::exists($path . '/manage.py')) {
            return ['runtime' => 'python', 'framework' => 'django'];
        }
        if (FileSystem::exists($path . '/requirements.txt')) {
            return ['runtime' => 'python', 'framework' => 'flask']; // Assumption
        }
        if (FileSystem::exists($path . '/package.json')) {
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
        $header = "#!/bin/sh\n\n# --- UBIQ AUTO-GENERATED STARTUP SCRIPT ---\necho \"[Ubiq] Booting {$framework}...\"\n\n# Redirect temp file writes to /tmp to avoid volume permission issues\nexport TMPDIR=/tmp\nmkdir -p /tmp/.cache\n";
        
        // --- FIX: Install System Dependencies (Git/Zip) for Alpine ---
        $installDeps = "";
        if ($runtime === 'node') $installDeps = "apk add --no-cache git";
        if ($runtime === 'php') $installDeps = "apk add --no-cache git zip unzip libzip-dev sqlite-dev nodejs npm";
        if ($runtime === 'python') $installDeps = "apk add --no-cache git build-base libffi-dev";

        $header .= $installDeps . "\n\n";
        
        switch ($framework) {
            case 'laravel':
                return $header . <<<EOT
                # 0. AUTO-HEAL: Fix broken artisan file
                echo "[Ubiq] Verifying artisan script..."
                cat <<'PHP_SCRIPT' > artisan
                #!/usr/bin/env php
                <?php
                define('LARAVEL_START', microtime(true));

                if (file_exists(__DIR__.'/vendor/autoload.php')) {
                    require __DIR__.'/vendor/autoload.php';
                } else {
                    fwrite(STDERR, "Vendor autoload not found. Please run composer install.\\n");
                    exit(1);
                }

                if (!file_exists(__DIR__.'/bootstrap/app.php')) {
                    fwrite(STDERR, "Bootstrap file not found at bootstrap/app.php\\n");
                    exit(1);
                }

                \$app = require_once __DIR__.'/bootstrap/app.php';

                \$kernel = \$app->make(Illuminate\Contracts\Console\Kernel::class);

                \$status = \$kernel->handle(
                    \$input = new Symfony\Component\Console\Input\ArgvInput,
                    new Symfony\Component\Console\Output\ConsoleOutput
                );

                \$kernel->terminate(\$input, \$status);

                exit(\$status);
                PHP_SCRIPT

                # 1. PRE-INSTALL: Create Dirs & Fix Permissions
                echo "[Ubiq] Configuring directories & permissions..."
                mkdir -p storage/framework/sessions storage/framework/views storage/framework/cache storage/logs bootstrap/cache
                chmod -R 777 storage bootstrap/cache 2>/dev/null || true
                chmod +x artisan

                # 2. VERSION ENFORCER: Upgrade dependencies for Laravel 11
                if grep -q "Application::configure" bootstrap/app.php; then
                    echo "[Ubiq] Detected Laravel 11 syntax. Upgrading dependencies..."
                    sed -i 's/"laravel\/framework": *"[^"]*"/"laravel\/framework": "^11.0"/' composer.json
                    sed -i 's/"laravel\/sanctum": *"[^"]*"/"laravel\/sanctum": "^4.0"/' composer.json
                    sed -i 's/"laravel\/tinker": *"[^"]*"/"laravel\/tinker": "^2.9"/' composer.json
                    sed -i 's/"nunomaduro\/collision": *"[^"]*"/"nunomaduro\/collision": "^8.1"/' composer.json
                    sed -i 's/"spatie\/laravel-ignition": *"[^"]*"/"spatie\/laravel-ignition": "^2.4"/' composer.json
                    sed -i 's/"phpunit\/phpunit": *"[^"]*"/"phpunit\/phpunit": "^10.5"/' composer.json
                fi

                # 3. Install PHP Dependencies
                echo "[Ubiq] Installing Composer dependencies..."
                composer config -g platform-check false
                composer config --no-plugins allow-plugins.kylekatarnls/update-helper true
                composer install --ignore-platform-reqs --no-interaction

                # 4. FRONTEND BUILD
                if [ -f package.json ]; then
                    echo "[Ubiq] Detected package.json. Installing Frontend Dependencies..."
                    npm install
                    
                    # AUTO-HEAL: Create missing bootstrap.js
                    # FIX: Used printf instead of HereDoc to avoid indentation/syntax errors
                    if [ -f resources/js/app.js ] && [ ! -f resources/js/bootstrap.js ]; then
                        echo "[Ubiq] Missing resources/js/bootstrap.js detected. Creating default..."
                        mkdir -p resources/js
                        printf "import axios from 'axios';\\nwindow.axios = axios;\\nwindow.axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest';\\n" > resources/js/bootstrap.js
                    fi

                    echo "[Ubiq] Building Frontend Assets..."
                    npm run build
                fi

                # 5. Environment Setup (Fixes Unsupported Cipher Error)
                if [ ! -f .env ]; then
                    echo "[Ubiq] Creating .env file..."
                    cp .env.example .env
                fi
                
                # Force Key Generation if missing or empty
                if ! grep -q "^APP_KEY=base64:" .env; then
                    echo "[Ubiq] Generating missing App Key..."
                    php artisan key:generate --force
                fi

                # Ensure DB exists
                if [ ! -f database/database.sqlite ]; then
                    touch database/database.sqlite
                fi

                # 6. Migrations
                echo "[Ubiq] Running migrations..."
                php artisan migrate --force

                # 7. Serve
                echo "[Ubiq] Starting Server..."
                php artisan serve --host=0.0.0.0 --port=8000
                EOT;

            case 'react':
            case 'vue':
                // --- VITE AUTO-FIX ---
                return $header . <<<EOT
                echo "[Ubiq] Installing NPM packages..."
                npm install

                # PERMISSION FIX: Vite writes a temp .mjs file next to vite.config.js
                # during startup. The mounted /app volume is owned by the host user (uid 1000)
                # which differs from the container process uid, causing EACCES errors.
                # Setting TMPDIR=/tmp redirects all Vite temp file writes to /tmp which
                # is always writable inside the container regardless of volume permissions.
                export TMPDIR=/tmp
                export VITE_CACHE_DIR=/tmp/.vite-cache

                # Ensure /tmp is writable (it always should be, but be explicit)
                mkdir -p /tmp/.vite-cache

                # CRITICAL FIX: Vite requires index.html in the ROOT.
                if [ -f "public/index.html" ] && [ ! -f "index.html" ]; then
                    echo "[Ubiq] Detected index.html in public/. Moving to root for Vite compatibility..."
                    mv public/index.html .
                fi

                echo "[Ubiq] Starting Development Server..."
                if [ -f "vite.config.js" ] || [ -f "vite.config.ts" ]; then
                    echo "[Ubiq] Detected Vite config. Launching via npx..."
                    npx vite --host 0.0.0.0 --port 5173
                else
                    npm run dev -- --host 0.0.0.0 --port 5173
                fi
                EOT;

            case 'nextjs':
                return $header . <<<EOT
                echo "[Ubiq] Installing NPM packages..."
                npm install

                echo "[Ubiq] Starting Next.js..."
                npx next dev -p 5173 -H 0.0.0.0
                EOT;

            case 'django':
                return $header . <<<EOT
                echo "[Ubiq] Installing Python requirements..."
                if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

                echo "[Ubiq] Migrating Database..."
                python manage.py migrate

                echo "[Ubiq] Starting Django Server..."
                python manage.py runserver 0.0.0.0:8000
                EOT;

            case 'spring':
                return $header . <<<EOT
                echo "[Ubiq] Preparing Java Environment..."
                chmod +x mvnw 2>/dev/null || true
                chmod +x gradlew 2>/dev/null || true

                if [ -f mvnw ]; then
                    echo "[Ubiq] Running Maven..."
                    ./mvnw spring-boot:run -Dspring-boot.run.arguments=--server.port=8080
                elif [ -f gradlew ]; then
                    echo "[Ubiq] Running Gradle..."
                    ./gradlew bootRun --args='--server.port=8080'
                else
                    echo "Error: No build wrapper found."
                    exit 1
                fi
                EOT;

            case 'node': 
                return $header . <<<EOT
                echo "[Ubiq] Installing dependencies..."
                npm install

                echo "[Ubiq] Starting Node..."
                if grep -q '"start":' package.json; then
                    npm start
                elif [ -f index.js ]; then
                    node index.js
                elif [ -f app.js ]; then
                    node app.js
                else
                    echo "Error: Could not determine entry point."
                    exit 1
                fi
                EOT;

            default: 
                // Static: If index.html is in public, Nginx needs to know, or we move it.
                return $header . <<<EOT
                if [ -f "public/index.html" ] && [ ! -f "index.html" ]; then
                    echo "[Ubiq] Promoting public/index.html to root..."
                    mv public/index.html .
                fi
                echo '[Ubiq] Static site ready.'
                tail -f /dev/null
                EOT;
        }
    }
}