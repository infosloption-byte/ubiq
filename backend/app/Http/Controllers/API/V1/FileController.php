<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\File;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class FileController extends Controller
{
    /**
     * List all files for a specific project.
     * Route: GET /api/v1/projects/{project}/files
     */
    public function index(Request $request, Project $project)
    {
        // 1. Authorization
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        // 2. Fetch Files (exclude deleted ones)
        $files = $project->files()
            ->where('is_deleted', false)
            ->select(['id', 'project_id', 'name', 'language', 'size_bytes', 'updated_at']) // Optimize query
            ->get();

        return response()->json(['files' => $files]);
    }

    /**
     * Get a single file's content.
     * Route: GET /api/v1/files/{file}
     */
    public function show(Request $request, File $file)
    {
        // Verify ownership via project relation
        if ($file->project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        return response()->json(['file' => $file]);
    }

    /**
     * Create a new file in a project.
     * Route: POST /api/v1/projects/{project}/files
     */
    public function store(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $validator = Validator::make($request->all(), [
            'name' => 'required|string|max:191',
            'path' => 'required|string|max:400',
            'content' => 'nullable|string',
            'language' => 'nullable|string|max:50',
        ]);

        if ($validator->fails()) {
            return response()->json(['error' => $validator->errors()], 422);
        }

        $file = $project->files()->create([
            'name' => $request->name,
            'path' => $request->path,
            'content' => $request->content ?? '',
            'language' => $request->language,
            'size_bytes' => strlen($request->content ?? ''),
        ]);

        return response()->json(['file' => $file], 201);
    }

    /**
     * Update a file (content or name).
     * Route: PUT /api/v1/files/{file}
     */
    public function update(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $file->update($request->only(['name', 'content', 'language']));
        
        // Update size if content changed
        if ($request->has('content')) {
            $file->size_bytes = strlen($request->content);
            $file->save();
        }

        return response()->json(['file' => $file]);
    }

    /**
     * Delete a file (Soft delete or hard delete).
     * Route: DELETE /api/v1/files/{file}
     */
    public function destroy(Request $request, File $file)
    {
        if ($file->project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $file->delete(); // Or set is_deleted = true

        return response()->json(['message' => 'File deleted']);
    }
}