<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\File;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\File as FileSystem; 
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Log;

class ProjectController extends Controller
{
    /**
     * Helper: Get the physical workspace path for a project
     * Structure: storage/app/workspaces/{user_id}/{project_id}
     */
    private function getProjectPath(Project $project)
    {
        $path = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        if (!FileSystem::exists($path)) {
            // Ensure recursive creation with correct permissions
            FileSystem::makeDirectory($path, 0755, true);
        }
        return $path;
    }
    
    public function index(Request $request)
    {
        $user = $request->user();
        $projects = Project::where('user_id', $user->id)
            ->when($request->input('archived') !== 'true', fn($q) => $q->where('is_archived', false))
            ->with('files:id,project_id,name,language')
            ->withCount('files')
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
            'files' => 'required|array',
            'files.*.path' => 'required|string',
            'files.*.content' => 'required|string',
        ]);

        $savedCount = 0;
        $projectPath = $this->getProjectPath($project);

        foreach ($request->input('files') as $fileData) {
            $path = $fileData['path'];
            $content = $fileData['content'];

            // 1. Save to DB
            $project->files()->updateOrCreate(
                ['path' => $path],
                [
                    'name' => basename($path),
                    'content' => $content,
                    'language' => $this->detectLanguage(pathinfo($path, PATHINFO_EXTENSION)),
                    'size_bytes' => strlen($content)
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

        return response()->json(['message' => "Scaffolded $savedCount files successfully"]);
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
        
        $project = Project::create([
            'user_id' => $request->user()->id,
            'name' => $request->name,
            'description' => $request->description,
            'language' => 'mixed',
            'visibility' => $request->visibility ?? 'private',
            'source' => $request->source ?? 'manual',
            'repository_url' => $request->repository_url,
        ]);

        try {
            $projectPath = $this->getProjectPath($project);
            
            if ($project->source === 'manual') {
                // 1. Init Git
                $init = Process::path($projectPath)->run('git init');
                if ($init->failed()) {
                    throw new \Exception("Git init failed: " . $init->errorOutput());
                }

                $this->setupGitConfig($projectPath);
                
                // 2. Create README
                $this->createReadme($project, $projectPath);
                
                // 3. Initial Commit
                Process::path($projectPath)->run('git add .');
                Process::path($projectPath)->run('git commit -m "Initial commit"');
                
            } elseif ($project->source === 'github') {
                $this->importFromGithub($project, $request->github_token, $projectPath);
            }
        } catch (\Exception $e) {
            Log::error("Project Creation Failed: " . $e->getMessage());
            
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
        $repoUrl = $project->repository_url;

        if ($token) {
            $urlParts = parse_url($repoUrl);
            $repoUrl = $urlParts['scheme'] . '://' . $token . '@' . $urlParts['host'] . $urlParts['path'];
        }

        if (FileSystem::exists($destinationPath)) {
            FileSystem::deleteDirectory($destinationPath);
        }

        $result = Process::run("git clone {$repoUrl} {$destinationPath}");

        if ($result->failed()) {
            throw new \Exception("Git clone failed: " . $result->errorOutput());
        }

        $this->setupGitConfig($destinationPath);
        $this->scanAndSaveFiles($project, $destinationPath);
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
        $projectPath = $this->getProjectPath($project); // Fixed: Use consistent path helper

        if ($zip->open($request->file('file')->path()) === TRUE) {
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
        $project->update($request->all()); 
        return response()->json(['project'=>$project]); 
    }

    public function destroy(Request $request, Project $project) 
    { 
        if ($project->user_id !== $request->user()->id) abort(403);
        $project->delete(); 
        FileSystem::deleteDirectory($this->getProjectPath($project));
        return response()->json(['message'=>'Deleted']); 
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
        $zipPath = storage_path('app/public/' . $zipFileName);

        $zip = new \ZipArchive;
        if ($zip->open($zipPath, \ZipArchive::CREATE) === TRUE) {
            $path = $this->getProjectPath($project);
            $files = FileSystem::allFiles($path);
            foreach ($files as $file) {
                if (str_contains($file->getRelativePathname(), '.git/')) continue;
                $zip->addFile($file->getPathname(), $file->getRelativePathname());
            }
            $zip->close();
        } else {
            return response()->json(['error' => 'Could not create zip'], 500);
        }

        return response()->download($zipPath)->deleteFileAfterSend(true);
    }

    /**
     * Start a Docker Sandbox container to run the project
     */
    public function runProject(Request $request, Project $project)
    {
        if ($project->user_id !== $request->user()->id) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $workspacePath = $this->getProjectPath($project);
        
        // 1. Detect Runtime
        $ubiqJsonPath = $workspacePath . '/ubiq.json';
        $runtime = 'static'; 
        
        if (\Illuminate\Support\Facades\File::exists($ubiqJsonPath)) {
            $config = json_decode(file_get_contents($ubiqJsonPath), true);
            $runtime = $config['runtime'] ?? 'static';
        }

        // --- AGGRESSIVE AUTO-DETECTION OVERRIDE ---
        if (\Illuminate\Support\Facades\File::exists($workspacePath . '/package.json')) {
            $runtime = 'node';
        } elseif (\Illuminate\Support\Facades\File::exists($workspacePath . '/composer.json') || \Illuminate\Support\Facades\File::exists($workspacePath . '/artisan')) {
            $runtime = 'php';
        } elseif (\Illuminate\Support\Facades\File::exists($workspacePath . '/requirements.txt') || \Illuminate\Support\Facades\File::exists($workspacePath . '/main.py')) {
            $runtime = 'python';
        }

        $containerName = "ubiq_project_{$project->id}";
        $port = 8000 + ($project->id % 1000); 

        $baseHostPath = env('HOST_WORKSPACE_PATH', '/home/ubuntu/ubiq/backend/storage/app/workspaces');
        $hostMountPath = $baseHostPath . "/{$project->user_id}/{$project->id}";

        \Illuminate\Support\Facades\Process::run("docker stop {$containerName}");
        \Illuminate\Support\Facades\Process::run("docker rm {$containerName}");

        $cmd = "";
        if ($runtime === 'static') {
            $cmd = "docker run -d --name {$containerName} -p {$port}:80 -v " . escapeshellarg($hostMountPath) . ":/usr/share/nginx/html nginx:alpine";
            
        } elseif ($runtime === 'node') {
            $cmd = "docker run -d --name {$containerName} -p {$port}:5173 -v " . escapeshellarg($hostMountPath) . ":/app -w /app node:20-alpine sh -c 'npm install && npm run dev -- --host 0.0.0.0'";
            
        } elseif ($runtime === 'python') {
            $cmd = "docker run -d --name {$containerName} -p {$port}:8000 -v " . escapeshellarg($hostMountPath) . ":/app -w /app python:3.11-alpine sh -c 'if [ -f requirements.txt ]; then pip install -r requirements.txt; fi && if [ -f manage.py ]; then python manage.py runserver 0.0.0.0:8000; else python main.py; fi'";
            
        } elseif ($runtime === 'php') {
            // Uses official composer image which includes PHP.
            // Automatically detects Laravel (artisan) vs Standard PHP
            $cmd = "docker run -d --name {$containerName} -p {$port}:8000 -v " . escapeshellarg($hostMountPath) . ":/app -w /app composer:2.7 sh -c 'if [ -f composer.json ]; then composer install --ignore-platform-reqs; fi && if [ -f artisan ]; then php artisan serve --host=0.0.0.0 --port=8000; elif [ -d public ]; then php -S 0.0.0.0:8000 -t public/; else php -S 0.0.0.0:8000; fi'";
            
        } else {
            return response()->json(['error' => 'Unsupported runtime'], 400);
        }

        // Execute the command with a slightly longer timeout just in case
        $result = \Illuminate\Support\Facades\Process::timeout(120)->run($cmd);

        // --- NEW: RETURN RAW ERRORS ---
        if ($result->failed()) {
            \Illuminate\Support\Facades\Log::error("Docker Run Failed: " . $result->errorOutput());
            return response()->json([
                'error' => 'Build process failed.',
                'command' => $cmd,
                'details' => $result->errorOutput() ?: $result->output() // Send raw Docker/NPM logs to frontend
            ], 500);
        }

        $serverIp = '3.88.204.62'; 
        
        // --- NEW: RETURN EXECUTED COMMAND ON SUCCESS ---
        return response()->json([
            'message' => 'Project is running!',
            'url' => "http://{$serverIp}:{$port}",
            'port' => $port,
            'runtime' => $runtime,
            'command' => $cmd 
        ]);
    }
}