<?php

// ============================================================
// File: app/Http/Controllers/API/V1/ProjectController.php
// ============================================================

namespace App\Http\Controllers\API\V1;

use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use App\Http\Controllers\Controller;

class ProjectController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        
        $projects = Project::where('user_id', $user->id)
            ->when($request->input('archived') !== 'true', function ($query) {
                $query->where('is_archived', false);
            })
            ->with('files:id,project_id,name,language')
            ->withCount('files')
            ->orderBy('updated_at', 'desc')
            ->get();
        
        return response()->json([
            'projects' => $projects
        ]);
    }
    
    public function store(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'description' => 'nullable|string',
            'language' => 'nullable|string|max:50',
            'visibility' => 'nullable|in:private,public',
        ]);
        
        if ($validator->fails()) {
            return response()->json([
                'error' => 'Validation failed',
                'messages' => $validator->errors()
            ], 422);
        }
        
        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => $request->language,
            'visibility' => $request->visibility ?? 'private',
        ]);
        
        return response()->json([
            'message' => 'Project created successfully',
            'project' => $project
        ], 201);
    }
    
    public function show(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json([
                'error' => 'Unauthorized'
            ], 403);
        }
        
        $project->load(['files' => function ($query) {
            $query->where('is_deleted', false);
        }]);
        
        return response()->json([
            'project' => $project
        ]);
    }
    
    public function update(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json([
                'error' => 'Unauthorized'
            ], 403);
        }
        
        $validator = Validator::make($request->all(), [
            'name' => 'sometimes|string|max:191',
            'description' => 'nullable|string',
            'language' => 'nullable|string|max:50',
            'visibility' => 'sometimes|in:private,public',
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
    
    public function destroy(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json([
                'error' => 'Unauthorized'
            ], 403);
        }
        
        $project->delete();
        
        return response()->json([
            'message' => 'Project deleted successfully'
        ]);
    }
    
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