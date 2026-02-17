<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\File;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\File as FileSystem; 

class FileController extends Controller
{
    /**
     * Syncs file content to the physical workspace folder (Critical for Git & Runners)
     */
    private function syncToDisk(Project $project, $relativePath, $content)
    {
        $fullPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}/{$relativePath}");
        
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

        // 1. Define the physical path
        $projectPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        
        // Ensure directory exists
        if (!FileSystem::exists($projectPath)) {
            FileSystem::makeDirectory($projectPath, 0755, true);
        }

        // 2. Scan disk for real files (Flat List)
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
            'name' => 'required|string|max:191',
            'path' => 'required|string|max:400',
            'content' => 'nullable|string',
            'language' => 'nullable|string|max:50',
        ]);

        if ($validator->fails()) return response()->json(['error' => $validator->errors()], 422);

        $file = $project->files()->create([
            'name' => $request->name,
            'path' => $request->path,
            'content' => $request->content ?? '',
            'language' => $request->language,
            'size_bytes' => strlen($request->content ?? ''),
        ]);

        $this->syncToDisk($project, $request->path, $request->content ?? '');

        return response()->json(['file' => $file], 201);
    }

    public function update(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        if ($request->has('name')) $file->name = $request->name;
        if ($request->has('language')) $file->language = $request->language;
        
        if ($request->has('content')) {
            $file->content = $request->content;
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
        
        // Delete from DB
        $deleted = $project->files()
            ->where(function($query) use ($path) {
                $query->where('path', $path)->orWhere('path', 'like', $path . '/%');
            })
            ->delete();

        // Delete from Disk
        $fullPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}/{$path}");
        if (FileSystem::isDirectory($fullPath)) {
            FileSystem::deleteDirectory($fullPath);
        } elseif (FileSystem::exists($fullPath)) {
            FileSystem::delete($fullPath);
        }

        return response()->json(['message' => "Deleted $deleted files"]);
    }

    /**
     * Delete a single file resource (Route: DELETE /api/v1/files/{file})
     */
    public function destroy(Request $request, File $file)
    {
        // 1. Authorization
        if ($file->project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        // 2. Delete from Disk
        // Reconstruct the full path using the project ID structure
        $fullPath = storage_path("app/workspaces/{$file->project->user_id}/{$file->project->id}/{$file->path}");
        
        if (FileSystem::exists($fullPath)) {
            FileSystem::delete($fullPath);
        }

        // 3. Delete from Database
        $file->delete();

        return response()->json(['message' => 'File deleted successfully']);
    }

    public function upload(Request $request, Project $project)
    {
        $request->validate(['file' => 'required|file|max:10240']);

        if ($project->user_id !== $request->user()->id) return response()->json(['error' => 'Unauthorized'], 403);

        $file = $request->file('file');
        $parentPath = $request->input('parent_path', '');
        $filename = $file->getClientOriginalName();
        $fullPath = $parentPath ? $parentPath . '/' . $filename : $filename;

        $content = file_get_contents($file->getRealPath());
        $ext = strtolower($file->getClientOriginalExtension());
        $language = ['js'=>'javascript','html'=>'html','css'=>'css'][$ext] ?? 'plaintext';

        $fileRecord = $project->files()->updateOrCreate(
            ['path' => $fullPath],
            ['name' => $filename, 'content' => $content, 'language' => $language, 'is_deleted' => false]
        );

        $this->syncToDisk($project, $fullPath, $content);

        return response()->json(['file' => $fileRecord], 201);
    }

    public function serve(Request $request, Project $project, $fileId)
    {
        if ($project->user_id !== $request->user()->id) abort(403);
        $file = $project->files()->findOrFail($fileId);
        
        $ext = strtolower(pathinfo($file->name, PATHINFO_EXTENSION));
        $mimeTypes = ['png'=>'image/png', 'jpg'=>'image/jpeg', 'html'=>'text/html', 'css'=>'text/css', 'js'=>'text/javascript']; 
        $mime = $mimeTypes[$ext] ?? 'text/plain';

        return response($file->content)->header('Content-Type', $mime);
    }

    public function preview(Request $request, Project $project, $token, $path)
    {
        $accessToken = \Laravel\Sanctum\PersonalAccessToken::findToken($token);
        if (!$accessToken || !$accessToken->tokenable) abort(403);

        $file = $project->files()->where('path', $path)->first();
        if (!$file) $file = $project->files()->where('path', 'LIKE', "%/" . $path)->first();
        
        if (!$file) return response("File not found: $path", 404);

        $ext = strtolower(pathinfo($file->name, PATHINFO_EXTENSION));
        $mimeTypes = ['html'=>'text/html', 'css'=>'text/css', 'js'=>'application/javascript'];
        
        return response($file->content)->header('Content-Type', $mimeTypes[$ext] ?? 'text/plain');
    }

    /**
     * Recursively scans the disk and syncs new files to the DB
     */
    private function scanDirectory($dir, $basePath, $project, &$results = []) {
        $items = scandir($dir);

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            if ($item === '.git') continue; 
            
            // SKIP HEAVY FOLDERS to keep IDE fast
            if ($item === 'node_modules' || $item === 'vendor' || $item === '__pycache__') {
                // Add the folder itself so user sees it exists, but don't scan contents
                $relativePath = ltrim(substr($dir . '/' . $item, strlen($basePath)), '/');
                $results[] = [
                    'id' => 0, // Folders don't need real IDs
                    'project_id' => $project->id,
                    'name' => $item,
                    'path' => $relativePath,
                    'language' => 'folder', // Frontend treats this as a folder
                    'updated_at' => now()
                ];
                continue;
            }

            $fullPath = $dir . '/' . $item;
            $relativePath = ltrim(substr($fullPath, strlen($basePath)), '/');

            if (is_dir($fullPath)) {
                $this->scanDirectory($fullPath, $basePath, $project, $results);
            } else {
                // It's a file. We need to make sure it has an ID in the DB.
                // This "Sync on Read" strategy ensures files created by Docker can be opened.
                $fileRecord = \App\Models\File::firstOrCreate(
                    ['project_id' => $project->id, 'path' => $relativePath],
                    [
                        'name' => $item,
                        'content' => '', // Lazy load content to speed up listing
                        'language' => pathinfo($item, PATHINFO_EXTENSION),
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