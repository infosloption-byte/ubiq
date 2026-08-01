<?php

namespace App\Console\Commands;

use App\Services\PlanReportService;
use Illuminate\Console\Command;

/**
 * B6 — Quick CLI view into plan_action_logs without writing ad-hoc SQL.
 * Usage: php artisan ubiq:plan-report --days=30
 */
class PlanReport extends Command
{
    protected $signature = 'ubiq:plan-report {--days=30 : How many days back to look}';

    protected $description = 'Show denial rates, top denial reasons, and usage-vs-limit stats per plan from plan_action_logs.';

    public function handle(PlanReportService $report): int
    {
        $days = (int) $this->option('days');

        $this->info("Plan action report — last {$days} day(s)");
        $this->newLine();

        $this->line('<fg=cyan>Denial rates by plan + action</>');
        $denials = $report->denialRatesByPlanAndAction($days);
        if (empty($denials)) {
            $this->line('  No data in this window.');
        } else {
            $this->table(
                ['Plan', 'Action', 'Total', 'Allowed', 'Denied', 'Denial %'],
                array_map(fn ($r) => [$r->plan, $r->action_key, $r->total, $r->allowed_count, $r->denied_count, $r->denial_rate_pct . '%'], $denials)
            );
        }

        $this->newLine();
        $this->line('<fg=cyan>Top denial reasons by plan (what to loosen first)</>');
        $reasons = $report->topDenialReasonsByPlan($days);
        if (empty($reasons)) {
            $this->line('  No denials in this window.');
        } else {
            $this->table(
                ['Plan', 'Action', 'Reason', 'Count'],
                array_map(fn ($r) => [$r->plan, $r->action_key, $r->reason, $r->denial_count], $reasons)
            );
        }

        $this->newLine();
        $this->line('<fg=cyan>Usage vs. limit (how close to the ceiling is typical usage)</>');
        $usage = $report->usageStatsByPlanAndAction($days);
        if (empty($usage)) {
            $this->line('  No numeric-limit data in this window.');
        } else {
            $this->table(
                ['Plan', 'Action', 'Samples', 'Avg % of limit', 'Max % of limit'],
                array_map(fn ($r) => [$r->plan, $r->action_key, $r->sample_size, $r->avg_pct_of_limit . '%', $r->max_pct_of_limit . '%'], $usage)
            );
        }

        return self::SUCCESS;
    }
}
