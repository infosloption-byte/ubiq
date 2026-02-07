<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class ProjectController extends Controller
{
    /**
     * Get all projects for the authenticated user.
     */
    public function index(Request $request)
    {
        $user = $request->user();
        
        $projects = Project::where('user_id', $user->id)
            ->when($request->input('archived') !== 'true', function ($query) {
                $query->where('is_archived', false);
            })
            ->with('files:id,project_id,name,language') // Eager load minimal file data
            ->withCount('files')
            ->orderBy('updated_at', 'desc')
            ->get();
        
        return response()->json([
            'projects' => $projects
        ]);
    }
    
    /**
     * Create a new project (Manual, Upload, or GitHub).
     */
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'description' => 'nullable|string',
            'visibility' => 'nullable|in:private,public',
            'source' => 'nullable|in:manual,github', // 'upload' handled by import()
            'repository_url' => 'nullable|required_if:source,github|url',
            'github_token' => 'nullable|string',
        ]);
        
        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }
        
        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => 'mixed', // Default value
            'visibility' => $request->visibility ?? 'private',
            'source' => $request->source ?? 'manual',
            'repository_url' => $request->repository_url,
            'github_token' => $request->github_token,
        ]);

        // Default content
        if ($project->source === 'manual') {
            File::create([
                'project_id' => $project->id,
                'name' => 'README.md',
                'path' => 'README.md',
                'content' => "# " . $project->name . "\n\nWelcome to your new project!",
                'language' => 'markdown',
                'size_bytes' => 50
            ]);
        } 
        
        return response()->json(['message' => 'Project created successfully', 'project' => $project], 201);
    }

    /**
     * Import a project from a ZIP file.
     */
    public function import(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'description' => 'nullable|string',
            'file' => 'required|file|mimes:zip|max:20480', // 20MB Max
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => 'Validation failed', 'messages' => $validator->errors()], 422);
        }

        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => 'mixed',
            'visibility' => $request->visibility ?? 'private',
            'source' => 'upload'
        ]);

        $zip = new \ZipArchive;

        if ($zip->open($request->file('file')->path()) === TRUE) {
            
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $filename = $zip->getNameIndex($i);
                
                // Skip directories and Mac system files
                if (substr($filename, -1) == '/') continue;
                if (str_contains($filename, '__MACOSX') || str_contains($filename, '.DS_Store')) continue;

                $content = $zip->getFromIndex($i);
                
                // Skip binary files (simple check) - or store them as base64 if you want
                // For this MVP, let's try to detect if content is utf-8
                if (!mb_detect_encoding($content, 'UTF-8', true)) continue; 

                $ext = pathinfo($filename, PATHINFO_EXTENSION);
                $langMap = [
                    'js'=>'javascript', 'ts'=>'typescript', 'jsx'=>'javascript', 'tsx'=>'typescript',
                    'py'=>'python', 'php'=>'php', 'html'=>'html', 'css'=>'css', 'json'=>'json', 'md'=>'markdown'
                ];
                $language = $langMap[strtolower($ext)] ?? 'plaintext';

                File::create([
                    'project_id' => $project->id,
                    'name' => basename($filename),
                    'path' => $filename,
                    'content' => $content,
                    'language' => $language,
                    'size_bytes' => strlen($content),
                ]);
            }
            $zip->close();
        } else {
            return response()->json(['error' => 'Failed to open ZIP file'], 500);
        }

        return response()->json(['message' => 'Project imported successfully', 'project' => $project], 201);
    }
    
    /**
     * Get a single project.
     */
    public function show(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }
        
        // Eager load non-deleted files
        $project->load(['files' => function ($query) {
            $query->where('is_deleted', false);
        }]);
        
        return response()->json([
            'project' => $project
        ]);
    }
    
    /**
     * Update project metadata.
     */
    public function update(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }
        
        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|string|max:191',
            'description' => 'nullable|string',
            'language' => 'nullable|string|max:50',
            'visibility' => 'sometimes|in:private,public',
            // We typically don't allow changing source/repo URL after creation easily
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        $project->update($request->only(['name', 'description', 'language', 'visibility']));
        
        return response()->json([
            'message' => 'Project updated successfully',
            'project' => $project
        ]);
    }
    
    /**
     * Soft delete a project.
     */
    public function destroy(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }
        
        $project->delete();
        
        return response()->json([
            'message' => 'Project deleted successfully'
        ]);
    }
    
    /**
     * Archive a project.
     */
    public function archive(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }
        
        $project->is_archived = true;
        $project->save();
        
        return response()->json([
            'message' => 'Project archived successfully',
            'project' => $project
        ]);
    }
    
    /**
     * Restore an archived project.
     */
    public function restore(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }
        
        $project->is_archived = false;
        $project->save();
        
        return response()->json([
            'message' => 'Project restored successfully',
            'project' => $project
        ]);
    }

    /**
     * Download project as ZIP.
     */
    public function download(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $zipFileName = 'project_' . $project->id . '_' . time() . '.zip';
        $zipPath = storage_path('app/public/' . $zipFileName);

        $zip = new \ZipArchive;
        if ($zip->open($zipPath, \ZipArchive::CREATE) === TRUE) {
            
            // Chunking to handle large projects without memory overflow
            $project->files()->chunk(100, function($files) use ($zip) {
                foreach ($files as $file) {
                    // Add file to zip using its path
                    $zip->addFromString($file->path, $file->content ?? '');
                }
            });
            
            $zip->close();
        } else {
            return response()->json(['error' => 'Could not create zip'], 500);
        }

        return response()->download($zipPath)->deleteFileAfterSend(true);
    }
}