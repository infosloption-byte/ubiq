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
Schedule::command('ubiq:cleanup-sandboxes --hours=2')
    ->hourly()
    ->withoutOverlapping()   // skip if a previous run is still going
    ->runInBackground()
    ->appendOutputTo(storage_path('logs/sandbox-cleanup.log'));