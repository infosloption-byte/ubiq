<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\PlanActionLog;
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
     *
     * G1a (PLAN_SYSTEM_TASKS.md Phase F) added `recent_denials` — the
     * last 10 plan_action_logs rows where this user was denied, raw
     * reason codes and all. See the field's own inline comment below for
     * why this stays untranslated at the API layer.
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

        // G1a (PLAN_SYSTEM_TASKS.md Phase F): recent denials, so the
        // Usage panel can show "here's what you actually hit and when"
        // instead of just current live totals. Deliberately raw here —
        // action_key/reason are returned as PlanGuard's own enum values,
        // not pre-translated to copy. Frontend maps them through the
        // same REASON_COPY table the point-of-failure modal already
        // uses (see planLimitStore.ts) so the two surfaces can never say
        // different things about the same reason code. Capped at 10 and
        // scoped to denials only (allowed = false) — this endpoint isn't
        // trying to be a general audit log, just "what recently blocked
        // me." Query itself lives in recentDenialsQuery() below — see
        // that method's docblock for the G1d generalization work.
        $recentDenials = $this->recentDenialsQuery($user->id, 10)
            ->map(fn (PlanActionLog $log) => [
                'action_key'    => $log->action_key,
                'reason'        => $log->reason,
                'limit_value'   => $log->limit_value,
                'current_usage' => $log->current_usage,
                'created_at'    => $log->created_at,
            ])
            ->values();

        return response()->json([
            'plan' => [
                'key' => $plan?->key ?? 'free',
                'name' => $plan?->name ?? 'Free',
            ],
            'ai' => $planGuard->remaining($user, 'ai.request'),
            'sandbox' => $planGuard->remaining($user, 'sandbox.start'),
            'recent_denials' => $recentDenials,
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
     * G1d (PLAN_SYSTEM_TASKS.md Phase F, follow-up to G1a): the query
     * behind planUsage()'s "recent denials" list, pulled out so the
     * exact same shape works instance-wide once Bucket 3's admin
     * analytics needs it — pass `$userId = null` for "any user" there
     * instead of duplicating this query. G1d's task was specifically to
     * *confirm* that generalization is actually free, not just assume
     * it — it wasn't quite: `plan_action_logs` was only indexed on
     * `(user_id, created_at)` and `(action_key, allowed, created_at)`
     * (see that table's original migration), neither of which covers a
     * plain `allowed = false ORDER BY created_at DESC` scan across every
     * user. Migration 2026_08_13_000001 adds the missing
     * `(allowed, created_at)` index so this stays a real index scan
     * instead of a full-table scan once `$userId` is actually passed as
     * null somewhere.
     *
     * Deliberately NOT exposed as an admin endpoint yet — that's real
     * Bucket 3 scope (who's authorized to query other users' denial
     * history, pagination past a flat limit, joining user identity for
     * display). This only proves the underlying query generalizes
     * without rework; the admin surface around it is still intentionally
     * unbuilt. `id`/`user_id` are selected (unlike the old inline query)
     * specifically so a future caller with `$userId = null` can tell
     * whose denial each row is — the current per-user caller just
     * ignores those two fields in its own `->map()`.
     */
    private function recentDenialsQuery(?int $userId, int $limit = 10)
    {
        return PlanActionLog::query()
            ->when($userId !== null, fn ($q) => $q->where('user_id', $userId))
            ->where('allowed', false)
            ->orderByDesc('created_at')
            ->limit($limit)
            ->get(['id', 'user_id', 'action_key', 'reason', 'limit_value', 'current_usage', 'created_at']);
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