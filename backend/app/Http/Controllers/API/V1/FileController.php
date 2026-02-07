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
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $files = $project->files()
            ->where('is_deleted', false)
            // UPDATE: Added 'content' to this list so the frontend gets the code
            ->select(['id', 'project_id', 'name', 'path', 'content', 'language', 'size_bytes', 'updated_at']) 
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
     * Delete a directory path and all contents.
     */
    public function destroyPath(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $request->validate(['path' => 'required|string']);
        $path = $request->input('path');

        // Delete the exact file (if it's a file) OR any files inside the folder
        // We use $path . '/%' to ensure we don't accidentally delete "images-backup" when deleting "images"
        $deleted = $project->files()
            ->where(function($query) use ($path) {
                $query->where('path', $path)
                      ->orWhere('path', 'like', $path . '/%');
            })
            ->delete();

        return response()->json(['message' => "Deleted $deleted files"]);
    }

    /**
     * Upload a file to the project.
     */
    public function upload(Request $request, Project $project)
    {
        // 1. Validation
        $request->validate([
            'file' => 'required|file|max:10240', // Max 10MB
            'parent_path' => 'nullable|string',
        ]);

        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $file = $request->file('file');
        $parentPath = $request->input('parent_path', '');
        $filename = $file->getClientOriginalName();
        
        // 2. Determine File Path
        // If parent_path is provided (e.g. "src/components"), append filename
        $fullPath = $parentPath ? $parentPath . '/' . $filename : $filename;

        // 3. Read Content (For MVP we store in DB; production should use Storage)
        // Ensure we handle text files correctly. Binary files might break this simple text column setup.
        $content = file_get_contents($file->getRealPath());
        
        // 4. Detect Language
        $ext = strtolower($file->getClientOriginalExtension());
        $langMap = [
            'js'=>'javascript', 'ts'=>'typescript', 'jsx'=>'javascript', 'tsx'=>'typescript',
            'py'=>'python', 'php'=>'php', 'html'=>'html', 'css'=>'css', 'json'=>'json', 
            'md'=>'markdown', 'sql'=>'sql', 'vue'=>'vue'
        ];
        $language = $langMap[$ext] ?? 'plaintext';

        // 5. Save to Database
        $fileRecord = $project->files()->updateOrCreate(
            ['path' => $fullPath],
            [
                'name' => $filename,
                'content' => $content,
                'language' => $language,
                'size_bytes' => strlen($content),
                'is_deleted' => false
            ]
        );

        return response()->json(['file' => $fileRecord], 201);
    }

    /**
     * Serve the raw file content with correct headers.
     */
    public function serve(Request $request, Project $project, $fileId)
    {
        if ($project->user_id !== $request->user()->id) {
            abort(403);
        }

        $file = $project->files()->findOrFail($fileId);

        // Detect MIME type based on extension
        $ext = strtolower(pathinfo($file->name, PATHINFO_EXTENSION));
        $mimeTypes = [
            'png' => 'image/png',
            'jpg' => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'svg' => 'image/svg+xml',
            'pdf' => 'application/pdf',
            'html' => 'text/html',
        ];

        $mime = $mimeTypes[$ext] ?? 'text/plain';

        return response($file->content)
            ->header('Content-Type', $mime);
    }

    public function preview(Request $request, Project $project, $token, $path)
    {
        // 1. Authenticate using the token from the URL path
        $accessToken = \Laravel\Sanctum\PersonalAccessToken::findToken($token);
    
        if (!$accessToken || !$accessToken->tokenable) {
            abort(403, 'Unauthorized preview access');
        }

        // 2. Smart Path Resolution (Fuzzy Matcher)
        // Try exact match
        $file = $project->files()->where('path', $path)->first();

        // Try directory match (e.g. asking for "css/style.css" but stored as "vanessa/css/style.css")
        if (!$file) {
            $file = $project->files()->where('path', 'LIKE', "%/" . $path)->first();
        }

        // Last Resort: Filename match
        if (!$file) {
            $filename = basename($path);
            $file = $project->files()->where('name', $filename)->first();
        }

        if (!$file) {
            return response("File not found: $path", 404);
        }

        // 3. Serve Content
        $mimeTypes = [
            'html' => 'text/html',
            'css'  => 'text/css',
            'js'   => 'application/javascript',
            'json' => 'application/json',
            'png'  => 'image/png',
            'jpg'  => 'image/jpeg',
            'jpeg' => 'image/jpeg',
            'gif'  => 'image/gif',
            'svg'  => 'image/svg+xml',
            'pdf'  => 'application/pdf',
            'woff' => 'font/woff',
            'woff2'=> 'font/woff2',
            'ttf'  => 'font/ttf',
        ];

        $ext = strtolower(pathinfo($file->name, PATHINFO_EXTENSION));
        $contentType = $mimeTypes[$ext] ?? 'text/plain';

        return response($file->content)
            ->header('Content-Type', $contentType)
            ->header('Access-Control-Allow-Origin', '*');
    }
}