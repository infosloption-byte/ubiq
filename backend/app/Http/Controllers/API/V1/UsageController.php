<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Project;
use App\Models\File;
use App\Models\ChatSession;
use App\Models\UsageLog;
use App\Models\SiteVisit;

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

    /**
     * Record a public site visit
     * POST /api/v1/visit
     */
    public function recordVisit(Request $request)
    {
        // Simple throttling: Don't count same IP multiple times per hour
        $exists = SiteVisit::where('ip_address', $request->ip())
            ->where('created_at', '>', now()->subHour())
            ->exists();

        if (!$exists) {
            SiteVisit::create([
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'referer' => $request->header('referer'),
            ]);
        }

        return response()->json(['status' => 'recorded']);
    }
}