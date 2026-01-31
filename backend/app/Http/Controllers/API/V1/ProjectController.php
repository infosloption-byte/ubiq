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
        // 1. Validate Input
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'description' => 'nullable|string',
            'language' => 'nullable|string|max:50',
            'visibility' => 'nullable|in:private,public',
            'source' => 'nullable|in:manual,upload,github',
            'repository_url' => 'nullable|required_if:source,github|url',
            'branch' => 'nullable|string',
            'github_token' => 'nullable|string',
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        // 2. Create Project Record
        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => $request->language,
            'visibility' => $request->visibility ?? 'private',
            'source' => $request->source ?? 'manual',
            'repository_url' => $request->repository_url,
            'branch' => $request->branch ?? 'main',
            'github_token' => $request->github_token,
        ]);

        // 3. Initialize Project Content based on Source
        if ($project->source === 'manual') {
            // Create a default starting file for manual projects
            File::create([
                'project_id' => $project->id,
                'name' => 'main.' . ($this->getExtensionForLanguage($project->language) ?? 'txt'),
                'path' => 'src/main.' . ($this->getExtensionForLanguage($project->language) ?? 'txt'),
                'content' => "// Start coding your " . $project->name . " project here...",
                'language' => $project->language ?? 'text',
                'size_bytes' => 50
            ]);
        } 
        elseif ($project->source === 'github') {
            // Create a placeholder README to indicate GitHub import
            // In a production app, you would dispatch a Job here: ImportGithubRepo::dispatch($project);
            File::create([
                'project_id' => $project->id,
                'name' => 'README.md',
                'path' => 'README.md',
                'content' => "# " . $project->name . "\n\nImported from GitHub: " . $project->repository_url . "\n\n_Syncing in progress..._",
                'language' => 'markdown',
                'size_bytes' => 100
            ]);
        }
        
        return response()->json([
            'message' => 'Project created successfully',
            'project' => $project
        ], 201);
    }
    
    /**
     * Helper to guess extension from language name.
     */
    private function getExtensionForLanguage($language) {
        $map = [
            'python' => 'py', 'javascript' => 'js', 'typescript' => 'ts',
            'html' => 'html', 'css' => 'css', 'php' => 'php',
            'java' => 'java', 'c' => 'c', 'cpp' => 'cpp', 'go' => 'go',
            'rust' => 'rs', 'ruby' => 'rb', 'json' => 'json'
        ];
        return $map[strtolower($language ?? '')] ?? 'txt';
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
}