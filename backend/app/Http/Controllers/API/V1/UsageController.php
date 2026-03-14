<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\UsageLog;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UsageController extends Controller
{
    /**
     * GET /user/stats
     * Returns aggregate stats for the dashboard stat cards.
     * Shape: { stats: { total_projects, total_files, total_chats, subscription_tier } }
     */
    public function stats(Request $request)
    {
        $user = $request->user();

        $totalProjects = DB::table('projects')
            ->where('user_id', $user->id)
            ->where('is_archived', false)
            ->count();

        $totalFiles = DB::table('files')
            ->join('projects', 'files.project_id', '=', 'projects.id')
            ->where('projects.user_id', $user->id)
            ->where('files.is_deleted', false)
            ->count();

        $totalChats = DB::table('chat_sessions')
            ->where('user_id', $user->id)
            ->count();

        return response()->json([
            'stats' => [
                'total_projects'    => $totalProjects,
                'total_files'       => $totalFiles,
                'total_chats'       => $totalChats,
                'subscription_tier' => $user->subscription_tier ?? 'free',
            ]
        ]);
    }

    /**
     * GET /user/usage
     * Returns time-series token usage for charts.
     */
    public function index(Request $request)
    {
        $days = (int) $request->input('days', 30);
        $user = $request->user();

        $usage = UsageLog::where('user_id', $user->id)
            ->where('created_at', '>=', now()->subDays($days))
            ->selectRaw('DATE(created_at) as date, SUM(tokens_input + tokens_output) as total_tokens, COUNT(*) as requests')
            ->groupBy('date')
            ->orderBy('date')
            ->get();

        $totalTokens = UsageLog::where('user_id', $user->id)
            ->where('created_at', '>=', now()->subDays($days))
            ->sum(DB::raw('tokens_input + tokens_output'));

        $totalRequests = UsageLog::where('user_id', $user->id)
            ->where('created_at', '>=', now()->subDays($days))
            ->count();

        return response()->json([
            'usage'          => $usage,
            'total_tokens'   => (int) $totalTokens,
            'total_requests' => $totalRequests,
            'period_days'    => $days,
        ]);
    }

    /**
     * POST /visit  (public — no auth)
     * Lightweight page-view recorder.
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