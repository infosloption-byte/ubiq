<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\File;
use App\Models\SandboxRun;
use App\Models\UserGithubToken;
use App\Services\PlanGuard;
use App\Services\PlanService;
use App\Exceptions\PlanLimitExceededException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File as FileSystem; 
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;

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

            // FIX #15: package.json is protected from full AI overwrites
            // (preserves scaffold-critical scripts/versions), but the AI
            // is explicitly instructed elsewhere to add packages it needs
            // — reactAiPrompt() literally says "add react-router-dom to
            // package.json" — and blanket-skipping this file meant that
            // instruction could never take effect. Any AI-authored config
            // (postcss.config.js, a router setup, etc.) that assumed a
            // package was installed was guaranteed to crash on first run,
            // because nothing could ever get that package into
            // package.json. Merge only NEW dependency/devDependency
            // entries instead of skipping outright — see
            // mergePackageJsonDependencies() for exactly what's allowed
            // to change.
            if ($path === 'package.json' && in_array($path, $protected, true)) {
                $this->mergePackageJsonDependencies($project, $projectPath, $content);
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
     * FIX #15: see the scaffold() call site for the full rationale.
     *
     * Merges only genuinely-new dependency/devDependency ENTRIES from the
     * AI's proposed package.json into the real one on disk/DB — never the
     * file wholesale. Specifically:
     *
     *   - scripts, name, type, version, private, etc. are never touched —
     *     only the two dependency maps are read from the AI's content at
     *     all.
     *   - Any package name the scaffold itself already lists (react, vite,
     *     next, vue, ...) is left exactly as the scaffold pinned it, even
     *     if the AI's proposed package.json has a different version for
     *     it — this can't be used to downgrade or destabilize the
     *     scaffold, only to add packages that weren't there before.
     *   - Version strings are sanity-checked (must start with an optional
     *     ^/~ followed by a digit) before being accepted, so malformed or
     *     hallucinated values can't end up in package.json and break
     *     `npm install` outright.
     */
    private function mergePackageJsonDependencies(Project $project, string $projectPath, string $aiProposedContent): void
    {
        $aiPkg = json_decode($aiProposedContent, true);
        if (!is_array($aiPkg)) {
            return; // not valid JSON — nothing safe to do with it
        }

        $pkgPath = $projectPath . '/package.json';
        $current = FileSystem::exists($pkgPath) ? json_decode((string) file_get_contents($pkgPath), true) : null;
        if (!is_array($current)) {
            return; // scaffold's own package.json missing/corrupt — bail rather than guess
        }

        $added = [];
        foreach (['dependencies', 'devDependencies'] as $depKey) {
            if (!is_array($aiPkg[$depKey] ?? null)) {
                continue;
            }

            foreach ($aiPkg[$depKey] as $pkgName => $version) {
                if (!is_string($pkgName) || $pkgName === '') {
                    continue;
                }
                // Already pinned by the scaffold (in either dep map) —
                // leave it exactly as-is, don't let the AI change it.
                if (isset($current['dependencies'][$pkgName]) || isset($current['devDependencies'][$pkgName])) {
                    continue;
                }
                if (!is_string($version) || !preg_match('/^[\^~]?\d/', $version)) {
                    continue; // reject anything that isn't a plausible semver range
                }

                $current[$depKey][$pkgName] = $version;
                $added[] = $pkgName;
            }
        }

        if (empty($added)) {
            return;
        }

        $newContent = json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
        file_put_contents($pkgPath, $newContent);

        $project->files()->updateOrCreate(
            ['path' => 'package.json'],
            [
                'name'       => 'package.json',
                'content'    => $newContent,
                'language'   => $this->detectLanguage('json'),
                'size_bytes' => strlen($newContent),
                'is_deleted' => false,
            ]
        );

        Log::info('[Ubiq] scaffold: merged new package.json dependencies for project ' . $project->id . ': ' . implode(', ', $added));
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
        // E4 fix (PLAN_SYSTEM_TASKS.md Phase E): falls back to the user's
        // own Privacy-tab default instead of a hardcoded 'private' when
        // the create form doesn't pass an explicit visibility.
        $visibility = $request->visibility ?? $user->default_project_visibility ?? 'private';
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
                // F3c (PLAN_SYSTEM_TASKS.md Phase F): prefer the user's
                // connected GitHub OAuth token over a pasted one — the
                // token never has to round-trip through the browser for
                // anyone who's connected their account. request->github_token
                // is kept as a fallback only, for importing a repo the
                // connected account itself doesn't have access to (e.g. a
                // one-off token for someone else's private repo), or for
                // users who haven't gone through Connect GitHub yet — see
                // F3d's migration-path note in the roadmap.
                $githubToken = optional(
                    UserGithubToken::where('user_id', $user->id)->first()
                )->access_token ?? $request->github_token;

                $this->importFromGithub($project, $githubToken, $projectPath);
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

        // P0 fix (F0b): stop the specific run's own container, not a
        // shared project-wide name — matters once concurrent/overlapping
        // runs for the same project are possible without stomping each
        // other's names.
        $openRun = SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->latest('started_at')
            ->first();
        $containerName = $openRun?->docker_name ?? "ubiq_project_{$project->id}";

        // -f so this can never hang behind a graceful-stop timeout and
        // leave the port held — same reasoning as in runProject().
        Process::run("docker rm -f {$containerName} 2>/dev/null || true");

        // FIX #13: verify before declaring victory, same as everywhere
        // else that removes a container (reapStaleSandboxes,
        // CleanupSandboxes, runProject's pre-run cleanup). An unverified
        // "docker rm -f" here was the other place a silently-failed
        // removal could mark a row stopped and release its counter while
        // the container — and the port it's bound to — kept existing.
        $stillThere = Process::run("docker ps -a --filter name=^/{$containerName}\$ --format '{{.Names}}'");
        if (trim($stillThere->output()) !== '') {
            Log::error("[Sandbox] stopProject: failed to remove {$containerName} for project {$project->id}.");
            return response()->json(['error' => 'Could not stop the sandbox cleanly. Please try again.'], 500);
        }

        // Stamp the most recent open audit run for this project
        $openRun?->update(['stopped_at' => now()]);

        $this->planGuard->release($request->user(), 'active_sandboxes');

        // F1b: same cleanup as the other confirmed-removal call sites —
        // pre-F0b rows have no id-backed compose file to find, so guard
        // against the null case rather than passing a bare fallback name.
        if ($openRun) {
            $this->cleanupRuntimeCompose($openRun);
        }

        return response()->json(['message' => 'Container stopped.']);
    }

    /**
     * FIX #11: Lightweight heartbeat, pinged periodically by the frontend
     * while a sandbox's preview is actually open (see useSandboxAutoStop.ts).
     *
     * The existing beforeunload/unmount hooks only fire on a clean tab
     * close or in-app navigation — a laptop sleep or dropped connection
     * skips both, leaving the sandbox (and its port) alive until the
     * cron's idle timeout, which can be tens of minutes to hours depending
     * on plan tier. Recording a heartbeat lets CleanupSandboxes treat
     * "no heartbeat for ~2 minutes" as abandoned, independent of the
     * longer tier-based idle timeout used for genuinely-idle-but-open
     * sandboxes.
     */
    public function heartbeat(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $updated = SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->latest('started_at')
            ->first()
            ?->update(['heartbeat_at' => now()]);

        return response()->json(['ok' => (bool) $updated]);
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

        // Kill sandbox container(s) first — prevents orphaned containers.
        // P0 fix (F0b): stop every still-open run's own container by its
        // stored name, not one shared project-wide name — plus the same
        // legacy-name sweep runProject() uses, to catch anything left
        // over from before container_name existed.
        $openRuns = \App\Models\SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->get();
        foreach ($openRuns as $openRun) {
            Process::run("docker rm -f {$openRun->docker_name} 2>/dev/null || true");
        }
        Process::run("docker rm -f ubiq_project_{$project->id} 2>/dev/null || true");

        // Stamp any open audit run as stopped
        \App\Models\SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->update(['stopped_at' => now()]);

        // Was missing entirely: deleting a project while its sandbox was
        // running never released the active_sandboxes counter — the same
        // gap stopProject()/CleanupSandboxes already handle for their own
        // paths. Safe to call unconditionally; release() is a no-op if
        // the counter's already at 0 (see PlanGuard::release).
        $this->planGuard->release($request->user(), 'active_sandboxes');

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
     * FIX #11: Atomic port allocation — replaces the old probe-then-retry
     * approach (FIX #10) entirely.
     *
     * FIX #10 probed a port with stream_socket_server(), then handed it to
     * Docker, and retried up to 3 times if Docker reported "address already
     * in use". That's a mitigation, not a fix — two concurrent requests can
     * still both pass the probe for the same port before either binds it
     * (classic TOCTOU), and repeated bad luck could still exhaust the 3
     * retries and surface an error to the user.
     *
     * This version claims the port inside a distributed lock (Cache::lock,
     * backed by whatever cache store is configured — redis/database/etc.)
     * and immediately reserves it by inserting an open SandboxRun row for
     * that port BEFORE releasing the lock and BEFORE calling Docker at all.
     * Because the reservation happens inside the lock, no other request can
     * observe that port as free until we've committed to it — the race is
     * gone, not just retried around.
     *
     * "occupied" is determined purely from our own bookkeeping (open
     * SandboxRun rows), not from OS-level socket probing, which is why
     * step 0 (reapStaleSandboxes) matters: if we ever fail to clean up an
     * open row for a container that's actually dead, this method would
     * treat that port as permanently unavailable. reapStaleSandboxes()
     * closes that gap by reconciling DB state against real Docker state
     * before every run.
     *
     * @throws \RuntimeException if the entire range is occupied
     * @return array{0:int,1:SandboxRun} [$port, $reservationRow]
     */
    private function claimPortAndReserve(Project $project, $user, string $runtime, string $framework, int $start = 8100, int $end = 8899): array
    {
        $lock = Cache::lock('sandbox-port-allocation', 10);

        return $lock->block(5, function () use ($project, $user, $runtime, $framework, $start, $end) {
            $used = SandboxRun::whereNull('stopped_at')->pluck('port')->all();

            for ($port = $start; $port <= $end; $port++) {
                if (in_array($port, $used, true)) {
                    continue;
                }

                // FIX #13: our own bookkeeping isn't the only thing that can
                // occupy a host port. An orphaned container from a failed
                // cleanup (docker rm that silently failed and got marked
                // stopped anyway — see reapStaleSandboxes fix below), or
                // literally any other process/container on this box, can
                // hold a port with zero record in sandbox_runs. Purely
                // trusting the DB here (as this method did before FIX #13)
                // meant we'd confidently hand Docker a port it was going to
                // reject, forever, since the DB would never stop believing
                // that port was free.
                //
                // This binds 0.0.0.0 (matching how `docker run -p` actually
                // publishes) rather than 127.0.0.1, so it reflects the same
                // interface Docker itself needs — a wildcard bind by
                // anything else on this port will correctly fail here too.
                // This is a live check only for the 1-2 candidate ports we
                // actually try (not an 800-port scan), so it doesn't
                // reintroduce the concurrent-request race FIX #11 removed —
                // that race is still fully closed by the DB claim above,
                // which is evaluated first and is what two of *our own*
                // simultaneous requests would collide on. This check only
                // ever fires for genuinely untracked occupancy.
                $sock = @stream_socket_server("tcp://0.0.0.0:{$port}", $errno, $errstr);
                if ($sock === false) {
                    Log::warning("[Sandbox] Port {$port} is free in our DB but occupied at the OS level ({$errstr}) — skipping. Likely an untracked or orphaned container; consider `docker ps | grep {$port}`.");
                    continue;
                }
                fclose($sock);

                // Reserve immediately, while still holding the lock, so the
                // very next claimPortAndReserve() call (even microseconds
                // later) sees this port as used.
                $run = SandboxRun::create([
                    'user_id'      => $user->id,
                    'project_id'   => $project->id,
                    'ip_address'   => request()->ip(),
                    'user_agent'   => substr(request()->userAgent() ?? '', 0, 500),
                    'started_at'   => now(),
                    'heartbeat_at' => now(),
                    'port'         => $port,
                    'runtime'      => $runtime,
                    'framework'    => $framework,
                ]);

                // P0 fix (F0b): stamp a container name unique to THIS run,
                // not just this project — "ubiq_project_{id}_run{run->id}"
                // instead of the old shared "ubiq_project_{id}". Has to
                // happen after create() since it needs the row's own id.
                // This is what lets reapStaleSandboxes() (and every other
                // container-state check) tell an old run's container apart
                // from a brand-new run's container instead of the two
                // being indistinguishable by name.
                $run->update(['container_name' => "ubiq_project_{$project->id}_run{$run->id}"]);

                return [$port, $run];
            }

            throw new \RuntimeException("No free port found in range {$start}-{$end}");
        });
    }

    /**
     * FIX #11: Self-healing reap, run at the start of every runProject()
     * call for the requesting user (not just on the 15-minute cron).
     *
     * Because port occupancy is now determined from open SandboxRun rows
     * rather than OS sockets, a row that says "open" but whose container is
     * actually dead (crashed, OOM-killed, or a "docker rm" that silently
     * failed) would otherwise camp on a port forever. This reconciles this
     * user's own open rows against real Docker state and closes any that
     * are lying, immediately before we try to claim a new port — so a user
     * who hits a crashed sandbox self-heals on their very next click instead
     * of waiting on the cron.
     *
     * Scoped to the current user only (typically 1-3 rows) to keep this
     * cheap enough to run synchronously on every request.
     */
    private function reapStaleSandboxes($user): void
    {
        $openRuns = SandboxRun::where('user_id', $user->id)->whereNull('stopped_at')->get();

        foreach ($openRuns as $run) {
            // P0 fix (F0b): per-run name (docker_name accessor falls back
            // to the old project-scoped name for pre-migration rows). Before
            // this, every row for the same project shared one container
            // name, so a genuinely-alive *new* run's container made this
            // check report "still running" for an *old*, already-replaced
            // row too — that row's slot then never got reaped.
            $containerName = $run->docker_name;
            $state = Process::run("docker inspect -f '{{.State.Running}}' {$containerName}");

            if (trim($state->output()) === 'true') {
                continue; // genuinely still running — leave it alone
            }

            // Container is gone, exited, or was never actually created —
            // force-remove any remnant and free the port/plan-slot it held.
            Log::warning("[Sandbox] Reaping stale run for project {$run->project_id} (container not running).");
            Process::run("docker rm -f {$containerName} 2>/dev/null || true");

            // FIX #13: verify the removal actually worked before declaring
            // this row closed. Previously this update() ran unconditionally
            // — if `docker rm -f` silently failed (daemon busy, container
            // stuck in a weird state, permissions), the row would be marked
            // stopped and the counter released while the real container
            // (and its port binding) kept right on existing, invisible to
            // every check we have from that point on. That's the exact
            // mechanism that produced the orphaned container this fix is
            // responding to. If removal didn't actually take, we leave the
            // row open and the counter charged — visibly stuck and worth
            // investigating, rather than silently wrong.
            $stillThere = Process::run("docker ps -a --filter name=^/{$containerName}\$ --format '{{.Names}}'");
            if (trim($stillThere->output()) !== '') {
                Log::error("[Sandbox] Failed to remove container {$containerName} during reap — leaving run #{$run->id} open rather than losing track of it. Manual cleanup needed: docker rm -f {$containerName}");
                continue;
            }

            $run->update(['stopped_at' => now()]);
            $this->planGuard->release($user, 'active_sandboxes');
            $this->cleanupRuntimeCompose($run);
        }

        // FIX #16: hard backstop after the per-row pass above. That pass
        // can only fix leaks tied to a row that still exists — it cannot
        // help if authorize() incremented the counter and the request died
        // before claimPortAndReserve() ever created a row at all (worker
        // crash, or nginx's fastcgi_read_timeout racing our own Docker
        // process timeout — both sit at 120s). Clamp the counter down to
        // the TRUE number of open rows remaining for this user; see
        // PlanGuard::reconcileConcurrent() for why this is safe to do
        // unconditionally (one-directional, can't stomp a genuinely
        // concurrent new claim).
        $trueOpenCount = SandboxRun::where('user_id', $user->id)->whereNull('stopped_at')->count();
        $this->planGuard->reconcileConcurrent($user, 'active_sandboxes', $trueOpenCount);
    }

    /**
     * P0 fix (F0a) — see UBIQ_ENHANCEMENT_ROADMAP.md "concurrent sandbox
     * slots leak on every re-run" and PLAN_SYSTEM_TASKS.md F0.
     *
     * Root cause this closes: clicking Run again on a project that's
     * already running (the ordinary edit → Run loop) never told the
     * *previous* run's SandboxRun row it was done. runProject() would go
     * on to force-remove that project's container and start a fresh one
     * under a name Docker considered "new" but our own bookkeeping still
     * associated with the old, now-replaced row — so the old row's
     * concurrent-sandbox slot leaked permanently, once per re-run.
     *
     * This runs BEFORE planGuard->authorize(), same reasoning as
     * reapStaleSandboxes() running before authorize(): a re-run should
     * self-release its own previous slot first, so the plan check that
     * follows sees accurate usage instead of double-counting a run that's
     * about to be replaced anyway.
     *
     * Deliberately unconditional on whether the container is genuinely
     * still alive — unlike reapStaleSandboxes(), which only reaps rows
     * whose container has actually died. A re-run always intends to
     * replace whatever's currently running for this project, dead or
     * alive, so there's no need for (and no point in) a docker inspect
     * check first here.
     *
     * Reuses the same kill → verify → stamp → release sequence
     * stopProject() already has, rather than inventing a second version
     * of that logic.
     */
    private function closeOpenRunForProject(Project $project, $user): void
    {
        $openRun = SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->latest('started_at')
            ->first();

        if (!$openRun) {
            return; // nothing running for this project — normal first run
        }

        $containerName = $openRun->docker_name;

        // -f so this can never hang behind a graceful-stop timeout —
        // same reasoning as stopProject()/reapStaleSandboxes().
        Process::run("docker rm -f {$containerName} 2>/dev/null || true");

        $stillThere = Process::run("docker ps -a --filter name=^/{$containerName}\$ --format '{{.Names}}'");
        if (trim($stillThere->output()) !== '') {
            // Don't mark it closed if it didn't actually go away — same
            // "leave it open and visibly stuck rather than silently
            // wrong" reasoning used everywhere else this pattern appears.
            // The pre-run cleanup a few lines later in runProject() gets
            // one more attempt at removing it before the new container
            // starts.
            Log::error("[Sandbox] closeOpenRunForProject: failed to remove {$containerName} for project {$project->id} (run #{$openRun->id}). Leaving that run open.");
            return;
        }

        $openRun->update(['stopped_at' => now()]);
        $this->planGuard->release($user, 'active_sandboxes');
        $this->cleanupRuntimeCompose($openRun);

        Log::info("[Sandbox] Self-released previous run #{$openRun->id} for project {$project->id} before starting a new one.");
    }

    /**
     * Start a Docker Sandbox container to run the project.
     *
     * FIX #12: Two additional problems found after FIX #11 shipped, both
     * causing the SAME symptom — a user permanently stuck at their
     * concurrent-sandbox limit ("Sandbox limit reached", usage == limit)
     * with zero actual containers running:
     *
     *   (a) reapStaleSandboxes() ran AFTER planGuard->authorize(). Once a
     *       user's counter is already maxed out from stale entries,
     *       authorize() throws and returns 429 before the reap ever runs
     *       — the self-heal was unreachable in exactly the situation it
     *       exists to fix. Reap now runs BEFORE authorize().
     *
     *   (b) authorize() increments the 'active_sandboxes' counter, but
     *       only the anticipated failure branches below it (port
     *       exhaustion, stale-container-removal-failed, docker run
     *       failure) called release(). Any *unanticipated* exception
     *       between authorize() succeeding and the method returning
     *       (config detection, script generation, a disk write failing,
     *       anything) skipped every release() call and leaked the
     *       counter by 1, permanently — this is almost certainly how a
     *       Pro user (limit 2) ended up stuck at usage 2 with nothing
     *       actually running. The whole post-authorize body is now
     *       wrapped in try/catch(\Throwable) so literally nothing can
     *       exit this method without either succeeding or releasing what
     *       it reserved.
     */
    public function runProject(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $user = $request->user();

        // FIX #12(a): reap THIS user's own dead sandboxes before the plan
        // check, not after — otherwise a user already stuck at their limit
        // from stale entries can never reach the code that would fix it.
        $this->reapStaleSandboxes($user);

        // P0 fix (F0a): self-release THIS project's own previous run, if
        // any, before the plan check — the ordinary "edit code, click Run
        // again" loop must never cost a permanent slot. See
        // closeOpenRunForProject()'s docblock for the full root-cause
        // reasoning; this is what actually fixes the reported bug, reap
        // above only ever helped with already-dead containers.
        $this->closeOpenRunForProject($project, $user);

        // Check BEFORE any file writes / docker stop-rm / docker run — no
        // point doing expensive work for a request we're about to deny.
        // This increments the 'active_sandboxes' concurrent counter on
        // success; FIX #12(b) below guarantees release() fires on every
        // exit path from here on, not just the ones we anticipated.
        try {
            $this->planGuard->authorize($user, 'sandbox.start');
        } catch (PlanLimitExceededException $e) {
            return response()->json([
                'error' => 'Sandbox limit reached',
                'reason' => $e->reason,
                'limit' => $e->limitValue,
                'usage' => $e->currentUsage,
            ], 429);
        }

        // FIX #12(b): guaranteed release. $sandboxRun is only non-null
        // once claimPortAndReserve() has actually created the row: if we
        // fail before that point, there's no row to close, only the
        // counter to release. If we fail after, both need to be undone.
        // The success `return` at the bottom of the try block skips this
        // catch entirely, same as normal.
        $sandboxRun = null;

        try {
            $workspacePath = $this->getProjectPath($project);
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
        // P0 fix (F0b): closeOpenRunForProject() above already closed out
        // this project's *tracked* previous run, so under normal
        // operation there's nothing left here to remove. This sweep is
        // now defense-in-depth only, for a container that exists without
        // a matching open SandboxRun row (crash between docker run and
        // row bookkeeping, or a container left over from before this fix
        // shipped) — matches both the legacy shared name and any
        // run-scoped name for this project, since we don't know which
        // form an untracked leftover would be using.
        // -f forces removal even if the container is in a stuck/"Removing"
        // state, and we verify it's actually gone rather than trusting the
        // exit code — a lingering container here would hold its old port
        // hostage regardless of what claimPortAndReserve() decides next.
        $namePattern = "^/ubiq_project_{$project->id}(\$|_run[0-9]+\$)";
        $strayIds = trim(Process::run("docker ps -aq --filter \"name={$namePattern}\"")->output());
        if ($strayIds !== '') {
            $strayIds = str_replace("\n", ' ', $strayIds);
            Process::run("docker rm -f {$strayIds} 2>/dev/null || true");
        }

        $stillThere = Process::run("docker ps -aq --filter \"name={$namePattern}\"");
        if (trim($stillThere->output()) !== '') {
            Log::error("[Sandbox] Could not remove a stale container for project {$project->id} before restart.");
            $this->planGuard->release($request->user(), 'active_sandboxes');
            return response()->json(['error' => 'A previous instance of this sandbox could not be cleaned up. Please try again in a moment.'], 500);
        }

        // --- 4. SELECT DOCKER IMAGE ---
        $dockerConfig = $this->selectDockerImage($config);
        $image = $dockerConfig['image'];
        $internalPort = $dockerConfig['port'];

        // F1a (PLAN_SYSTEM_TASKS.md Phase F): externalize the real Docker
        // config into the project itself, not just an in-memory `docker
        // run` command that only ever lives on the platform side. Same
        // image-selection source of truth ($dockerConfig above) the
        // sandbox itself just used, so this can't silently drift out of
        // sync with what actually ran — one method, two consumers.
        //
        // The live sandbox bind-mounts the workspace into a stock image
        // for a fast dev loop (no rebuild per keystroke); the exported
        // Dockerfile deliberately does NOT mirror that bind-mount
        // approach, since a bind-mount pointing at Ubiq's own host path
        // wouldn't mean anything on someone else's server. Instead it's a
        // genuine, self-contained, buildable image (COPY, not mount) —
        // `docker build && docker run` should just work anywhere Docker
        // is installed, independent of Ubiq's infra entirely.
        $this->writeDockerfile($project, $workspacePath, $image, $internalPort);

        // F1b: written alongside the Dockerfile every run, same reasoning
        // as F1a — this is the source of truth for "what would self-deploy
        // actually look like", regenerated fresh each time so it can never
        // silently drift from whatever framework/runtime was last detected.
        $this->writeDockerComposeExport($project, $workspacePath, $internalPort);

        // --- 5. CLAIM PORT (atomic — see claimPortAndReserve docblock) ---
        try {
            [$port, $sandboxRun] = $this->claimPortAndReserve($project, $user, $runtime, $framework);
        } catch (\RuntimeException $e) {
            $this->planGuard->release($request->user(), 'active_sandboxes');
            return response()->json(['error' => 'No free ports available. Try again later.'], 503);
        }

        // P0 fix (F0b): the container this run actually starts is named
        // after $sandboxRun's own id (stamped in claimPortAndReserve),
        // not the shared per-project name used above for the pre-run
        // sweep — this is what makes every check downstream of this
        // point (reapStaleSandboxes, stopProject, getBuildLog) able to
        // tell this specific run's container apart from any other run of
        // the same project.
        $containerName = $sandboxRun->docker_name;

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

        // F1b (PLAN_SYSTEM_TASKS.md Phase F): moved off a single `docker
        // run` string to a generated `docker-compose.yml`, per-run, so a
        // future `db:` service (F1c) has somewhere to live alongside the
        // app service without inventing a second execution path. Deliberately
        // a drop-in equivalent for now — same image, same bind mount, same
        // resource limits/security flags as the old `docker run` command,
        // just expressed as one compose service. Every downstream cleanup
        // path (stopProject, reapStaleSandboxes, closeOpenRunForProject,
        // the pre-run stray sweep above) still works completely unchanged:
        // they all operate on `docker rm -f <container_name>` / `docker ps
        // --filter name=...`, and a container compose creates is a perfectly
        // ordinary container by that name — nothing about those call sites
        // needed to know compose exists.
        //
        // Two infra constraints shaped this, found while implementing (not
        // guesses — checked the actual files):
        //   1. The root docker-compose.yml's socket-proxy sidecar has
        //      NETWORKS:0 and VOLUMES:0 — it rejects POST /networks/create
        //      and /volumes/create over the proxied Docker API. Compose
        //      normally tries to create its own default network per
        //      project, which would silently fail against that proxy. Fixed
        //      by declaring `ubiq_sandbox` as `external: true` below, the
        //      same pre-existing network `--network=ubiq_sandbox` already
        //      just attached to — compose never asks to create it.
        //   2. backend/Dockerfile only ever installed `docker-ce-cli`, never
        //      `docker-compose-plugin` — `docker compose` would have been
        //      "unknown command" with no other change. Added to the apt
        //      install line in the same commit as this.
        $composeYaml = $this->buildRuntimeComposeYaml(
            containerName: $containerName,
            image: $image,
            port: $port,
            internalPort: $internalPort,
            hostMountPath: $hostMountPath,
            memoryLimit: $memoryLimit,
            memorySwap: $memorySwap,
            tierCpu: $tierCpu,
            pidsLimit: $pidsLimit,
        );

        $composePath = $this->runtimeComposePath($sandboxRun);
        FileSystem::makeDirectory(dirname($composePath), 0755, true, true);
        file_put_contents($composePath, $composeYaml);

        // Unique per run (not per project) — avoids two rapid-fire runs of
        // the same project ever sharing compose's own project-scoped state
        // even for the instant before the earlier run's row is closed.
        $composeProjectName = "ubiq-run{$sandboxRun->id}";

        $cmd = implode(' ', [
            'docker compose',
            '-f', escapeshellarg($composePath),
            '-p', escapeshellarg($composeProjectName),
            'up -d',
        ]);

        $result = Process::timeout(120)->run($cmd);

        if (!$result->successful()) {
            // Port collisions are structurally impossible now (the port was
            // reserved in our own DB before this call), so a failure here
            // is a genuine Docker/image/resource problem — release the
            // reservation and the plan slot and surface it as-is.
            Log::error("[Sandbox] docker compose up failed for project {$project->id}: " . $result->errorOutput());
            $sandboxRun->update(['stopped_at' => now()]);
            Process::run("docker rm -f {$containerName} 2>/dev/null || true");
            @unlink($composePath);
            $this->planGuard->release($request->user(), 'active_sandboxes');
            return response()->json(['error' => 'Docker failed to start the sandbox.', 'details' => $result->errorOutput()], 500);
        }

        $serverIp = env('SERVER_PUBLIC_IP', $request->getHost());

        return response()->json([
            'message'   => 'Project booting...',
            'url'       => "http://{$serverIp}:{$port}",
            'port'      => $port,
            'runtime'   => $runtime,
            'framework' => $framework,
        ]);

        } catch (\Throwable $e) {
            // FIX #12(b): the actual guarantee. Whatever broke — a bug in
            // config detection, a disk write failing, anything we didn't
            // specifically anticipate above — the counter this method
            // incremented via authorize() gets released, and if a port had
            // already been reserved (claimPortAndReserve succeeded before
            // the failure), that reservation and any container it started
            // are torn down too. Without this, every unanticipated failure
            // here leaked the user's concurrent-sandbox slot permanently,
            // which is what produced a Pro user stuck at usage==limit with
            // nothing actually running.
            Log::error("[Sandbox] Unhandled exception in runProject for project {$project->id}: {$e->getMessage()}");

            if ($sandboxRun !== null) {
                $sandboxRun->update(['stopped_at' => now()]);
                // P0 fix (F0b): use this run's own container name, not
                // the shared per-project one — the run-scoped container
                // is what actually exists (or was about to) at this point.
                Process::run("docker rm -f {$sandboxRun->docker_name} 2>/dev/null || true");
            }

            $this->planGuard->release($user, 'active_sandboxes');

            return response()->json(['error' => 'Failed to start the sandbox.', 'details' => $e->getMessage()], 500);
        }
    }

    /**
     * FIX #14: implements the container_status / exit_code / port_ready
     * contract the frontend poller has been reading since it was written —
     * this endpoint only ever returned { log }, so every real stop
     * condition in ProjectRunner.tsx (port answering, container exited)
     * was structurally unreachable, and polling never stopped on its own.
     *
     * Two constraints shaped this implementation (see docker-compose.yml):
     *   - docker inspect .State.Status is USELESS for crash detection —
     *     runProject's startup command intentionally falls back to
     *     `tail -f /dev/null` on failure, so the container stays
     *     "running" forever even after the real app process has died.
     *   - docker exec (which could pgrep the real process directly) is
     *     rejected by the socket-proxy (EXEC: 0), so that's not available
     *     either.
     *
     * What IS available and used below:
     *   - the log file itself, straight off the mounted volume, no
     *     Docker involved at all.
     *   - a real TCP check of the container's published host port, via
     *     host.docker.internal (already in docker-compose.yml's
     *     extra_hosts) — this is the one signal that can't lie: a log
     *     line saying "ready" doesn't mean the process didn't crash a
     *     moment later, which is exactly what happened with the
     *     Vite-then-PostCSS-crash case that motivated this fix.
     */
    public function getBuildLog(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) abort(403);

        $logPath = $this->getProjectPath($project) . '/startup.log';
        $log = file_exists($logPath) ? file_get_contents($logPath) : 'Waiting for logs...';

        $run = SandboxRun::where('project_id', $project->id)
            ->whereNull('stopped_at')
            ->latest('started_at')
            ->first();

        if (!$run) {
            return response()->json([
                'log' => $log, 'container_status' => 'missing',
                'exit_code' => null, 'port_ready' => false,
            ]);
        }

        // P0 fix (F0b): use this specific run's own container name.
        $containerName = $run->docker_name;
        $inspect = Process::run("docker inspect -f '{{.State.Status}}' {$containerName}");
        $dockerStatus = trim($inspect->output());

        if (!$inspect->successful() || $dockerStatus === '') {
            // Genuinely gone — not just the tail-fallback keep-alive, e.g.
            // OOM-killed the whole cgroup, or removed out from under us.
            return response()->json([
                'log' => $log, 'container_status' => 'missing',
                'exit_code' => null, 'port_ready' => false,
            ]);
        }

        if ($dockerStatus !== 'running') {
            return response()->json([
                'log' => $log, 'container_status' => 'exited',
                'exit_code' => null, 'port_ready' => false,
            ]);
        }

        // Real readiness — the only signal here immune to misleading log
        // text. Published on the host by `docker run -p`; reachable from
        // this container via host.docker.internal.
        $portReady = false;
        if ($run->port) {
            $sock = @fsockopen('host.docker.internal', $run->port, $errno, $errstr, 0.5);
            if ($sock) { $portReady = true; fclose($sock); }
        }

        // Immediate crash detection: Node always prints its version banner
        // as the LAST line of output when an uncaught exception/unhandled
        // rejection kills the process — exactly what the tailwindcss/
        // PostCSS failure did here, right after Vite's own "ready" banner
        // had already printed. This is why matching on log *content*
        // ("ready in ", "local:") is fundamentally unsafe for deciding
        // "stable" — those strings don't stop being true just because
        // something crashed three lines later.
        $crashed = !$portReady && (bool) preg_match('/Node\.js v\d+\.\d+\.\d+\s*$/', rtrim($log));

        // Generic stall fallback, keyed on file mtime rather than log
        // content for the same reason. 60s is generous enough to not
        // false-positive on a slow-but-legitimate install step gone quiet
        // (large package download, native module compile, etc).
        $stalled = !$portReady && file_exists($logPath) && (time() - filemtime($logPath)) > 60;

        if ($crashed || $stalled) {
            return response()->json([
                'log' => $log, 'container_status' => 'exited',
                'exit_code' => null, 'port_ready' => false,
            ]);
        }

        return response()->json([
            'log' => $log, 'container_status' => 'running',
            'exit_code' => null, 'port_ready' => $portReady,
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
     * F1b: where the ephemeral, per-run compose file used to actually
     * launch a sandbox lives. Deliberately outside the project's workspace
     * directory — the workspace's own docker-compose.yml (see
     * writeDockerComposeExport()) is the *portable* version someone takes
     * with them, built from the Dockerfile with no bind mount, and this is
     * not that file. Keeping them physically separate means the export
     * one can never accidentally get overwritten by, or confused with,
     * this Ubiq-infra-specific one.
     */
    private function runtimeComposePath(SandboxRun $sandboxRun): string
    {
        return storage_path("app/sandbox-runtime/run-{$sandboxRun->id}.yml");
    }

    /**
     * F1b: delete a run's ephemeral compose file once its container is
     * confirmed gone. Every call site below already verifies removal
     * before calling this — no point deleting the file description of a
     * container that might still be alive. Not calling this anywhere isn't
     * a correctness bug (buildRuntimeComposeYaml() always regenerates
     * before the next run reads it), just an unbounded-growth one in
     * storage/app/sandbox-runtime/, so it's cheap to be thorough here.
     */
    private function cleanupRuntimeCompose(SandboxRun $run): void
    {
        @unlink($this->runtimeComposePath($run));
    }

    /**
     * F1b: build the compose YAML for one run. Single `app` service today —
     * a deliberate drop-in equivalent for the `docker run` command this
     * replaces, not a redesign. F1c adds a `db:` service alongside this one
     * in the same file; nothing here needs to change for that to happen.
     *
     * Hand-built string rather than symfony/yaml (not already a dependency)
     * — same approach writeDockerfile() already uses for its generated
     * file, so this stays consistent with existing style rather than
     * introducing a new pattern for one generator.
     */
    private function buildRuntimeComposeYaml(
        string $containerName,
        string $image,
        int $port,
        int $internalPort,
        string $hostMountPath,
        string $memoryLimit,
        string $memorySwap,
        string $tierCpu,
        int $pidsLimit,
    ): string {
        // startup.sh already writes its own output to startup.log inside
        // /app (see the writeStartupScript step above); the `|| tail -f
        // /dev/null` fallback keeps the container alive for build-log
        // inspection even if startup.sh itself exits non-zero, exactly as
        // the old `docker run` command's command string did.
        $command = "sh startup.sh > /app/startup.log 2>&1 || tail -f /dev/null";

        return <<<YAML
        # Generated by Ubiq at run time (F1b) — NOT the portable
        # docker-compose.yml in the project's own files. This one is
        # Ubiq-infra-specific (bind mount, tier-based resource limits,
        # the pre-existing `ubiq_sandbox` network) and is never shipped
        # in a download. Regenerated fresh on every run; safe to delete
        # between runs.
        services:
          app:
            image: {$image}
            container_name: {$containerName}
            working_dir: /app
            ports:
              - "{$port}:{$internalPort}"
            environment:
              PORT: "{$internalPort}"
            volumes:
              - {$hostMountPath}:/app
            command: ["sh", "-c", "{$command}"]
            mem_limit: {$memoryLimit}
            memswap_limit: {$memorySwap}
            cpus: "{$tierCpu}"
            pids_limit: {$pidsLimit}
            ulimits:
              nofile:
                soft: 1024
                hard: 1024
              nproc:
                soft: 100
                hard: 100
            cap_drop:
              - ALL
            cap_add:
              - NET_BIND_SERVICE
            security_opt:
              - no-new-privileges:true
            logging:
              driver: json-file
              options:
                max-size: "10m"
                max-file: "1"
            restart: "no"
            networks:
              default: {}

        # Pre-existing network created out-of-band on the host (not defined
        # anywhere in the root docker-compose.yml either) — `external: true`
        # is what stops compose from trying its usual POST /networks/create,
        # which the socket-proxy's NETWORKS:0 setting would reject outright.
        networks:
          default:
            name: ubiq_sandbox
            external: true

        YAML;
    }

    /**
     * F1a (PLAN_SYSTEM_TASKS.md Phase F): write a real, standalone
     * Dockerfile into the project workspace and persist it as a project
     * file — the same pattern generateStartupScript()'s caller already
     * uses for startup.sh, applied to a second generated artifact.
     *
     * Deliberately COPY-based, not a bind-mount recreation of how the
     * live sandbox runs things (see the call site's comment for why) —
     * this needs to mean something on a server that has never heard of
     * Ubiq, not replicate an internal dev-loop optimization.
     *
     * Idempotent and cheap: called on every run, same as startup.sh, so
     * the exported Dockerfile can never silently go stale relative to
     * what actually executed — if the detected runtime/framework/image
     * changes between runs (e.g. a dependency bump changes the detected
     * Node major version), the next run's Dockerfile reflects that.
     */
    private function writeDockerfile(Project $project, string $workspacePath, string $image, int $internalPort): void
    {
        $dockerfile = <<<DOCKERFILE
        # Generated by Ubiq — reflects the exact base image this project
        # last ran with in its Ubiq sandbox (see ubiq.json for the
        # detected runtime/framework this was generated from).
        #
        # This file describes a real, standalone image: `docker build -t
        # myapp . && docker run -p 8080:{$internalPort} myapp` should work
        # on any machine with Docker installed, independent of Ubiq.
        #
        # Editing this file has no effect on how the sandbox runs inside
        # Ubiq itself — the live preview uses a faster dev-loop path
        # (mounted source, no rebuild per change) rather than building
        # from this file. This Dockerfile is what you take with you.
        FROM {$image}

        WORKDIR /app
        COPY . .
        RUN chmod +x ./startup.sh 2>/dev/null || true

        EXPOSE {$internalPort}
        CMD ["sh", "startup.sh"]

        DOCKERFILE;

        // <<<DOCKERFILE heredoc above is indented to match surrounding
        // PHP code style; PHP 7.3+ strips the common leading whitespace
        // automatically based on the closing marker's indentation, so no
        // manual trim/dedent needed here.

        file_put_contents($workspacePath . '/Dockerfile', $dockerfile);

        $project->files()->updateOrCreate(
            ['path' => 'Dockerfile'],
            [
                'name'       => 'Dockerfile',
                'content'    => $dockerfile,
                'language'   => 'dockerfile',
                'size_bytes' => strlen($dockerfile),
                'is_deleted' => false,
            ]
        );
    }

    /**
     * F1b: the *portable* docker-compose.yml — written into the project's
     * own workspace (tracked as a project file, shipped automatically by
     * the existing download() zip, same mechanism writeDockerfile() above
     * already uses). This is NOT the file the live Ubiq sandbox actually
     * runs from — see buildRuntimeComposeYaml()'s docblock for why those
     * are deliberately two different files. This one builds from the
     * Dockerfile (`build: .`, no bind mount) so `docker compose up` works
     * standalone on any machine with Docker installed, independent of
     * Ubiq's own network/volume/tier setup — none of which would mean
     * anything on someone else's server anyway.
     *
     * F1c adds a `db:` service into this same generated file — that's the
     * "the generated docker-compose.yml includes the db service" line in
     * the roadmap. Nothing here needs to change for F1c to build on it.
     */
    private function writeDockerComposeExport(Project $project, string $workspacePath, int $internalPort): void
    {
        $compose = <<<YAML
        # Generated by Ubiq — the portable companion to the Dockerfile in
        # this same project. `docker compose up --build` should work on any
        # machine with Docker installed, independent of Ubiq's own infra
        # (this deliberately does not reference Ubiq's private network,
        # per-tier resource limits, or bind-mounted source — those only
        # mean something inside Ubiq's own sandbox).
        #
        # Editing this file has no effect on how the sandbox runs inside
        # Ubiq itself, same as the Dockerfile it builds from.
        services:
          app:
            build: .
            ports:
              - "{$internalPort}:{$internalPort}"
            environment:
              PORT: "{$internalPort}"
            restart: unless-stopped

        YAML;

        file_put_contents($workspacePath . '/docker-compose.yml', $compose);

        $project->files()->updateOrCreate(
            ['path' => 'docker-compose.yml'],
            [
                'name'       => 'docker-compose.yml',
                'content'    => $compose,
                'language'   => 'yaml',
                'size_bytes' => strlen($compose),
                'is_deleted' => false,
            ]
        );
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