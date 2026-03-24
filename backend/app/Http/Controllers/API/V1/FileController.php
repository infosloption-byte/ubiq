<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\File;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\File as FileSystem; 
use Illuminate\Support\Facades\URL;

class FileController extends Controller
{
    /**
     * SECURITY: Resolve a user-supplied relative path to an absolute path
     * and verify it stays within the project's workspace directory.
     * Prevents path traversal attacks (e.g. ../../etc/passwd).
     *
     * FIX: The previous version used realpath() as the primary resolution strategy.
     * realpath() only works on paths that already exist on disk — it returns false for
     * non-existent files AND non-existent parent directories.
     *
     * The old fallback was:
     *   $resolvedDir = realpath(dirname($candidate));   // returns false if dir missing
     *   $resolved    = $resolvedDir . '/' . basename(); // false . '/' . 'file' = '/file'
     *
     * That made the path traversal check fail for any new folder whose parent didn't
     * exist yet — i.e. every single folder creation and every subfolder file upload.
     *
     * The fix: manually normalize the relative path by processing each segment,
     * collapsing any '..' and '.' entries, WITHOUT requiring anything to exist on disk.
     * Then concatenate with the real base path (which always exists after mkdir).
     * The final str_starts_with() guard still prevents any traversal attempt.
     */
    private function safePath(Project $project, string $relativePath): string
    {
        $relativePath = ltrim($relativePath, '/');

        $base = storage_path("app/workspaces/{$project->user_id}/{$project->id}");

        if (!is_dir($base)) {
            FileSystem::makeDirectory($base, 0755, true);
        }

        $realBase = realpath($base);

        // Manually normalize the relative path — resolves '..' and '.' without
        // requiring the path to exist on disk. This is the correct approach for a
        // path safety function that must work with paths that don't exist yet.
        $parts      = explode('/', str_replace('\\', '/', $relativePath));
        $normalized = [];

        foreach ($parts as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            if ($part === '..') {
                // Pop the last segment. If already empty, '..' would escape the base —
                // we simply ignore it (can't go above root of the workspace).
                if (!empty($normalized)) {
                    array_pop($normalized);
                }
            } else {
                $normalized[] = $part;
            }
        }

        $fullPath = $realBase . DIRECTORY_SEPARATOR . implode(DIRECTORY_SEPARATOR, $normalized);

        // Final guard: the assembled path must still be inside the workspace base.
        if (!str_starts_with($fullPath, $realBase . DIRECTORY_SEPARATOR) && $fullPath !== $realBase) {
            abort(403, 'Invalid file path.');
        }

        return $fullPath;
    }

    /**
     * Syncs file content to the physical workspace folder.
     * All writes go through safePath() to prevent traversal.
     */
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

    public function store(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        $validator = Validator::make($request->all(), [
            'name'     => 'required|string|max:191',
            'path'     => ['required', 'string', 'max:400', 'not_regex:/(\.\.[\/\\\\])|^[\/\\\\]/'],
            'content'  => 'nullable|string',
            'language' => 'nullable|string|max:50',
        ]);

        if ($validator->fails()) return response()->json(['error' => $validator->errors()], 422);

        $file = $project->files()->create([
            'name'       => $request->name,
            'path'       => $request->path,
            'content'    => $request->content ?? '',
            'language'   => $request->language,
            'size_bytes' => strlen($request->content ?? ''),
        ]);

        $this->syncToDisk($project, $request->path, $request->content ?? '');

        return response()->json(['file' => $file], 201);
    }

    public function update(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        if ($request->has('name'))     $file->name     = $request->name;
        if ($request->has('language')) $file->language = $request->language;
        
        if ($request->has('content')) {
            $file->content    = $request->content;
            $file->size_bytes = strlen($request->content);
            $this->syncToDisk($file->project, $file->path, $request->content);
        }

        $file->save();

        return response()->json(['file' => $file]);
    }

    public function destroyPath(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        $path = $request->input('path');
        if (!$path) return response()->json(['error' => 'Path is required'], 422);

        $deleted = $project->files()
            ->where(function ($query) use ($path) {
                $query->where('path', $path)->orWhere('path', 'like', $path . '/%');
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

        return response()->json(['message' => "Deleted $deleted files"]);
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

        if ($request->user()->isOverStorageLimit()) {
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

    private function scanDirectory($dir, $basePath, $project, &$results = [])
    {
        $items = scandir($dir);

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            if ($item === '.git') continue;

            if ($item === 'node_modules' || $item === 'vendor' || $item === '__pycache__') {
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
                $this->scanDirectory($fullPath, $basePath, $project, $results);
            } else {
                $fileRecord = \App\Models\File::firstOrCreate(
                    ['project_id' => $project->id, 'path' => $relativePath],
                    [
                        'name'       => $item,
                        'content'    => '',
                        'language'   => pathinfo($item, PATHINFO_EXTENSION),
                        'size_bytes' => filesize($fullPath),
                        'is_deleted' => false
                    ]
                );

                $results[] = $fileRecord;
            }
        }

        return $results;
    }
}