<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\SiteVisit; 
use App\Models\UsageLog;
use App\Services\PlanGuard;
use App\Services\PlanService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UsageController extends Controller
{
    /**
     * GET /user/plan-usage — C1's usage widget data. Distinct from the
     * existing /user/usage (historical time-series for charts) — this is
     * live "how much of my CURRENT limit have I used right now" data,
     * reusing PlanGuard::remaining() rather than duplicating its counter
     * logic here.
     */
    public function planUsage(Request $request, PlanGuard $planGuard, PlanService $planService)
    {
        $user = $request->user();
        $plan = $planService->planFor($user);

        $storageLimitMb = $planService->limitFor($user, 'storage.max_mb') ?? 512;
        $storageUnlimited = is_int($storageLimitMb) && $storageLimitMb === -1;
        $usedBytes = $user->getUsedStorageBytes();
        $limitBytes = $storageUnlimited ? null : ((int) $storageLimitMb * 1048576);

        $projectsLimit = $planService->limitFor($user, 'projects.max_count') ?? 3;
        $projectsUnlimited = is_int($projectsLimit) && $projectsLimit === -1;

        return response()->json([
            'plan' => [
                'key' => $plan?->key ?? 'free',
                'name' => $plan?->name ?? 'Free',
            ],
            'ai' => $planGuard->remaining($user, 'ai.request'),
            'sandbox' => $planGuard->remaining($user, 'sandbox.start'),
            'storage' => [
                'used_mb' => round($usedBytes / 1048576, 2),
                'limit_mb' => $storageUnlimited ? null : (int) $storageLimitMb,
                'unlimited' => $storageUnlimited,
                'percent' => (!$storageUnlimited && $limitBytes > 0) ? round(($usedBytes / $limitBytes) * 100, 1) : 0,
            ],
            'projects' => [
                'count' => $user->projects()->count(),
                'limit' => $projectsUnlimited ? null : (int) $projectsLimit,
                'unlimited' => $projectsUnlimited,
            ],
            // E2b fix (PLAN_SYSTEM_TASKS.md Phase E): these are the plan's
            // static *capability* specs, not consumable usage counters —
            // there's no "used/limit" or percent for them, just "what your
            // plan includes." Previously absent from this endpoint entirely,
            // so no Settings view could show them regardless of what the
            // frontend tried to render. Keys match plan_features.feature_key
            // exactly (see PlanSeeder) so this stays a straight passthrough,
            // not a re-mapping that could drift from the seeder later.
            'limits' => [
                'sandbox_cpu'                  => $planService->limitFor($user, 'sandbox.cpu'),
                'sandbox_memory_mb'            => $planService->limitFor($user, 'sandbox.memory_mb'),
                'sandbox_idle_timeout_minutes' => $planService->limitFor($user, 'sandbox.idle_timeout_minutes'),
                'max_model_tier'               => $planService->limitFor($user, 'ai.max_model_tier'),
                'sharing_enabled'              => $planService->limitFor($user, 'sharing.enabled'),
            ],
        ]);
    }

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
        // Simple throttling: don't count the same IP more than once per hour
        $exists = SiteVisit::where('ip_address', $request->ip())
            ->where('created_at', '>', now()->subHour())
            ->exists();

        if (!$exists) {
            SiteVisit::create([
                'ip_address' => $request->ip(),
                'user_agent' => $request->userAgent(),
                'referer'    => $request->header('referer'),
            ]);
        }

        return response()->json(['status' => 'recorded']);
    }
}