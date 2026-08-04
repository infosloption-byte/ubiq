<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// ── Sandbox cleanup ────────────────────────────────────────────────────────
// Runs every hour. Stops any Docker container whose sandbox_run row is still
// open (stopped_at IS NULL) and was started more than 2 hours ago.
//
// This catches two cases:
//   1. User closed the browser without clicking Stop
//   2. The frontend beforeunload stop request failed (network drop, etc.)
//
// The --hours flag matches the threshold in ProjectRunner's frontend warning.
// UPDATE: scheduled runs now omit --hours entirely so cleanup uses each
// sandbox owner's plan-specific sandbox.idle_timeout_minutes instead of one
// flat 2h for everyone (see PLAN_SYSTEM_TASKS.md Phase B3b). --hours is kept
// as a manual override for ad-hoc/emergency sweeps only — pass it by hand
// when needed, don't bake it into the schedule.
// NOTE: the frontend's own idle warning is a separate hardcoded 2h value
// (ProjectRunner) — now out of sync with the per-tier backend timeout.
// Worth revisiting in Phase C so the frontend warning reflects the actual
// plan-specific timeout instead of a fixed number.
//
// UPDATE (B3e): was ->hourly() — meaning Free tier's nominal 20min idle
// timeout could actually hold resources up to ~80min worst-case before the
// cron caught it (flagged in B3b, closed here). Every 15min keeps the gap
// between "nominal timeout" and "actual enforcement" small relative to the
// shortest tier timeout, without running so often it becomes its own
// meaningful load.
//
// FIX #11: tightened 15min -> 2min. This same command now also enforces
// the --abandoned-minutes heartbeat check (default 2min, see
// CleanupSandboxes), which exists specifically to catch a laptop
// sleep/dropped-network/crash within a couple of minutes instead of
// waiting up to a full tier idle-timeout window. Running the whole command
// every 15min would have made that heartbeat check pointless — it would
// never fire meaningfully faster than the idle timeout it's meant to beat.
// The query itself stays cheap even at this frequency: per the capacity
// note above, open sandbox_runs rows are only ever a handful at a time
// system-wide (global concurrency capped at ~2-3 sandboxes), so this is a
// tiny, indexed scan every 2 minutes, not a load concern.
Schedule::command('ubiq:cleanup-sandboxes')
    ->everyTwoMinutes()
    ->withoutOverlapping()   // skip if a previous run is still going
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/sandbox-cleanup.log'));

// C4 — this genuinely did not exist before (confirmed via grep): a
// canceled PayPal subscription's grace period (subscription_ends_at)
// would end with nobody ever actually downgrading the user's
// subscription_tier/plan_id back to Free. Hourly is frequent enough that
// nobody sits with stale paid-tier access for long after their grace
// period ends, without needing per-minute precision for a billing check.
Schedule::command('ubiq:downgrade-expired-subscriptions')
    ->hourly()
    ->withoutOverlapping()
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/subscription-downgrade.log'));