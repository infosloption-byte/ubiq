<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\File;

class GitController extends Controller
{
    private function getRepoPath(Project $project)
    {
        $path = storage_path("app/workspaces/{$project->user_id}/{$project->id}");
        if (!File::exists($path)) File::makeDirectory($path, 0755, true);
        return $path;
    }

    /**
     * Get the current git status (Used to show the list of changed files).
     */
    public function status(Request $request, Project $project)
    {
        $this->authorizeOwner($request, $project);
        $repoPath = $this->getRepoPath($project);

        if (!File::exists($repoPath . '/.git')) return response()->json(['error' => 'Not a git repository'], 400);

        $output = Process::path($repoPath)->run('git status --porcelain')->output();
        
        $changes = [];
        foreach (explode("\n", trim($output)) as $line) {
            if (empty($line)) continue;
            $path = trim(substr($line, 3));
            $changes[] = ['path' => $path, 'name' => basename($path), 'status' => 'MOD'];
        }

        $branch = trim(Process::path($repoPath)->run('git rev-parse --abbrev-ref HEAD')->output());

        return response()->json(['changes' => $changes, 'staged' => [], 'branch' => $branch ?: 'main']);
    }

    /**
     * One-Click PR Workflow: 
     * 1. Create Feature Branch
     * 2. Stage All Changes
     * 3. Commit
     * 4. Push
     * 5. Generate PR Link
     */
    public function createPr(Request $request, Project $project)
    {
        $this->authorizeOwner($request, $project);
        $token = $request->input('token');
        if (!$token) return response()->json(['error' => 'Token required'], 400);

        $repoPath = $this->getRepoPath($project);
        $branchName = "feature/update-" . date('Ymd-His');

        try {
            // Config
            $user = $request->user();
            Process::path($repoPath)->run("git config user.name " . escapeshellarg($user->name));
            Process::path($repoPath)->run("git config user.email " . escapeshellarg($user->email));

            // Checkout & Commit
            Process::path($repoPath)->run("git checkout -b {$branchName}");
            Process::path($repoPath)->run("git add .");
            
            $msg = $request->input('title') . "\n\n" . $request->input('description');
            $commit = Process::path($repoPath)->run("git commit -m " . escapeshellarg($msg));

            if ($commit->failed() && str_contains($commit->output(), 'nothing to commit')) {
                $this->cleanup($repoPath, $branchName);
                return response()->json(['error' => 'No changes to commit'], 400);
            }

            // Push
            $remoteUrl = $this->getAuthenticatedUrl($project->repository_url, $token);
            $push = Process::path($repoPath)->run("git push {$remoteUrl} {$branchName}");

            if ($push->failed()) throw new \Exception($push->errorOutput());

            // Cleanup & Link
            $this->cleanup($repoPath, $branchName);
            $cleanRepoUrl = preg_replace('/\.git$/', '', $project->repository_url);
            
            return response()->json([
                'message' => 'PR Branch Pushed',
                'pr_url' => "{$cleanRepoUrl}/compare/main...{$branchName}?expand=1"
            ]);

        } catch (\Exception $e) {
            $this->cleanup($repoPath, $branchName);
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    // --- Helpers ---

    private function cleanup($path, $branch) {
        Process::path($path)->run("git checkout -");
        Process::path($path)->run("git branch -D {$branch}");
    }

    private function getAuthenticatedUrl($url, $token) {
        $parts = parse_url($url);
        return $parts['scheme'] . '://' . $token . '@' . $parts['host'] . $parts['path'];
    }

    private function authorizeOwner(Request $request, Project $project) {
        if ($project->user_id !== $request->user()->id) abort(403);
    }
}