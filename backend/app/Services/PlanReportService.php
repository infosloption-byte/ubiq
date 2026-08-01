<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * B6 — Canned queries against plan_action_logs, so the 60-day pricing
 * revisit (see the cost report and PLAN_SYSTEM_TASKS.md) doesn't require
 * writing ad-hoc SQL each time. Exposed via both an Artisan command
 * (ubiq:plan-report) for a quick CLI check and an admin API endpoint
 * (GET /admin/plans/report) for anything that wants it as JSON — same
 * service, two consumers, matching how PlanService/PlanGuard are shared.
 *
 * "Usage percentile" in the original phase description is approximated as
 * avg/max usage-as-%-of-limit rather than a true percentile — MySQL has no
 * native PERCENTILE_CONT before 8.0.2, and avg/max already answers the
 * actionable question ("are people running close to the ceiling") without
 * a window-function query. Revisit with real percentiles later if the
 * simplification isn't precise enough once there's real traffic volume.
 */
class PlanReportService
{
    /**
     * Allow/deny counts and denial rate, grouped by plan and action.
     * Answers: "which plan+action combos are actually hitting their limit
     * often enough to matter?"
     */
    public function denialRatesByPlanAndAction(int $days = 30): array
    {
        return DB::table('plan_action_logs')
            ->join('plans', 'plans.id', '=', 'plan_action_logs.plan_id_at_time')
            ->select(
                'plans.key as plan',
                'plan_action_logs.action_key',
                DB::raw('COUNT(*) as total'),
                DB::raw('SUM(CASE WHEN allowed = 1 THEN 1 ELSE 0 END) as allowed_count'),
                DB::raw('SUM(CASE WHEN allowed = 0 THEN 1 ELSE 0 END) as denied_count')
            )
            ->where('plan_action_logs.created_at', '>=', now()->subDays($days))
            ->groupBy('plans.key', 'plan_action_logs.action_key')
            ->orderBy('plans.key')
            ->orderByDesc('denied_count')
            ->get()
            ->map(function ($row) {
                $row->denial_rate_pct = $row->total > 0
                    ? round(($row->denied_count / $row->total) * 100, 1)
                    : 0.0;
                return $row;
            })
            ->toArray();
    }

    /**
     * For denied requests only: which specific reason (concurrent_limit_
     * exceeded, hourly_limit_exceeded, etc.) is most common per plan.
     * Answers: "if I'm going to loosen ONE limit per tier, which one?"
     */
    public function topDenialReasonsByPlan(int $days = 30): array
    {
        return DB::table('plan_action_logs')
            ->join('plans', 'plans.id', '=', 'plan_action_logs.plan_id_at_time')
            ->select(
                'plans.key as plan',
                'plan_action_logs.action_key',
                'plan_action_logs.reason',
                DB::raw('COUNT(*) as denial_count')
            )
            ->where('plan_action_logs.allowed', false)
            ->where('plan_action_logs.created_at', '>=', now()->subDays($days))
            ->groupBy('plans.key', 'plan_action_logs.action_key', 'plan_action_logs.reason')
            ->orderBy('plans.key')
            ->orderByDesc('denial_count')
            ->get()
            ->toArray();
    }

    /**
     * For allowed requests with a numeric limit/usage recorded: how close
     * to the ceiling is typical usage, per plan+action. Only meaningful
     * for rate/concurrent-type actions (limit_value and current_usage are
     * both numeric strings there); boolean/tier_compare actions won't have
     * numeric values and are naturally excluded by the CAST/regex filter.
     */
    public function usageStatsByPlanAndAction(int $days = 30): array
    {
        return DB::table('plan_action_logs')
            ->join('plans', 'plans.id', '=', 'plan_action_logs.plan_id_at_time')
            ->select(
                'plans.key as plan',
                'plan_action_logs.action_key',
                DB::raw('COUNT(*) as sample_size'),
                DB::raw('AVG(CAST(plan_action_logs.current_usage AS DECIMAL(10,2)) / CAST(plan_action_logs.limit_value AS DECIMAL(10,2)) * 100) as avg_pct_of_limit'),
                DB::raw('MAX(CAST(plan_action_logs.current_usage AS DECIMAL(10,2)) / CAST(plan_action_logs.limit_value AS DECIMAL(10,2)) * 100) as max_pct_of_limit')
            )
            ->where('plan_action_logs.allowed', true)
            ->whereNotNull('plan_action_logs.limit_value')
            ->whereNotNull('plan_action_logs.current_usage')
            ->where('plan_action_logs.limit_value', 'REGEXP', '^[0-9]+$')
            ->where('plan_action_logs.limit_value', '>', 0)
            ->where('plan_action_logs.created_at', '>=', now()->subDays($days))
            ->groupBy('plans.key', 'plan_action_logs.action_key')
            ->orderBy('plans.key')
            ->get()
            ->map(function ($row) {
                $row->avg_pct_of_limit = round((float) $row->avg_pct_of_limit, 1);
                $row->max_pct_of_limit = round((float) $row->max_pct_of_limit, 1);
                return $row;
            })
            ->toArray();
    }

    /** Convenience — all three reports together, e.g. for the API endpoint. */
    public function fullReport(int $days = 30): array
    {
        return [
            'window_days' => $days,
            'denial_rates' => $this->denialRatesByPlanAndAction($days),
            'top_denial_reasons' => $this->topDenialReasonsByPlan($days),
            'usage_vs_limit' => $this->usageStatsByPlanAndAction($days),
        ];
    }
}
