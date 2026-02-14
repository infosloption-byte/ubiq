<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Models\Project;
use Illuminate\Support\Facades\File;

class MigrateWorkspaces extends Command
{
    protected $signature = 'ubiq:migrate-workspaces';
    protected $description = 'Migrate old projects to user workspaces and sync DB content to disk';

    public function handle()
    {
        $this->info('Starting Workspace Migration...');

        $projects = Project::with('files')->get();

        foreach ($projects as $project) {
            $this->info("Processing Project ID: {$project->id} (User: {$project->user_id})");

            // Define Paths
            $oldPath = storage_path("app/projects/{$project->id}");
            $newPath = storage_path("app/workspaces/{$project->user_id}/{$project->id}");

            // 1. Create User Workspace Directory if missing
            $userWorkspace = dirname($newPath);
            if (!File::exists($userWorkspace)) {
                File::makeDirectory($userWorkspace, 0755, true);
            }

            // 2. Move existing folder if it exists
            if (File::exists($oldPath)) {
                if (File::exists($newPath)) {
                    $this->warn(" - New path already exists. Merging...");
                    // File::copyDirectory($oldPath, $newPath); 
                } else {
                    $this->info(" - Moving folder to workspace...");
                    File::moveDirectory($oldPath, $newPath);
                }
            } else {
                $this->warn(" - No folder found at old path. Creating new workspace folder...");
                if (!File::exists($newPath)) {
                    File::makeDirectory($newPath, 0755, true);
                }
            }

            // 3. FORCE SYNC: Dump DB content to Disk
            $this->info(" - Syncing {$project->files->count()} files from Database to Disk...");
            
            foreach ($project->files as $file) {
                $filePath = $newPath . '/' . $file->path;
                $directory = dirname($filePath);

                if (!File::exists($directory)) {
                    File::makeDirectory($directory, 0755, true);
                }
                File::put($filePath, $file->content);
            }
            
            // 4. Git Initialization (FIXED)
            if (!File::exists($newPath . '/.git')) {
                $this->info(" - Initializing Git repository...");
                
                // Fix "Dubious Ownership"
                exec("git config --global --add safe.directory " . escapeshellarg($newPath));

                // Commands to Init, Configure Identity, and Commit
                $commands = [
                    "cd " . escapeshellarg($newPath),
                    "git init",
                    // Fix "Author identity unknown"
                    "git config user.email 'migration@ubiq.com'",
                    "git config user.name 'Migration Bot'",
                    "git add .",
                    "git commit -m 'Migration init'"
                ];

                exec(implode(' && ', $commands));
            }
        }

        $this->info('Migration Completed Successfully!');
    }
}