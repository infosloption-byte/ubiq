<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\File;
use App\Models\SandboxRun;
use App\Services\PlanGuard;
use App\Services\PlanService;
use App\Exceptions\PlanLimitExceededException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File as FileSystem; 
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Http;

class ProjectController extends Controller
{
    public function __construct(private PlanGuard $planGuard, private PlanService $planService)
    {
    }

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

    // ── DEPRECATED — replaced by plan_features.storage.max_mb (Phase B3c) ─
    // These constants required manually staying in sync with an identical
    // copy in User.php (per the old comment above) — exactly the drift
    // pattern PlanGuard exists to eliminate. Kept only so old references
    // don't silently fall back to something else; nothing in this file
    // calls getStorageLimitBytes() anymore.
    const STORAGE_LIMIT_FREE = 536870912;   // 512 MB — unused, see above
    const STORAGE_LIMIT_PRO  = 5368709120;  // 5 GB — unused, see above

    private function getStorageLimitBytes($user): int
    {
        throw new \RuntimeException('getStorageLimitBytes() is deprecated — use PlanGuard::authorize($user, \'storage.check\', [\'current_bytes\' => ...]) or PlanService::limitFor($user, \'storage.max_mb\') instead.');
    }

    /** Delegates to the canonical implementation on User — was duplicated verbatim here before. */
    private function getUserUsedBytes($user): int
    {
        return $user->getUsedStorageBytes();
    }

    /**
     * GET /user/storage
     * Returns storage usage stats for the frontend storage bar.
     */
    public function storageStats(Request $request)
    {
        $user       = $request->user();
        $usedBytes  = $this->getUserUsedBytes($user);
        $limitMb    = $this->planService->limitFor($user, 'storage.max_mb') ?? 512;
        $unlimited  = is_int($limitMb) && $limitMb === -1;
        $limitBytes = $unlimited ? null : ((int) $limitMb * 1048576);

        return response()->json([
            'used_bytes'  => $usedBytes,
            'used_mb'     => round($usedBytes / 1048576, 2),
            'limit_bytes' => $limitBytes,
            'limit_mb'    => $unlimited ? null : round($limitBytes / 1048576, 2),
            'unlimited'   => $unlimited,
            'percent'     => (!$unlimited && $limitBytes > 0) ? round(($usedBytes / $limitBytes) * 100, 1) : 0,
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
            'files'  => 'required|array',
            'files.*.path'    => 'required|string',
            'files.*.content' => 'required|string',
            'prompt' => 'nullable|string|max:5000',  // FIX: accept the original user prompt
        ]);

        $savedCount    = 0;
        $projectPath   = $this->getProjectPath($project);
        $incomingFiles = $request->input('files');

        // ── FIX: Detect boilerplate key from the original user prompt first ───
        // This is the most reliable signal. The AI only sends app-specific files
        // (controllers, views, routes) — NOT composer.json or package.json, which
        // are protected scaffold files. So detectBoilerplateKeyFromFiles() almost
        // always returns null for Laravel/Node projects, which previously caused
        // the disk-based fallback to return 'html' on a fresh (empty) workspace,
        // giving us protected=['ubiq.json'] only and letting AI overwrite
        // all Laravel scaffold files.
        //
        // Priority: prompt → incoming files → disk
        $userPrompt     = $request->input('prompt', '');
        $boilerplateKey = ($userPrompt !== '')
            ? \App\Services\BoilerplateManager::detectFromPrompt($userPrompt)
            : ($this->detectBoilerplateKeyFromFiles($incomingFiles)
               ?? $this->detectBoilerplateKeyFromDisk($projectPath));

        $protected = \App\Services\BoilerplateManager::getProtectedPaths($boilerplateKey);

        // ── Write hardcoded scaffold to disk + sync scaffold files to DB ──────
        // write() generates all scaffold files from the in-memory template and
        // calls the callback per file. No zip files or artisan commands needed.
        // Using updateOrCreate so re-runs always refresh scaffold content in DB.
        \App\Services\BoilerplateManager::write(
            $boilerplateKey,
            $projectPath,
            function (string $relativePath, string $content) use ($project) {
                $project->files()->updateOrCreate(
                    ['path' => $relativePath],
                    [
                        'name'       => basename($relativePath),
                        'content'    => $content,
                        'language'   => $this->detectLanguage(pathinfo($relativePath, PATHINFO_EXTENSION)),
                        'size_bytes' => strlen($content),
                        'is_deleted' => false,
                    ]
                );
            }
        );

        foreach ($request->input('files') as $fileData) {
            $path    = ltrim(str_replace(['../', '..\\',' \\'], ['', '', '/'], $fileData['path']), '/');
            $content = $fileData['content'];

            // Skip empty — AI hallucinated the file
            if (trim((string)$content) === '') {
                Log::warning("[Ubiq] scaffold: skipping empty file: {$path}");
                continue;
            }

            // Never let AI overwrite scaffold files
            if (in_array($path, $protected, true)) {
                Log::info("[Ubiq] scaffold: protected path blocked: {$path}");
                continue;
            }

            // 1. Save to DB
            $project->files()->updateOrCreate(
                ['path' => $path],
                [
                    'name'       => basename($path),
                    'content'    => $content,
                    'language'   => $this->detectLanguage(pathinfo($path, PATHINFO_EXTENSION)),
                    'size_bytes' => strlen($content),
                    'is_deleted' => false,
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

        // FIX: Return the full file list so the frontend can refresh the editor tree.
        // Previously returning only a message string left the UI with no way to know
        // which files were created, so the editor never updated after generation.
        $savedFiles = $project->files()
            ->where('is_deleted', false)
            ->get(['id', 'path', 'name', 'language', 'size_bytes'])
            ->toArray();

        Log::info("[Ubiq] scaffold() complete — boilerplate: {$boilerplateKey}, ai files saved: {$savedCount}, project: {$project->id}");

        return response()->json([
            'message'        => "Scaffolded {$savedCount} files successfully",
            'boilerplate'    => $boilerplateKey,
            'files_saved'    => $savedCount,
            'files'          => $savedFiles,
        ]);
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

        $user = $request->user();

        try {
            $this->planGuard->authorize($user, 'project.create');
            $this->planGuard->authorize($user, 'storage.check', [
                'current_bytes' => $this->getUserUsedBytes($user),
            ]);
        } catch (PlanLimitExceededException $e) {
            return response()->json([
                'error' => $e->actionKey === 'storage.check'
                    ? 'Storage limit reached. Delete unused projects or upgrade your plan.'
                    : 'Project limit reached for your plan. Delete a project or upgrade your plan.',
                'reason' => $e->reason,
                'limit' => $e->limitValue,
                'usage' => $e->currentUsage,
            ], 403);
        }
        
        // Same sharing.enable gate as update() — if a caller requests
        // public visibility at creation time but their plan doesn't allow
        // it, silently fall back to private rather than blocking project
        // creation entirely over a secondary field.
        $visibility = $request->visibility ?? 'private';
        if ($visibility === 'public' && !$this->planGuard->check($user, 'sharing.enable')) {
            $visibility = 'private';
        }

        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => 'mixed',
            'visibility' => $visibility,
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

        $this->planGuard->release($request->user(), 'active_sandboxes');

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
        $user = $request->user();

        try {
            $this->planGuard->authorize($user, 'project.create');
            $this->planGuard->authorize($user, 'storage.check', [
                'current_bytes' => $this->getUserUsedBytes($user),
            ]);
        } catch (PlanLimitExceededException $e) {
            return response()->json([
                'error' => $e->actionKey === 'storage.check'
                    ? 'Storage limit reached. Delete unused projects or upgrade your plan.'
                    : 'Project limit reached for your plan. Delete a project or upgrade your plan.',
                'reason' => $e->reason,
                'limit' => $e->limitValue,
                'usage' => $e->currentUsage,
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

    /**
     * Repair critical Laravel scaffold files after AI generation.
     * Same logic as CompletionController::repairLaravelScaffold.
     * Called from scaffold() and generate() after saving AI files.
     */
    private function repairLaravelScaffold(\App\Models\Project $project, string $workspacePath): void
    {
        $composerPath = $workspacePath . '/composer.json';
        $laravelMajor = 10;
        if (file_exists($composerPath)) {
            $comp = json_decode((string)file_get_contents($composerPath), true);
            $constraint = $comp['require']['laravel/framework'] ?? '^10.0';
            preg_match('/(\d+)/', ltrim($constraint, '^~>='), $m);
            $laravelMajor = isset($m[1]) ? (int)$m[1] : 10;
        }

        // bootstrap/app.php
        $bootstrapPath = $workspacePath . '/bootstrap/app.php';
        $bootstrapContent = (string)@file_get_contents($bootstrapPath);
        if (trim($bootstrapContent) === ''
            || (str_contains($bootstrapContent, 'Application::configure') && $laravelMajor < 11)
            || !str_contains($bootstrapContent, 'Application')) {
            if ($laravelMajor >= 11) {
                $bootstrap = "<?php\nreturn \\Illuminate\\Foundation\\Application::configure(basePath: dirname(__DIR__))\n    ->withRouting(web: __DIR__.'/../routes/web.php', health: '/up')\n    ->withMiddleware(function (\$m) {})\n    ->withExceptions(function (\$e) {})\n    ->create();\n";
            } else {
                $bootstrap = "<?php\n\$app = new Illuminate\\Foundation\\Application(dirname(__DIR__));\n\$app->singleton(Illuminate\\Contracts\\Http\\Kernel::class, App\\Http\\Kernel::class);\n\$app->singleton(Illuminate\\Contracts\\Console\\Kernel::class, App\\Console\\Kernel::class);\n\$app->singleton(Illuminate\\Contracts\\Debug\\ExceptionHandler::class, App\\Exceptions\\Handler::class);\nreturn \$app;\n";
            }
            if (!is_dir(dirname($bootstrapPath))) mkdir(dirname($bootstrapPath), 0777, true);
            $this->saveRepairFile($project, $workspacePath, 'bootstrap/app.php', $bootstrap);
        }

        // public/index.php
        $indexPath = $workspacePath . '/public/index.php';
        $indexContent = (string)@file_get_contents($indexPath);
        if (trim($indexContent) === ''
            || (str_contains($indexContent, 'handleRequest') && $laravelMajor < 11)
            || !str_contains($indexContent, 'vendor/autoload')) {
            if ($laravelMajor >= 11) {
                $index = "<?php\ndefine('LARAVEL_START', microtime(true));\nif (file_exists(\$m = __DIR__.'/../storage/framework/maintenance.php')) require \$m;\nrequire __DIR__.'/../vendor/autoload.php';\n\$app = require_once __DIR__.'/../bootstrap/app.php';\n\$app->handleRequest(Illuminate\\Http\\Request::capture());\n";
            } else {
                $index = "<?php\ndefine('LARAVEL_START', microtime(true));\nif (file_exists(\$m = __DIR__.'/../storage/framework/maintenance.php')) require \$m;\nrequire __DIR__.'/../vendor/autoload.php';\n\$app = require_once __DIR__.'/../bootstrap/app.php';\n\$kernel = \$app->make(Illuminate\\Contracts\\Http\\Kernel::class);\n\$response = \$kernel->handle(\$request = Illuminate\\Http\\Request::capture());\n\$response->send();\n\$kernel->terminate(\$request, \$response);\n";
            }
            if (!is_dir(dirname($indexPath))) mkdir(dirname($indexPath), 0777, true);
            $this->saveRepairFile($project, $workspacePath, 'public/index.php', $index);
        }

        // artisan
        $artisanPath = $workspacePath . '/artisan';
        $artisanContent = (string)@file_get_contents($artisanPath);
        if (trim($artisanContent) === '' || !str_contains($artisanContent, 'vendor/autoload')) {
            $artisan = "#!/usr/bin/env php\n<?php\ndefine('LARAVEL_START', microtime(true));\nif (!file_exists(\$a = __DIR__.'/vendor/autoload.php')) { fwrite(STDERR, 'Run: composer install\\n'); exit(1); }\nrequire \$a;\n\$app = require_once __DIR__.'/bootstrap/app.php';\nif (method_exists(\$app, 'handleCommand')) { exit(\$app->handleCommand(new Symfony\\Component\\Console\\Input\\ArgvInput)); }\n\$kernel = \$app->make(Illuminate\\Contracts\\Console\\Kernel::class);\n\$input = new Symfony\\Component\\Console\\Input\\ArgvInput;\n\$status = \$kernel->handle(\$input, new Symfony\\Component\\Console\\Output\\ConsoleOutput);\n\$kernel->terminate(\$input, \$status);\nexit(\$status);\n";
            $this->saveRepairFile($project, $workspacePath, 'artisan', $artisan);
            @chmod($artisanPath, 0755);
        }

        // app/Http/Kernel.php (L10 only)
        if ($laravelMajor < 11) {
            $httpKernelPath = $workspacePath . '/app/Http/Kernel.php';
            $hkContent = (string)@file_get_contents($httpKernelPath);
            if (trim($hkContent) === '' || !str_contains($hkContent, 'extends')) {
                $hk = "<?php\nnamespace App\\Http;\nuse Illuminate\\Foundation\\Http\\Kernel as HttpKernel;\nclass Kernel extends HttpKernel {\n    protected \$middleware = [\n        \\Illuminate\\Http\\Middleware\\TrustProxies::class,\n        \\Illuminate\\Http\\Middleware\\HandleCors::class,\n        \\Illuminate\\Foundation\\Http\\Middleware\\PreventRequestsDuringMaintenance::class,\n        \\Illuminate\\Http\\Middleware\\ValidatePostSize::class,\n        \\Illuminate\\Foundation\\Http\\Middleware\\TrimStrings::class,\n        \\Illuminate\\Foundation\\Http\\Middleware\\ConvertEmptyStringsToNull::class,\n    ];\n    protected \$middlewareGroups = [\n        'web' => [\n            \\Illuminate\\Cookie\\Middleware\\EncryptCookies::class,\n            \\Illuminate\\Cookie\\Middleware\\AddQueuedCookiesToResponse::class,\n            \\Illuminate\\Session\\Middleware\\StartSession::class,\n            \\Illuminate\\View\\Middleware\\ShareErrorsFromSession::class,\n            \\Illuminate\\Foundation\\Http\\Middleware\\VerifyCsrfToken::class,\n            \\Illuminate\\Routing\\Middleware\\SubstituteBindings::class,\n        ],\n        'api' => [\n            \\Illuminate\\Routing\\Middleware\\ThrottleRequests::class.':api',\n            \\Illuminate\\Routing\\Middleware\\SubstituteBindings::class,\n        ],\n    ];\n    protected \$middlewareAliases = [\n        'auth'    => \\Illuminate\\Auth\\Middleware\\Authenticate::class,\n        'throttle'=> \\Illuminate\\Routing\\Middleware\\ThrottleRequests::class,\n    ];\n}\n";
                if (!is_dir(dirname($httpKernelPath))) mkdir(dirname($httpKernelPath), 0777, true);
                $this->saveRepairFile($project, $workspacePath, 'app/Http/Kernel.php', $hk);
            }
        }

        // app/Console/Kernel.php (L10 only)
        if ($laravelMajor < 11) {
            $ckPath = $workspacePath . '/app/Console/Kernel.php';
            $ckContent = (string)@file_get_contents($ckPath);
            if (trim($ckContent) === '' || !str_contains($ckContent, 'extends')) {
                $ck = "<?php\nnamespace App\\Console;\nuse Illuminate\\Console\\Scheduling\\Schedule;\nuse Illuminate\\Foundation\\Console\\Kernel as ConsoleKernel;\nclass Kernel extends ConsoleKernel {\n    protected function schedule(Schedule \$s): void {}\n    protected function commands(): void {\n        \$this->load(__DIR__.'/Commands');\n        if (file_exists(base_path('routes/console.php'))) require base_path('routes/console.php');\n    }\n}\n";
                if (!is_dir(dirname($ckPath))) mkdir(dirname($ckPath), 0777, true);
                $this->saveRepairFile($project, $workspacePath, 'app/Console/Kernel.php', $ck);
            }
        }

        // app/Exceptions/Handler.php
        $handlerPath = $workspacePath . '/app/Exceptions/Handler.php';
        $handlerContent = (string)@file_get_contents($handlerPath);
        if (trim($handlerContent) === '' || !str_contains($handlerContent, 'extends')) {
            $handler = "<?php\nnamespace App\\Exceptions;\nuse Illuminate\\Foundation\\Exceptions\\Handler as ExceptionHandler;\nuse Throwable;\nclass Handler extends ExceptionHandler {\n    protected \$dontFlash = ['current_password','password','password_confirmation'];\n    public function register(): void {}\n}\n";
            if (!is_dir(dirname($handlerPath))) mkdir(dirname($handlerPath), 0777, true);
            $this->saveRepairFile($project, $workspacePath, 'app/Exceptions/Handler.php', $handler);
        }

        // routes/web.php
        $webPath = $workspacePath . '/routes/web.php';
        if (!file_exists($webPath) || trim((string)file_get_contents($webPath)) === '') {
            if (!is_dir(dirname($webPath))) mkdir(dirname($webPath), 0777, true);
            $this->saveRepairFile($project, $workspacePath, 'routes/web.php', "<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/', fn() => response()->json(['status'=>'ok','message'=>'Laravel is running']));\n");
        }

        // routes/console.php
        $consolePath = $workspacePath . '/routes/console.php';
        if (!file_exists($consolePath)) {
            $this->saveRepairFile($project, $workspacePath, 'routes/console.php', "<?php\nuse Illuminate\\Support\\Facades\\Artisan;\n");
        }

        // Delete empty config files — let Laravel use package defaults
        $configDir = $workspacePath . '/config';
        if (is_dir($configDir)) {
            foreach (glob($configDir . '/*.php') ?: [] as $configFile) {
                $cfg = (string)@file_get_contents($configFile);
                if (trim($cfg) === '' || trim($cfg) === '<?php') {
                    unlink($configFile);
                    $project->files()->where('path', 'config/' . basename($configFile))->delete();
                }
            }
        }

        // database.sqlite
        $dbPath = $workspacePath . '/database/database.sqlite';
        if (!file_exists($dbPath)) {
            if (!is_dir(dirname($dbPath))) mkdir(dirname($dbPath), 0777, true);
            touch($dbPath); chmod($dbPath, 0666);
        }
    }

    /**
     * Detect the boilerplate key from what's already on disk.
     * Used by scaffold() so it knows which paths are protected.
     */
    /**
     * Detect boilerplate key by inspecting the AI-generated files being sent in.
     * This is more reliable than disk detection on a fresh (empty) project directory.
     *
     * Looks for tell-tale files like composer.json with laravel/framework,
     * package.json with react/vue/next etc., requirements.txt with flask/fastapi.
     *
     * Returns null if detection is inconclusive (falls back to disk detection).
     */
    private function detectBoilerplateKeyFromFiles(array $files): ?string
    {
        // Index files by path for quick lookup
        $fileMap = [];
        foreach ($files as $f) {
            $fileMap[$f['path'] ?? ''] = $f['content'] ?? '';
        }

        // Check composer.json for Laravel
        if (isset($fileMap['composer.json'])) {
            $composer = json_decode($fileMap['composer.json'], true) ?? [];
            $constraint = $composer['require']['laravel/framework']
                       ?? $composer['require']['laravel/framework'] ?? '';
            if ($constraint) {
                preg_match('/(\d+)/', ltrim($constraint, '^~>='), $m);
                return ((int)($m[1] ?? 11)) >= 11 ? 'laravel@11' : 'laravel@10';
            }
            // Any composer.json without laravel → raw PHP → default laravel@11
            if (!empty($composer)) return 'laravel@11';
        }

        // Check package.json for JS frameworks
        if (isset($fileMap['package.json'])) {
            $pkg  = json_decode($fileMap['package.json'], true) ?? [];
            $deps = array_merge($pkg['dependencies'] ?? [], $pkg['devDependencies'] ?? []);
            if (isset($deps['next']))            return 'nextjs';
            if (isset($deps['@angular/core']))   return 'angular';
            if (isset($deps['react']))           return 'react';
            if (isset($deps['vue']))             return 'vue';
            return 'node';
        }

        // Check requirements.txt for Python
        if (isset($fileMap['requirements.txt'])) {
            $req = $fileMap['requirements.txt'];
            if (str_contains($req, 'django'))  return 'django';
            if (str_contains($req, 'fastapi')) return 'fastapi';
            if (str_contains($req, 'flask'))   return 'flask';
            return 'flask'; // default python
        }

        // Check for Django manage.py
        if (isset($fileMap['manage.py'])) return 'django';

        // Check ubiq.json if AI sent it
        if (isset($fileMap['ubiq.json'])) {
            $ubiq      = json_decode($fileMap['ubiq.json'], true) ?? [];
            $framework = $ubiq['framework'] ?? '';
            $version   = $ubiq['version']   ?? '';
            if ($framework === 'laravel') return $version === '10' ? 'laravel@10' : 'laravel@11';
            if (in_array($framework, ['react','vue','nextjs','angular','node','flask','fastapi','django'], true)) {
                return $framework;
            }
        }

        return null; // inconclusive — caller falls back to disk detection
    }

    private function detectBoilerplateKeyFromDisk(string $path): string
    {
        // Check ubiq.json first (most reliable — written by BoilerplateManager)
        $ubiqPath = $path . '/ubiq.json';
        if (file_exists($ubiqPath)) {
            $ubiq      = json_decode((string)file_get_contents($ubiqPath), true) ?? [];
            $framework = $ubiq['framework'] ?? '';
            $version   = $ubiq['version']   ?? '';
            if ($framework === 'laravel') {
                return $version === '10' ? 'laravel@10' : 'laravel@11';
            }
            if (in_array($framework, ['react','vue','nextjs','angular','node','flask','fastapi','django','html'], true)) {
                return $framework;
            }
        }

        // Fall back to disk detection
        if (file_exists($path . '/composer.json')) {
            $comp       = json_decode((string)file_get_contents($path . '/composer.json'), true) ?? [];
            $constraint = $comp['require']['laravel/framework'] ?? '';
            if ($constraint) {
                preg_match('/(\d+)/', ltrim($constraint, '^~>='), $m);
                return ((int)($m[1] ?? 11)) >= 11 ? 'laravel@11' : 'laravel@10';
            }
        }
        if (file_exists($path . '/package.json')) {
            $pkg  = json_decode((string)file_get_contents($path . '/package.json'), true) ?? [];
            $deps = array_merge($pkg['dependencies'] ?? [], $pkg['devDependencies'] ?? []);
            if (isset($deps['next']))            return 'nextjs';
            if (isset($deps['@angular/core']))   return 'angular';
            if (isset($deps['react']))           return 'react';
            if (isset($deps['vue']))             return 'vue';
            return 'node';
        }
        if (file_exists($path . '/manage.py'))         return 'django';
        if (file_exists($path . '/requirements.txt')) {
            $req = (string)file_get_contents($path . '/requirements.txt');
            if (str_contains($req, 'fastapi')) return 'fastapi';
            return 'flask';
        }
        return 'html';
    }

    private function saveRepairFile(\App\Models\Project $project, string $workspacePath, string $relativePath, string $content): void
    {
        $fullPath = $workspacePath . '/' . $relativePath;
        if (!is_dir(dirname($fullPath))) mkdir(dirname($fullPath), 0777, true);
        file_put_contents($fullPath, $content);
        $project->files()->updateOrCreate(
            ['path' => $relativePath],
            ['name' => basename($relativePath), 'content' => $content, 'language' => $this->detectLanguage(pathinfo($relativePath, PATHINFO_EXTENSION)), 'size_bytes' => strlen($content), 'is_deleted' => false]
        );
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

        // Was $project->update($request->all()) — a raw mass-assignment of
        // the ENTIRE request body onto the model with zero validation.
        // Project::$fillable includes user_id and storage_path, so this
        // let an owner silently reassign/corrupt fields that were never
        // meant to be editable via this endpoint. Whitelisted explicitly
        // below; github_token/repository_url/branch/source belong to the
        // dedicated GitHub-import flow, not generic edits — add a separate
        // endpoint for those if genuinely needed here later.
        $validated = $request->validate([
            'name'        => 'sometimes|string|max:191',
            'description' => 'sometimes|nullable|string',
            'language'    => 'sometimes|string|max:50',
            'visibility'  => 'sometimes|in:private,public',
        ]);

        // B3d — going public is the only part of this endpoint with a real
        // plan-gated cost/value (public sharing is a paid-tier feature per
        // §5 of the pricing analysis); everything else above is a free
        // edit regardless of tier.
        if (($validated['visibility'] ?? null) === 'public') {
            try {
                $this->planGuard->authorize($request->user(), 'sharing.enable');
            } catch (PlanLimitExceededException $e) {
                return response()->json([
                    'error' => 'Public sharing requires a Creator plan or higher.',
                    'reason' => $e->reason,
                ], 403);
            }
        }

        $project->update($validated);
        return response()->json(['project' => $project]); 
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

        // Check BEFORE any file writes / docker stop-rm / docker run — no
        // point doing expensive work for a request we're about to deny.
        // This increments the 'active_sandboxes' concurrent counter on
        // success; every failure path below that aborts the actual
        // container start must call planGuard->release() to avoid the
        // counter drifting upward for sandboxes that never really started.
        try {
            $this->planGuard->authorize($request->user(), 'sandbox.start');
        } catch (PlanLimitExceededException $e) {
            return response()->json([
                'error' => 'Sandbox limit reached',
                'reason' => $e->reason,
                'limit' => $e->limitValue,
                'usage' => $e->currentUsage,
            ], 429);
        }

        $workspacePath = $this->getProjectPath($project);
        $user          = $request->user();
        $baseHostPath  = env('HOST_WORKSPACE_PATH', '/home/ubuntu/ubiq/backend/storage/app/workspaces');
        $hostMountPath = $baseHostPath . "/{$project->user_id}/{$project->id}";
 
        // --- 1. GET DYNAMIC CONFIGURATION ---
        $config = $this->getRuntimeConfig($workspacePath);
        $runtime = $config['runtime'];
        $framework = $config['framework'];
 
        // --- 2. GENERATE SCRIPT ---
        // Pass $workspacePath so generateStartupScript can write bootstrap/app.php
        // and artisan directly to disk via PHP before the container starts.
        $startupScript = $this->generateStartupScript($config, $workspacePath);
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
 
        // --- 3. CONTAINER PREP ---
        $containerName = "ubiq_project_{$project->id}";
        Process::run("docker stop {$containerName}");
        Process::run("docker rm   {$containerName}");
 
        // --- 4. SELECT DOCKER IMAGE ---
        $dockerConfig = $this->selectDockerImage($config);
        $image = $dockerConfig['image'];
        $internalPort = $dockerConfig['port'];
 
        // --- 5. EXECUTE (With Port Retry) ---
        $maxAttempts = 3;
        $result      = null;
        $port        = null;
        $lastError   = '';
 
        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                $port = $this->findFreePort(8100, 8899);
            } catch (\RuntimeException $e) {
                $this->planGuard->release($request->user(), 'active_sandboxes');
                return response()->json(['error' => 'No free ports available. Try again later.'], 503);
            }
 
            // Angular CLI + esbuild needs ~700-900MB RAM during build.
            // Node containers get 1GB; PHP/Python stay at 512MB.
            // Tier-aware sizing from plan_features (was hardcoded before —
            // sandbox.cpu/sandbox.memory_mb were seeded in Phase A but
            // never actually read anywhere until now). Memory uses
            // max(tier, runtime-minimum) rather than a hard tier cap: the
            // tier value is the baseline every plan gets, but a Node/Angular
            // build genuinely needs ~700-900MB to not OOM regardless of
            // tier — silently failing free-tier Node builds isn't a
            // deliberate product decision we've made, so we bump up rather
            // than cap down. If you want tier to be a hard ceiling instead
            // (e.g. "heavy JS builds require Creator+"), swap max() for
            // min() here — one-line change.
            $tierCpu       = (string) ($this->planService->limitFor($user, 'sandbox.cpu') ?? '0.75');
            $tierMemoryMb  = (int) ($this->planService->limitFor($user, 'sandbox.memory_mb') ?? 512);
            $runtimeFloorMb = ($runtime === 'node') ? 1024 : 512;
            $memoryMb      = max($tierMemoryMb, $runtimeFloorMb);
            $memoryLimit   = "{$memoryMb}m";
            $memorySwap    = "{$memoryMb}m";
            // Angular also spawns more processes (tsc, esbuild workers)
            $pidsLimit   = ($runtime === 'node') ? 200 : 100;

            $cmd = implode(' ', [
                'docker run -d',
                '--name',   escapeshellarg($containerName),
                '-p',       "{$port}:{$internalPort}",
                '-e',       "PORT={$internalPort}",
                '-v',       escapeshellarg($hostMountPath) . ':/app',
                '-w',       '/app',
                "--memory={$memoryLimit}",
                "--memory-swap={$memorySwap}",
                "--cpus={$tierCpu}",
                "--pids-limit={$pidsLimit}",
                '--ulimit', 'nofile=1024:1024',
                '--ulimit', 'nproc=100:100',
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
            if ($result->successful()) break; 
 
            $lastError = $result->errorOutput();
            if (!str_contains($lastError, 'address already in use') && !str_contains($lastError, 'port is already allocated')) {
                break;
            }
 
            Log::warning("[Sandbox] Port {$port} collision on attempt {$attempt}/{$maxAttempts} for project {$project->id}. Retrying.");
            Process::run("docker stop {$containerName} 2>/dev/null || true");
            Process::run("docker rm   {$containerName} 2>/dev/null || true");
        }
 
        if (!$result->successful()) {
            $this->planGuard->release($request->user(), 'active_sandboxes');
            return response()->json(['error' => 'Docker failed to start the sandbox.', 'details' => $lastError], 500);
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

    public function getBuildLog(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) abort(403);

        $logPath = $this->getProjectPath($project) . '/startup.log';
        $log = FileSystem::exists($logPath) ? file_get_contents($logPath) : 'Waiting for logs...';

        $containerName = "ubiq_project_{$project->id}";

        // Real container state — distinguishes "still building" from
        // "crashed and silently sleeping in the tail -f /dev/null fallback".
        $containerStatus = 'missing';
        $exitCode = null;
        $inspect = Process::timeout(5)->run(
            "docker inspect {$containerName} --format '{{.State.Status}}|{{.State.ExitCode}}'"
        );
        if ($inspect->successful()) {
            [$status, $code] = array_pad(explode('|', trim($inspect->output())), 2, [null, null]);
            $containerStatus = $status ?: 'unknown';
            $exitCode = $code !== null && $code !== '' ? (int) $code : null;
        }

        // Real readiness — don't just trust that the container is "running";
        // actually try to reach the port the dev server is supposed to be on.
        // host.docker.internal resolves to the host gateway (see extra_hosts
        // in docker-compose.yml), so this works from inside the api container.
        $portReady = false;
        if ($containerStatus === 'running') {
            $run = SandboxRun::where('project_id', $project->id)
                ->whereNull('stopped_at')
                ->latest('id')
                ->first();
            if ($run?->port) {
                try {
                    $portReady = Http::timeout(2)->get("http://host.docker.internal:{$run->port}")->status() < 500;
                } catch (\Throwable $e) {
                    $portReady = false;
                }
            }
        }

        return response()->json([
            'log'              => $log,
            'container_status' => $containerStatus, // running | exited | missing | unknown
            'exit_code'        => $exitCode,
            'port_ready'       => $portReady,
        ]);
    }

    // =========================================================================
    // CORE DYNAMIC CONFIGURATION ENGINE
    // =========================================================================

    private function getRuntimeConfig(string $workspacePath): array {
        $ubiq = [];
        $ubiqPath = $workspacePath . '/ubiq.json';
        if (FileSystem::exists($ubiqPath)) {
            $ubiq = json_decode(file_get_contents($ubiqPath), true) ?? [];
        }
        $detected = $this->detectFromDisk($workspacePath);
        $merged = array_merge($detected, $ubiq);

        // FIX: If disk detection found Laravel but ubiq.json has a different/wrong
        // framework value (e.g. 'raw', 'html', 'php'), trust the disk detection.
        // AI sometimes generates ubiq.json with framework=raw or wrong runtime
        // for Laravel projects, causing the startup script to run php -S instead
        // of php artisan serve with the full Laravel boot sequence.
        if (($detected['framework'] ?? '') === 'laravel' && ($merged['framework'] ?? '') !== 'laravel') {
            $merged['framework'] = 'laravel';
            $merged['runtime']   = 'php';
            $merged['port']      = $merged['port'] ?? 8000;
        }

        return $merged;
    }

    private function detectFromDisk(string $path): array {
        $config = [];
        if (FileSystem::exists($path . '/artisan') || (FileSystem::exists($path . '/composer.json') && str_contains(@file_get_contents($path . '/composer.json') ?: '', '"laravel/framework"'))) {
            $config['runtime'] = 'php'; $config['framework'] = 'laravel'; $config['port'] = 8000;
        } elseif (FileSystem::exists($path . '/composer.json') || FileSystem::exists($path . '/index.php')) {
            $config['runtime'] = 'php'; $config['framework'] = 'raw'; $config['port'] = 8000;
        } elseif (FileSystem::exists($path . '/package.json')) {
            $pkg = json_decode(@file_get_contents($path . '/package.json') ?: '{}', true);
            $deps = array_merge($pkg['dependencies'] ?? [], $pkg['devDependencies'] ?? []);
            $config['runtime'] = 'node';
            if (isset($deps['next'])) {
                $config['framework'] = 'nextjs';
                $config['port'] = 3000;
            } elseif (isset($deps['@angular/core'])) {
                $config['framework'] = 'angular';
                $config['port'] = 4200;  // Angular CLI serves on 4200, NOT 5173
            } elseif (isset($deps['react'])) {
                $config['framework'] = 'react';
                $config['port'] = 5173;
            } elseif (isset($deps['vue'])) {
                $config['framework'] = 'vue';
                $config['port'] = 5173;
            } else {
                $config['framework'] = 'node';
                $config['port'] = 3000;
            }
            if (FileSystem::exists($path . '/pnpm-lock.yaml')) $config['package_manager'] = 'pnpm';
            elseif (FileSystem::exists($path . '/bun.lockb')) $config['package_manager'] = 'bun';
            elseif (FileSystem::exists($path . '/yarn.lock')) $config['package_manager'] = 'yarn';
            else $config['package_manager'] = 'npm';
        } elseif (FileSystem::exists($path . '/manage.py')) {
            $config['runtime'] = 'python'; $config['framework'] = 'django'; $config['port'] = 8000;
        } elseif (FileSystem::exists($path . '/requirements.txt') || FileSystem::exists($path . '/main.py')) {
            $config['runtime'] = 'python';
            $req = @file_get_contents($path . '/requirements.txt') ?: '';
            if (str_contains($req, 'fastapi')) $config['framework'] = 'fastapi';
            elseif (str_contains($req, 'flask')) $config['framework'] = 'flask';
            else $config['framework'] = 'python';
            $config['port'] = 8000;
        } else {
            $config['runtime'] = 'static'; $config['framework'] = 'html'; $config['port'] = 80;
        }
        return $config;
    }

    private function selectDockerImage(array $config): array {
        $runtime = $config['runtime'] ?? 'static';
        $version = $config['version'] ?? null;
        $major   = $version ? (int)$version : null;
        $internalPort = $config['port'] ?? ($runtime === 'node' ? 5173 : 8000);

        return match($runtime) {
            'node' => match(true) {
                $major >= 22  => ['image' => 'node:22-alpine', 'port' => $internalPort],
                $major >= 18  => ['image' => 'node:18-alpine', 'port' => $internalPort],
                default       => ['image' => 'node:20-alpine', 'port' => $internalPort],
            },
            // FIX: Always use php:8.3-cli-alpine. The old match(true) always fell through
            // to composer:2.7 because $version is never set by detectFromDisk(), making
            // $major null, and null >= 83 is false. composer:2.7 lacks proper Alpine
            // shell tools and causes php -S / artisan failures. php:8.3-cli-alpine has
            // PHP 8.3 + Composer available after `apk add` in the startup script.
            'php'  => ['image' => 'php:8.3-cli-alpine', 'port' => $internalPort],
            'python' => match(true) {
                $major >= 312 => ['image' => 'python:3.12-alpine',  'port' => $internalPort],
                default       => ['image' => 'python:3.11-alpine',  'port' => $internalPort],
            },
            default => ['image' => 'nginx:alpine', 'port' => 80], 
        };
    }

    /**
     * Write critical Laravel files directly to disk from PHP before generating
     * the startup script. This is far more reliable than heredocs inside shell
     * arrays — PHP string escaping is controlled, heredoc delimiters can't be
     * corrupted, and the files exist before Docker even starts.
     */
    private function writeLaravelProofingFiles(string $workspacePath): void
    {
        // ── 1. Create ALL core directories on the HOST side with 0777 ──
        $dirs = [
            'app',
            'bootstrap/cache',
            'config',
            'database/migrations',
            'public',
            'resources/views',
            'routes',
            'storage/framework/sessions',
            'storage/framework/views',
            'storage/framework/cache',
            'storage/logs',
        ];
        foreach ($dirs as $dir) {
            $fullDir = $workspacePath . '/' . $dir;
            if (!is_dir($fullDir)) {
                @mkdir($fullDir, 0777, true);
            }
            @chmod($fullDir, 0777);
        }

        // ── 1.5 Force Create SQLite Database on HOST side ──
        // Directory must be 0777 so the Docker container (which may run as a
        // different UID) can write. The file needs 0666 (world-writable).
        $dbDir  = $workspacePath . '/database';
        $dbPath = $dbDir . '/database.sqlite';
        if (!is_dir($dbDir)) @mkdir($dbDir, 0777, true);
        @chmod($dbDir, 0777);
        if (!file_exists($dbPath)) {
            @file_put_contents($dbPath, '');
        }
        @chmod($dbPath, 0666);

        // ── 2. bootstrap/app.php ────────────────────────────────────────────────
        $bootstrapPath = $workspacePath . '/bootstrap/app.php';
        if (!file_exists($bootstrapPath) || trim(file_get_contents($bootstrapPath)) === '') {
            $bootstrapContent = <<<'PHP'
<?php
if (class_exists(\Illuminate\Foundation\Configuration\Middleware::class)) {
    return \Illuminate\Foundation\Application::configure(basePath: dirname(__DIR__))
        ->withRouting(
            web:      __DIR__ . '/../routes/web.php',
            commands: file_exists(__DIR__ . '/../routes/console.php') ? __DIR__ . '/../routes/console.php' : null,
            health:   '/up',
        )
        ->withMiddleware(function ($middleware) {})
        ->withExceptions(function ($exceptions) {})
        ->create();
} else {
    $app = new \Illuminate\Foundation\Application(dirname(__DIR__));
    $app->singleton(\Illuminate\Contracts\Http\Kernel::class, class_exists(\App\Http\Kernel::class) ? \App\Http\Kernel::class : \Illuminate\Foundation\Http\Kernel::class);
    $app->singleton(\Illuminate\Contracts\Console\Kernel::class, class_exists(\App\Console\Kernel::class) ? \App\Console\Kernel::class : \Illuminate\Foundation\Console\Kernel::class);
    $app->singleton(\Illuminate\Contracts\Debug\ExceptionHandler::class, class_exists(\App\Exceptions\Handler::class) ? \App\Exceptions\Handler::class : \Illuminate\Foundation\Exceptions\Handler::class);
    return $app;
}
PHP;
            file_put_contents($bootstrapPath, $bootstrapContent);
            @chmod($bootstrapPath, 0644);
        }

        // ── 3. artisan (HYBRID FOR LARAVEL 10 & 11) ───────────────────────────
        $artisanPath = $workspacePath . '/artisan';
        if (!file_exists($artisanPath) || trim(file_get_contents($artisanPath)) === '') {
            $artisanContent = <<<'PHP'
#!/usr/bin/env php
<?php
define('LARAVEL_START', microtime(true));
if (file_exists(__DIR__ . '/vendor/autoload.php')) {
    require __DIR__ . '/vendor/autoload.php';
} else {
    fwrite(STDERR, "[Ubiq] vendor/autoload.php not found — run composer install first.\n");
    exit(1);
}
$app = require_once __DIR__ . '/bootstrap/app.php';
if (method_exists($app, 'handleCommand')) {
    $status = $app->handleCommand(new Symfony\Component\Console\Input\ArgvInput);
} else {
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $status = $kernel->handle(
        $input = new Symfony\Component\Console\Input\ArgvInput,
        new Symfony\Component\Console\Output\ConsoleOutput
    );
    $kernel->terminate($input, $status);
}
exit($status);
PHP;
            file_put_contents($artisanPath, $artisanContent);
            @chmod($artisanPath, 0755);
        }

        // ── 4. routes/web.php ─────────────────────────────────────────────────
        $webPhpPath = $workspacePath . '/routes/web.php';
        if (!file_exists($webPhpPath) || trim(file_get_contents($webPhpPath)) === '') {
            file_put_contents($webPhpPath, "<?php\nuse Illuminate\\Support\\Facades\\Route;\nRoute::get('/', fn () => response()->json(['status' => 'ok', 'message' => 'Laravel is running']));\n");
        }

        // ── 4.1 config/app.php (CRITICAL FIX FOR LOAD CONFIG ERROR) ───────────
        $configAppPath = $workspacePath . '/config/app.php';
        if (!file_exists($configAppPath) || trim(file_get_contents($configAppPath)) === '') {
            $configAppContent = <<<'PHP'
<?php
return [
    'name' => env('APP_NAME', 'UbiqApp'),
    'env' => env('APP_ENV', 'production'),
    'debug' => (bool) env('APP_DEBUG', false),
    'url' => env('APP_URL', 'http://localhost'),
    'timezone' => env('APP_TIMEZONE', 'UTC'),
    'locale' => env('APP_LOCALE', 'en'),
    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'en'),
    'faker_locale' => env('APP_FAKER_LOCALE', 'en_US'),
    'cipher' => 'AES-256-CBC',
    'key' => env('APP_KEY'),
    'previous_keys' => [...array_filter(explode(',', env('APP_PREVIOUS_KEYS', '')))],
    'providers' => Illuminate\Support\ServiceProvider::defaultProviders()->merge([])->toArray(),
    'aliases' => Illuminate\Support\Facades\Facade::defaultAliases()->merge([])->toArray(),
];
PHP;
            file_put_contents($configAppPath, $configAppContent);
            @chmod($configAppPath, 0644);
        }

        // ── 4.2 config/database.php (CRITICAL FOR SQLITE MIGRATIONS) ──────────
        $configDbPath = $workspacePath . '/config/database.php';
        if (!file_exists($configDbPath) || trim(file_get_contents($configDbPath)) === '') {
            $configDbContent = <<<'PHP'
<?php
return [
    'default' => env('DB_CONNECTION', 'sqlite'),
    'connections' => [
        'sqlite' => [
            'driver' => 'sqlite',
            'url' => env('DATABASE_URL'),
            'database' => env('DB_DATABASE', database_path('database.sqlite')),
            'prefix' => '',
            'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
        ],
    ],
    'migrations' => [
        'table' => 'migrations',
        'update_date_on_publish' => true,
    ],
];
PHP;
            file_put_contents($configDbPath, $configDbContent);
            @chmod($configDbPath, 0644);
        }

        // ── 4.5 public/index.php (HYBRID FOR LARAVEL 10 & 11) ─────────────────
        $indexPhpPath = $workspacePath . '/public/index.php';
        if (!file_exists($indexPhpPath) || trim(file_get_contents($indexPhpPath)) === '') {
            $indexContent = <<<'PHP'
<?php
define('LARAVEL_START', microtime(true));

if (file_exists(__DIR__.'/../storage/framework/maintenance.php')) {
    require __DIR__.'/../storage/framework/maintenance.php';
}

require __DIR__.'/../vendor/autoload.php';

$app = require_once __DIR__.'/../bootstrap/app.php';

if (method_exists($app, 'handleRequest')) {
    $app->handleRequest(Illuminate\Http\Request::capture());
} else {
    $kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);
    $response = $kernel->handle(
        $request = Illuminate\Http\Request::capture()
    );
    $response->send();
    $kernel->terminate($request, $response);
}
PHP;
            file_put_contents($indexPhpPath, $indexContent);
            @chmod($indexPhpPath, 0644);
        }

        // ── 5. composer.json fallback ─────────────────────────────────────────
        $composerPath = $workspacePath . '/composer.json';
        if (!file_exists($composerPath) || trim(file_get_contents($composerPath)) === '') {
            // FIX: Use Laravel ^10.0 to match the system prompt default. ^11.0 caused
            // a mismatch: repairLaravelScaffold would detect L11 and write L11 bootstrap,
            // but AI-generated files expected L10 kernel pattern.
            $composerJson = json_encode([
                'name'    => 'ubiq/app',
                'require' => [
                    'php'                  => '^8.1',
                    'laravel/framework'    => '^10.0',
                    'laravel/tinker'       => '^2.8',
                ],
                'autoload' => [
                    'psr-4' => [
                        'App\\'                  => 'app/',
                        'Database\\Factories\\'  => 'database/factories/',
                        'Database\\Seeders\\'    => 'database/seeders/',
                    ],
                ],
                'config' => [
                    'optimize-autoloader' => true,
                    'preferred-install'   => 'dist',
                ],
                'minimum-stability' => 'stable',
                'prefer-stable'     => true,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            file_put_contents($composerPath, $composerJson);
        }
    }

    private function generateStartupScript(array $config, string $workspacePath = ''): string
    {
        $runtime   = $config['runtime'] ?? 'static';
        $framework = $config['framework'] ?? 'html';
        $pm        = $config['package_manager'] ?? 'npm';
        $port      = $config['port'] ?? ($runtime === 'node' ? 5173 : 8000);

        // ── Write critical files to disk NOW (before the container starts) ──
        if ($framework === 'laravel' && $workspacePath !== '') {
            $this->writeLaravelProofingFiles($workspacePath);
        }

        $lines = [
            '#!/bin/sh',
            "echo '[Ubiq] Booting {$framework} on internal port {$port}...'",
            'export TMPDIR=/tmp',
            'mkdir -p /tmp/.cache',
        ];

        // ── System packages ──────────────────────────────────────────────────
        // CRITICAL: Use separate lines with || true for each group.
        // A single long && chain means any failure silently stops the whole
        // script — npm install and ng serve never run. Split into resilient steps.
        $sysPackages = match ($runtime) {
            'node'   => implode("\n", [
                // Base tools always needed
                'apk add --no-cache git curl 2>&1 || true',
                // Build tools for Angular native addons (esbuild, @angular-devkit)
                // Non-fatal: React/Vue work fine without them
                'apk add --no-cache python3 make g++ 2>&1 || true',
            ]),
            'php'    => implode("\n", [
                'apk add --no-cache git zip unzip libzip-dev sqlite-dev nodejs npm curl 2>&1',
                'curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer',
            ]),
            'python' => 'apk add --no-cache git build-base libffi-dev 2>&1 || true',
            default  => '',
        };
        if ($sysPackages !== '') {
            $lines[] = $sysPackages;
        }

        // ── Install dependencies (WITH AI INTERCEPTION) ──────────────────────
        if (!empty($config['install'])) {
            foreach ((array) $config['install'] as $cmd) {
                if (str_contains($cmd, 'composer') && (str_contains($cmd, 'install') || str_contains($cmd, 'update'))) {
                    $lines[] = "composer config platform-check false 2>/dev/null || true";
                    if (!str_contains($cmd, '--ignore-platform-reqs')) $cmd .= " --ignore-platform-reqs";
                    if (!str_contains($cmd, '--no-interaction')) $cmd .= " --no-interaction";
                    if (!str_contains($cmd, '--no-scripts')) $cmd .= " --no-scripts"; 
                }
                $lines[] = "echo '[Ubiq] Running: {$cmd}'";
                $lines[] = $cmd;
            }
        } else {
            $lines = array_merge($lines, $this->defaultInstallCommands($runtime, $pm));
        }

        // ── Post-Install Laravel AI-Proofing ─────────────────────────────────
        if ($framework === 'laravel') {
            $lines[] = "echo '[Ubiq] Applying Post-Install Laravel Fixes...'";

            // FIX: Set permissions INSIDE the container (after Docker mount).
            // The host creates these dirs as ubuntu:ubuntu but the container runs as root.
            // storage/ and bootstrap/cache/ need to be writable for Laravel.
            // database/ and database.sqlite need 0777/0666 so SQLite can write.
            // Without this, migrations fail with "attempt to write a readonly database".
            $lines[] = "chmod -R 777 /app/storage /app/bootstrap/cache 2>/dev/null || true";
            $lines[] = "chmod -R 777 /app/database 2>/dev/null || true";
            $lines[] = "[ -f /app/database/database.sqlite ] && chmod 666 /app/database/database.sqlite || touch /app/database/database.sqlite && chmod 666 /app/database/database.sqlite";

            // Safely dump autoload
            $lines[] = "composer dump-autoload --optimize --no-scripts 2>/dev/null || true";

            // Neutralize platform check
            $lines[] = "echo '<?php // platform check neutralized' > /app/vendor/composer/platform_check.php 2>/dev/null || true";
        }

        // ── Build step (optional) ────────────────────────────────────────────
        if (!empty($config['build'])) {
            foreach ((array) $config['build'] as $cmd) {
                $lines[] = "echo '[Ubiq] Build: {$cmd}'";
                $lines[] = $cmd;
            }
        }

        // ── Start server ─────────────────────────────────────────────────────
        if (!empty($config['start'])) {
            $lines[] = "echo '[Ubiq] Starting (from ubiq.json)...'";
            $lines[] = $config['start'];
        } else {
            $lines = array_merge($lines, $this->defaultStartCommands($runtime, $framework, $pm, $port));
        }

        return implode("\n", array_filter($lines, fn($l) => $l !== '')) . "\n";
    }

    private function defaultInstallCommands(string $runtime, string $pm): array {
        return match($runtime) {
            'node' => match($pm) {
                'pnpm'  => [
                    "echo '[Ubiq] Installing dependencies with pnpm...'",
                    "npm install -g pnpm 2>&1",
                    "pnpm install 2>&1",
                    "echo '[Ubiq] Dependencies installed.'",
                ],
                'bun'   => [
                    "echo '[Ubiq] Installing dependencies with bun...'",
                    "npm install -g bun 2>&1",
                    "bun install 2>&1",
                    "echo '[Ubiq] Dependencies installed.'",
                ],
                'yarn'  => [
                    "echo '[Ubiq] Installing dependencies with yarn...'",
                    "yarn install 2>&1",
                    "echo '[Ubiq] Dependencies installed.'",
                ],
                default => [
                    "echo '[Ubiq] Running npm install (this may take 1-2 minutes)...'",
                    // --no-progress: suppress ANSI progress bars that corrupt log files
                    // --prefer-offline: use cache if available, skip network when possible
                    // Remove the | tee pipe — piping buffers output and nothing appears
                    // in startup.log until npm finishes. Direct stdout flows immediately.
                    "npm install --prefer-offline --no-audit --no-fund --no-progress 2>&1",
                    "echo '[Ubiq] npm install complete.'",
                ],
            },
            'php' => [
                "export COMPOSER_ALLOW_SUPERUSER=1",
                "export COMPOSER_MEMORY_LIMIT=-1",
                "composer config platform-check false 2>/dev/null || true",
                "echo '[Ubiq] Running composer install...'",
                "composer install --ignore-platform-reqs --no-interaction --no-scripts 2>&1",
                "echo '[Ubiq] composer install complete.'",
            ],
            'python' => [
                "echo '[Ubiq] Installing Python dependencies...'",
                "[ -f requirements.txt ] && pip install -r requirements.txt --no-cache-dir 2>&1 || true",
                "[ -f pyproject.toml ] && pip install -e . --no-cache-dir 2>/dev/null || true",
                "echo '[Ubiq] Python dependencies installed.'",
            ],
            default => [],
        };
    }

    private function defaultStartCommands(string $runtime, string $framework, string $pm, int $port): array {
        $runCmd = match($pm) { 'pnpm' => "pnpm", 'bun' => "bun run", 'yarn' => "yarn", default => "npm run" };
        return match(true) {
            $framework === 'nextjs' => [
                "{$runCmd} dev -- -p {$port} -H 0.0.0.0 2>&1 || {$runCmd} start -- -p {$port} -H 0.0.0.0",
            ],
            $framework === 'angular' => [
                // Angular uses Vite + @analogjs/vite-plugin-angular — no Angular CLI.
                // Boots in <30s, same as React/Vue.
                "export VITE_CACHE_DIR=/tmp/.vite-cache",
                "export NODE_OPTIONS='--max-old-space-size=768'",
                "echo '[Ubiq] Starting Angular (Vite) dev server on port {$port}...'",
                "npx vite --host 0.0.0.0 --port {$port} 2>&1",
            ],
            $framework === 'react' || $framework === 'vue' => [
                "export VITE_CACHE_DIR=/tmp/.vite-cache",
                "if [ -f vite.config.js ] || [ -f vite.config.ts ]; then npx vite --host 0.0.0.0 --port {$port}; else {$runCmd} dev -- --host 0.0.0.0 --port {$port}; fi",
            ],
            $framework === 'laravel' => [
                // .env setup
                "if [ ! -f .env ]; then",
                "  if [ -f .env.example ]; then cp .env.example .env; else printf 'APP_KEY=\\nAPP_ENV=local\\nAPP_DEBUG=true\\n' > .env; fi",
                "fi",
                // App key
                "grep -q 'APP_KEY=base64:' .env || php artisan key:generate --force 2>&1 || true",
                // package:discover (safe now — .env + APP_KEY exist)
                "php artisan package:discover --ansi 2>/dev/null || echo '[Ubiq] package:discover skipped (non-fatal)'",
                // Force SQLite — override whatever the AI put in .env or config
                "sed -i 's|^DB_CONNECTION=.*|DB_CONNECTION=sqlite|' .env 2>/dev/null || true",
                "sed -i 's|^DB_DATABASE=.*|DB_DATABASE=/app/database/database.sqlite|' .env 2>/dev/null || true",
                "grep -q '^DB_CONNECTION' .env || printf '\\nDB_CONNECTION=sqlite\\nDB_DATABASE=/app/database/database.sqlite\\n' >> .env",
                // FIX: Force file-based session + cache so we never need a sessions table.
                // AI often generates config/session.php with SESSION_DRIVER=database which
                // requires migrations. File driver works with zero DB setup.
                "sed -i 's|^SESSION_DRIVER=.*|SESSION_DRIVER=file|' .env 2>/dev/null || true",
                "grep -q '^SESSION_DRIVER' .env || printf '\\nSESSION_DRIVER=file\\n' >> .env",
                "sed -i 's|^CACHE_STORE=.*|CACHE_STORE=file|' .env 2>/dev/null || true",
                "sed -i 's|^CACHE_DRIVER=.*|CACHE_DRIVER=file|' .env 2>/dev/null || true",
                "grep -q '^CACHE_STORE' .env || printf '\\nCACHE_STORE=file\\n' >> .env",
                // Re-chmod sqlite in case something changed it
                "chmod 666 /app/database/database.sqlite 2>/dev/null || true",
                // Clear config cache so .env overrides take effect
                "php artisan config:clear 2>&1 || true",
                // Migrations — non-fatal
                "echo '[Ubiq] Running migrations...'",
                "php artisan migrate --force 2>&1 || echo '[Ubiq] Migrations failed (non-fatal), continuing...'",
                // Start
                "echo '[Ubiq] Starting Laravel server on port {$port}...'",
                "php artisan serve --host=0.0.0.0 --port={$port}",
            ],
            $framework === 'fastapi' => [
                "uvicorn main:app --host 0.0.0.0 --port {$port} --reload 2>/dev/null || python main.py",
            ],
            $framework === 'django' => [
                "python manage.py migrate --run-syncdb 2>/dev/null || true",
                "python manage.py runserver 0.0.0.0:{$port}",
            ],
            $framework === 'flask' => [
                "if [ -f app.py ]; then flask run --host=0.0.0.0 --port={$port} || python app.py; elif [ -f main.py ]; then python main.py; fi",
            ],
            $runtime === 'php' => [
                // Raw PHP — no Laravel
                "if [ -d public ]; then php -S 0.0.0.0:{$port} -t public; else php -S 0.0.0.0:{$port}; fi",
            ],
            $runtime === 'node' => [
                "if grep -q '\"dev\"' package.json 2>/dev/null; then " .
                    "{$runCmd} dev -- --host 0.0.0.0 --port {$port} 2>/dev/null || {$runCmd} dev; " .
                "elif grep -q '\"start\"' package.json 2>/dev/null; then {$runCmd} start; " .
                "elif [ -f server.js ]; then node server.js; " .
                "elif [ -f index.js ]; then node index.js; " .
                "else echo '[Ubiq] No entry point found'; fi",
            ],
            default => [
                "[ -f public/index.html ] && mv public/index.html . 2>/dev/null || true",
                "echo '[Ubiq] Static site ready.'",
                "tail -f /dev/null",
            ],
        };
    }
}