<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Symfony\Component\Process\Process;

class RunnerController extends Controller
{
    public function preview(Request $request, Project $project)
    {
        // FIX: Use Workspace Path
        $projectPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        $configFile = $projectPath . '/ubiq.json';

        // Default to static if config missing
        if (!File::exists($configFile)) {
            return $this->serveStatic($project, 'index.html');
        }

        $config = json_decode(file_get_contents($configFile), true);
        $runtime = $config['runtime'] ?? 'static';

        switch ($runtime) {
            case 'static':
                return $this->serveStatic($project, $config['entry'] ?? 'index.html');
            
            case 'php':
                return response()->file($projectPath . '/' . ($config['entry'] ?? 'index.php'));

            case 'python':
            case 'node':
                return response()->json([
                    'message' => 'Backend runtimes require a dedicated runner.',
                    'action' => 'needs_terminal',
                    'command' => $config['command'] ?? 'npm start'
                ]);
                
            default:
                return $this->serveStatic($project, 'index.html');
        }
    }

    private function serveStatic($project, $path)
    {
        // Reuse FileController preview logic via redirect or direct call
        // Note: Make sure token handling matches your frontend expectations
        // Ideally, just redirect to the file serving endpoint
        return redirect("/api/v1/projects/{$project->id}/files/serve?path=" . urlencode($path));
    }
}