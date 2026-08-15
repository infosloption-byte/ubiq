<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\File;
use App\Models\PlanActionLog;
use App\Models\Project;
use App\Services\BoilerplateManager;
use App\Services\PlanGuard;
use App\Services\PlanService;
use App\Exceptions\PlanLimitExceededException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\File as FileSystem; 
use Illuminate\Support\Facades\URL;

class FileController extends Controller
{
    public function __construct(private PlanGuard $planGuard, private PlanService $planService)
    {
    }

    /**
     * SECURITY: Resolve a user-supplied relative path to an absolute path
     * and verify it stays within the project's workspace directory.
     * Prevents path traversal attacks (e.g. ../../etc/passwd).
     */
    private function safePath(Project $project, string $relativePath): string
    {
        $relativePath = ltrim($relativePath, '/');

        $base = storage_path("app/workspaces/{$project->user_id}/{$project->id}");

        if (!is_dir($base)) {
            FileSystem::makeDirectory($base, 0755, true);
        }

        $realBase = realpath($base);

        $parts      = explode('/', str_replace('\\', '/', $relativePath));
        $normalized = [];

        foreach ($parts as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                if (!empty($normalized)) {
                    array_pop($normalized);
                }
            } else {
                $normalized[] = $part;
            }
        }

        $fullPath = $realBase . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $normalized);

        if (!str_starts_with($fullPath, $realBase . DIRECTORY_SEPARATOR) && $fullPath !== $realBase) {
            abort(403, 'Invalid file path.');
        }

        return $fullPath;
    }

    private function syncToDisk(Project $project, $relativePath, $content)
    {
        $fullPath  = $this->safePath($project, $relativePath);
        $directory = dirname($fullPath);

        if (!FileSystem::exists($directory)) {
            FileSystem::makeDirectory($directory, 0755, true);
        }

        file_put_contents($fullPath, $content);
    }

    public function index(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $projectPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        
        if (!FileSystem::exists($projectPath)) {
            FileSystem::makeDirectory($projectPath, 0755, true);
        }

        $files = $this->scanDirectory($projectPath, $projectPath, $project);

        return response()->json(['files' => $files]);
    }

    public function show(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);
        return response()->json(['file' => $file]);
    }

    /**
     * G2b follow-up: server-side enforcement, not just a UI hint. G2a's
     * review screen (frontend/src/components/MultiFileReviewScreen.tsx)
     * disables its own Accept button for a protected file, and
     * generate() flags proposals the same way — but both of those are
     * only ever advisory unless something actually blocks the write
     * itself.
     *
     * CRITICAL SCOPING: this must NOT fire on an ordinary manual save.
     * `update()` below is the exact same endpoint a person's own
     * Ctrl+S in the editor calls (`handleSave()` →
     * `fileAPI.update()`) — a project's `boilerplate_key` being set
     * doesn't mean the human editing their own `vite.config.js`
     * directly should ever be blocked from doing so; only an
     * AI-proposal acceptance should be. That's why this only checks
     * when `$request->boolean('ai_proposal')` is explicitly true — a
     * flag ONLY `ProjectEditorPage.tsx`'s `writeReviewFile()` (G2a's
     * accept path) ever sends, never the normal save flow.
     *
     * `$project->boilerplate_key` null (pre-dates the column, or the
     * project never went through `generate()`) means "unknown
     * framework" — deliberately NOT restricted rather than guessed at,
     * same null-semantics as the migration that added the column.
     */
    private function isProtectedAiProposal(Request $request, Project $project, string $path): bool
    {
        if (!$request->boolean('ai_proposal')) return false;
        if (!$project->boilerplate_key) return false;
        return in_array($path, BoilerplateManager::getProtectedPaths($project->boilerplate_key), true);
    }

    /**
     * G2c — "Log every AI-initiated write to plan_action_logs with
     * before/after content references in every mode, including
     * fully-autonomous." This is that log, called from both the
     * blocked-as-protected case and the successful-write case in
     * store()/update() below — same allowed/denied pattern
     * PlanGuard::log() already uses for every OTHER guarded action in
     * this app, reused here rather than inventing a second logging
     * convention for one more table this app already has.
     *
     * Content is capped, not stored in full, unbounded — a large file
     * accepted via G2a shouldn't turn this table's `metadata` column
     * into something that bloats without limit. 20KB per side is
     * generous for a diff/revert reference while still bounded.
     */
    private function logAiFileWrite(Project $project, string $path, string $status, bool $allowed, ?string $oldContent, ?string $newContent, ?string $reason = null): void
    {
        $cap = fn (?string $s) => $s === null ? null : (strlen($s) > 20000 ? substr($s, 0, 20000) . '…[truncated]' : $s);

        try {
            PlanActionLog::query()->create([
                'user_id' => $project->user_id,
                'plan_id_at_time' => optional($this->planService->planFor($project->user))->id,
                'action_key' => 'ai.file_write',
                'allowed' => $allowed,
                'limit_value' => null,
                'current_usage' => null,
                'reason' => $reason,
                'metadata' => [
                    'project_id' => $project->id,
                    'path' => $path,
                    'status' => $status, // 'new' | 'modified'
                    'old_content' => $cap($oldContent),
                    'new_content' => $cap($newContent),
                ],
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            // Same "never break the guarded action itself" principle as
            // PlanGuard::log() — a failed insert here shouldn't turn an
            // otherwise-successful file write into a 500.
            Log::warning("FileController: failed to write plan_action_logs entry for AI file write: {$e->getMessage()}");
        }
    }

    public function store(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        $validator = Validator::make($request->all(), [
            'name'        => 'required|string|max:191',
            'path'        => ['required', 'string', 'max:400', 'not_regex:/(\.\.[\/\\\\])|^[\/\\\\]/'],
            'content'     => 'nullable|string',
            'language'    => 'nullable|string|max:50',
            'ai_proposal' => 'nullable|boolean',
        ]);

        if ($validator->fails()) return response()->json(['error' => $validator->errors()], 422);

        if ($this->isProtectedAiProposal($request, $project, $request->path)) {
            $this->logAiFileWrite($project, $request->path, 'new', false, null, $request->content, 'protected_scaffold_file');
            return response()->json(['error' => "\"{$request->path}\" is a protected scaffold file and can't be created or overwritten by an AI proposal."], 403);
        }

        $file = $project->files()->create([
            'name'       => $request->name,
            'path'       => $request->path,
            'content'    => $request->content ?? '',
            'language'   => $request->language,
            'size_bytes' => strlen($request->content ?? ''),
        ]);

        $this->syncToDisk($project, $request->path, $request->content ?? '');

        if ($request->boolean('ai_proposal')) {
            $this->logAiFileWrite($project, $request->path, 'new', true, null, $request->content);
        }

        return response()->json(['file' => $file], 201);
    }

    public function update(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        if ($request->has('name'))     $file->name     = $request->name;
        if ($request->has('language')) $file->language = $request->language;
        
        if ($request->has('content')) {
            if ($this->isProtectedAiProposal($request, $file->project, $file->path)) {
                $this->logAiFileWrite($file->project, $file->path, 'modified', false, $file->content, $request->content, 'protected_scaffold_file');
                return response()->json(['error' => "\"{$file->path}\" is a protected scaffold file and can't be overwritten by an AI proposal."], 403);
            }
            $oldContent = $file->content;
            $file->content    = $request->content;
            $file->size_bytes = strlen($request->content);
            $this->syncToDisk($file->project, $file->path, $request->content);

            if ($request->boolean('ai_proposal')) {
                $this->logAiFileWrite($file->project, $file->path, 'modified', true, $oldContent, $request->content);
            }
        }

        $file->save();

        return response()->json(['file' => $file]);
    }

    public function destroyPath(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id)
            return response()->json(['error' => 'Unauthorized'], 403);

        $path = $request->input('path');
        if (!$path) return response()->json(['error' => 'Path is required'], 422);

        $deleted = $project->files()
            ->where(function ($query) use ($path) {
                $query->where('path', $path)
                      ->orWhere('path', 'like', $path . '/%');
            })
            ->delete();

        try {
            $fullPath = $this->safePath($project, $path);
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            return response()->json(['error' => 'Invalid path'], 422);
        }

        if (FileSystem::isDirectory($fullPath)) {
            FileSystem::deleteDirectory($fullPath);
        } elseif (FileSystem::exists($fullPath)) {
            FileSystem::delete($fullPath);
        }

        return response()->json(['message' => "Deleted $deleted records"]);
    }

    public function destroy(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        try {
            $fullPath = $this->safePath($file->project, $file->path);
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $fullPath = null;
        }

        if ($fullPath && FileSystem::exists($fullPath)) {
            FileSystem::delete($fullPath);
        }

        $file->delete();

        return response()->json(['message' => 'File deleted successfully']);
    }

    public function upload(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        try {
            $this->planGuard->authorize($request->user(), 'storage.check', [
                'current_bytes' => $request->user()->getUsedStorageBytes(),
            ]);
        } catch (PlanLimitExceededException $e) {
            return response()->json([
                'error' => 'Storage limit reached. Delete unused projects or upgrade your plan to continue.'
            ], 403);
        }

        $request->validate(['file' => 'required|file|max:10240']);

        $file       = $request->file('file');
        $parentPath = trim($request->input('parent_path', ''), '/');
        $filename   = $file->getClientOriginalName();
        $fullPath   = $parentPath ? $parentPath . '/' . $filename : $filename;

        if (str_contains($fullPath, '../') || str_contains($fullPath, '..\\') || str_starts_with($fullPath, '/')) {
            return response()->json(['error' => 'Invalid file path.'], 422);
        }

        $sizeBytes = $file->getSize();
        $ext       = strtolower($file->getClientOriginalExtension());

        $textExts = ['js','jsx','ts','tsx','html','htm','css','scss','sass','less',
                     'php','py','java','go','rs','c','cpp','h','cs','rb','swift',
                     'json','yaml','yml','toml','xml','md','txt','sh','env',
                     'sql','graphql','vue','svelte','astro','prisma'];

        $langMap = [
            'js'=>'javascript','jsx'=>'javascript','ts'=>'typescript','tsx'=>'typescript',
            'py'=>'python','php'=>'php','html'=>'html','htm'=>'html','css'=>'css',
            'scss'=>'scss','sass'=>'scss','json'=>'json','md'=>'markdown','sql'=>'sql',
            'java'=>'java','go'=>'go','rs'=>'rust','c'=>'c','cpp'=>'cpp','cs'=>'csharp',
            'rb'=>'ruby','swift'=>'swift','yaml'=>'yaml','yml'=>'yaml','xml'=>'xml',
            'sh'=>'shell','vue'=>'vue','svelte'=>'svelte','graphql'=>'graphql',
        ];

        $language = $langMap[$ext] ?? 'plaintext';
        $isBinary = !in_array($ext, $textExts);

        $content = '';
        if (!$isBinary) {
            $content = file_get_contents($file->getRealPath());
            if (strpos($content, "\0") !== false) {
                $content  = '';
                $isBinary = true;
            }
        }

        $fileRecord = $project->files()->updateOrCreate(
            ['path' => $fullPath],
            [
                'name'       => $filename,
                'content'    => $content,
                'language'   => $language,
                'size_bytes' => $sizeBytes,
                'is_deleted' => false,
            ]
        );

        $this->syncToDisk($project, $fullPath, $content);

        return response()->json(['file' => $fileRecord], 201);
    }

    public function serve(Request $request, Project $project, $fileId)
    {
        if ($project->user_id !== $request->user()->id) abort(403);
        $file = $project->files()->findOrFail($fileId);
        
        $ext        = strtolower(pathinfo($file->name, PATHINFO_EXTENSION));
        $mimeTypes  = ['png'=>'image/png', 'jpg'=>'image/jpeg', 'html'=>'text/html', 'css'=>'text/css', 'js'=>'text/javascript'];
        $mime       = $mimeTypes[$ext] ?? 'text/plain';

        return response($file->content)->header('Content-Type', $mime);
    }

    public function getPreviewUrl(Request $request, Project $project, $path)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $file = $project->files()->where('path', $path)->first();
        if (!$file) {
            $file = $project->files()->where('path', 'LIKE', '%/' . $path)->first();
        }
        if (!$file) {
            return response()->json(['error' => 'File not found'], 404);
        }

        $signedUrl = URL::temporarySignedRoute(
            'projects.preview.signed',
            now()->addMinutes(5),
            ['project' => $project->id, 'path' => $path]
        );

        return response()->json(['url' => $signedUrl]);
    }

    public function previewSigned(Request $request, Project $project, $path)
    {
        if (!$request->hasValidSignature()) {
            abort(403, 'Preview link has expired or is invalid. Please reload the file.');
        }

        $file = $project->files()->where('path', $path)->first();
        if (!$file) {
            $file = $project->files()->where('path', 'LIKE', '%/' . $path)->first();
        }
        if (!$file) {
            return response('File not found: ' . $path, 404);
        }

        $ext       = strtolower(pathinfo($file->name, PATHINFO_EXTENSION));
        $mimeTypes = [
            'html' => 'text/html',
            'css'  => 'text/css',
            'js'   => 'application/javascript',
            'png'  => 'image/png',
            'jpg'  => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif'  => 'image/gif',
            'svg'  => 'image/svg+xml',
            'webp' => 'image/webp',
            'ico'  => 'image/x-icon',
        ];

        return response($file->content)
            ->header('Content-Type', $mimeTypes[$ext] ?? 'text/plain')
            ->header('X-Frame-Options', 'SAMEORIGIN');
    }

    /**
     * FIX #7: Replace N+1 firstOrCreate loop with a single batch query.
     *
     * Old approach: called firstOrCreate() inside a foreach over every file on disk.
     * For a 100-file project, GET /projects/{id}/files fired 100 separate queries.
     *
     * New approach:
     *   1. Load all existing DB records for this project in ONE query.
     *   2. Build a lookup map keyed by path.
     *   3. Scan disk, match against map — batch-insert only genuinely new paths.
     *   4. Return the merged result set.
     */
    private function scanDirectory($dir, $basePath, $project, &$results = [])
    {
        // ── Step 1: load all existing records once ───────────────────────────
        $existingByPath = \App\Models\File::where('project_id', $project->id)
            ->get()
            ->keyBy('path');

        // ── Step 2: walk the disk ────────────────────────────────────────────
        $newRecords = [];
        $this->walkDir($dir, $basePath, $project, $existingByPath, $results, $newRecords);

        // ── Step 3: batch-insert new records (one query regardless of count) ─
        if (!empty($newRecords)) {
            $now = now()->toDateTimeString();
            foreach ($newRecords as &$record) {
                $record['created_at'] = $now;
                $record['updated_at'] = $now;
            }
            \App\Models\File::insert($newRecords);

            // Reload to get auto-incremented IDs for the inserted rows
            $freshByPath = \App\Models\File::where('project_id', $project->id)
                ->whereIn('path', array_column($newRecords, 'path'))
                ->get()
                ->keyBy('path');

            // Replace placeholder entries with real records
            foreach ($results as &$entry) {
                if (isset($entry['_needs_id']) && isset($freshByPath[$entry['path']])) {
                    $entry = $freshByPath[$entry['path']];
                }
            }
            unset($entry);
        }

        return $results;
    }

    private function walkDir($dir, $basePath, $project, $existingByPath, &$results, &$newRecords)
    {
        $items = scandir($dir);

        foreach ($items as $item) {
            if ($item === '.' || $item === '..' || $item === '.git') continue;

            if (in_array($item, ['node_modules', 'vendor', '__pycache__'])) {
                $relativePath = ltrim(substr($dir . '/' . $item, strlen($basePath)), '/');
                $results[] = [
                    'id'         => 0,
                    'project_id' => $project->id,
                    'name'       => $item,
                    'path'       => $relativePath,
                    'language'   => 'folder',
                    'updated_at' => now()
                ];
                continue;
            }

            $fullPath     = $dir . '/' . $item;
            $relativePath = ltrim(substr($fullPath, strlen($basePath)), '/');

            if (is_dir($fullPath)) {
                $this->walkDir($fullPath, $basePath, $project, $existingByPath, $results, $newRecords);
            } else {
                if (isset($existingByPath[$relativePath])) {
                    // Already in DB — just use the existing record
                    $results[] = $existingByPath[$relativePath];
                } else {
                    // New file found on disk — queue for batch insert
                    $newRecords[] = [
                        'project_id' => $project->id,
                        'path'       => $relativePath,
                        'name'       => $item,
                        'content'    => '',
                        'language'   => pathinfo($item, PATHINFO_EXTENSION),
                        'size_bytes' => filesize($fullPath),
                        'is_deleted' => false,
                    ];
                    // Temporary placeholder so ordering is preserved
                    $results[] = ['_needs_id' => true, 'path' => $relativePath];
                }
            }
        }
    }
}