<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Project;
use App\Models\File;
use App\Models\ChatSession;

class UsageController extends Controller
{
    /**
     * Get dashboard statistics for the user
     */
    public function stats(Request $request)
    {
        $user = $request->user();
        
        // Count projects belonging to user
        $projectCount = Project::where('user_id', $user->id)->count();

        // Count files in those projects
        $fileCount = File::whereIn('project_id', $user->projects()->select('id'))->count();

        // Count chat sessions
        $chatCount = ChatSession::where('user_id', $user->id)->count();

        return response()->json([
            'stats' => [
                'total_projects' => $projectCount,
                'total_files' => $fileCount,
                'total_chats' => $chatCount,
                'subscription_tier' => $user->subscription_tier ?? 'free',
            ]
        ]);
    }

    /**
     * Get usage logs (Placeholder for future feature)
     */
    public function index(Request $request)
    {
        return response()->json([
            'usage' => []
        ]);
    }
}