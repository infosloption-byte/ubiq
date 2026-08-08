<?php

namespace App\Services;

use App\Exceptions\PlanLimitExceededException;
use App\Models\PlanActionLog;
use App\Models\UsageCounter;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;

/**
 * B2 — The single chokepoint every plan-gated action goes through.
 *
 * No controller should ever compare $user->subscription_tier (or plan_id)
 * directly again — every check goes through here. This is what makes the
 * system centralized instead of just "less scattered."
 *
 * check()     — read-only, no side effects, no audit log entry. For UI
 *               pre-flight checks (e.g. "should I show the upgrade prompt
 *               before the user even tries?").
 * authorize() — the real gate. Throws PlanLimitExceededException on denial,
 *               increments the relevant usage_counters row on allow, and
 *               ALWAYS writes one row to plan_action_logs (allowed or not).
 *               This is the audited path — call it, not check(), for any
 *               action that actually consumes a resource.
 * release()   — decrements a concurrent-type counter (e.g. sandbox stopped).
 *
 * Fails closed: if plan limits can't be resolved (cache/DB issue), every
 * authorize() call denies rather than silently allowing unlimited usage.
 *
 * To add a new guarded action: add one entry to ACTIONS below. No new
 * migration, no touching existing rules.
 */
class PlanGuard
{
    private const TIER_ORDER = ['free' => 0, 'starter' => 1, 'creator' => 2, 'pro' => 3];

    /**
     * Fixed sentinel window_start for 'concurrent' type counters — these
     * represent "currently active right now", not a time bucket, so they
     * must never roll over at a day/hour boundary the way rate counters do.
     */
    private const CONCURRENT_WINDOW_START = '2000-01-01 00:00:00';

    /**
     * Not a const: env() calls (needed for the sandbox.start global ceiling
     * below) aren't allowed in compile-time const expressions — this would
     * be a fatal error as a const array. Cheap enough to rebuild per call;
     * PlanService's own caching is what matters for performance, not this.
     */
    private function actions(): array
    {
        return [
        'sandbox.start' => [
            'type' => 'concurrent',
            'feature_key' => 'sandbox.max_concurrent',
            'counter_key' => 'active_sandboxes',
            // B3e — box-wide ceiling, independent of any single user's own
            // limit. Same SANDBOX_GLOBAL_CONCURRENT_LIMIT convention as
            // HOST_WORKSPACE_PATH elsewhere in this codebase (env() read
            // directly rather than through a dedicated config file, kept
            // consistent with existing style rather than introduced fresh).
            // Default of 3 matches the capacity analysis: ~2.5 vCPU
            // burstable headroom shared with Voxora, ~0.75-1.0 vCPU per
            // sandbox.
            'global_limit' => (int) env('SANDBOX_GLOBAL_CONCURRENT_LIMIT', 3),
        ],
        'ai.request' => [
            'type' => 'rate',
            'feature_keys' => ['hour' => 'ai.requests_per_hour', 'day' => 'ai.requests_per_day'],
            'counter_key' => 'ai_requests',
        ],
        'project.create' => [
            'type' => 'count',
            'feature_key' => 'projects.max_count',
        ],
        'storage.check' => [
            'type' => 'bytes',
            'feature_key' => 'storage.max_mb',
        ],
        'sharing.enable' => [
            'type' => 'boolean',
            'feature_key' => 'sharing.enabled',
        ],
        'model.access' => [
            'type' => 'tier_compare',
            'feature_key' => 'ai.max_model_tier',
        ],
        ];
    }

    public function __construct(private PlanService $planService)
    {
    }

    public function check(User $user, string $actionKey, array $context = []): bool
    {
        try {
            return $this->evaluate($user, $actionKey, $context, increment: false)['allowed'];
        } catch (\Throwable $e) {
            Log::warning("PlanGuard::check failed closed for [{$actionKey}]: {$e->getMessage()}");
            return false;
        }
    }

    /**
     * @throws PlanLimitExceededException
     */
    public function authorize(User $user, string $actionKey, array $context = []): true
    {
        $result = $this->evaluate($user, $actionKey, $context, increment: true);

        $this->log($user, $actionKey, $result);

        if (!$result['allowed']) {
            throw new PlanLimitExceededException(
                $actionKey,
                $result['reason'] ?? 'denied',
                $result['limit'] ?? null,
                $result['usage'] ?? null,
            );
        }

        return true;
    }

    public function release(User $user, string $counterKey): void
    {
        UsageCounter::query()
            ->where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('window_type', 'concurrent')
            ->where('count', '>', 0)
            ->decrement('count');
    }

    /**
     * FIX #16: hard reconciliation for a concurrent counter — closes a leak
     * class that release() structurally cannot reach. release() only ever
     * fires in correlation with a specific SandboxRun row; if authorize()
     * increments the counter and the request then dies before
     * claimPortAndReserve() creates that row (worker crash, OOM, or a
     * web-server-level timeout killing the request mid-flight — nginx's
     * fastcgi_read_timeout for this route is 120s, the same boundary as
     * our own Docker process timeout, so it's a real race, not just a
     * theoretical one), there is no row anywhere for reapStaleSandboxes()
     * to find and correlate the leaked increment against. That leak is
     * permanent under every fix so far, because all of them work by
     * iterating existing rows.
     *
     * This instead directly clamps the counter down to the TRUE number of
     * open rows for the user — ground truth, independent of whether a
     * leak has a row behind it or not. Deliberately one-directional: only
     * ever decreases the counter, only down to $trueCount, never up — so a
     * genuinely concurrent authorize() call for a real new sandbox, landing
     * in the narrow window between this method's read and write, can't be
     * stomped by a stale comparison here. Called from
     * ProjectController::reapStaleSandboxes() after its per-row pass, so
     * this is the actual backstop under all of it.
     */
    public function reconcileConcurrent(User $user, string $counterKey, int $trueCount): void
    {
        UsageCounter::query()
            ->where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('window_type', 'concurrent')
            ->where('count', '>', $trueCount)
            ->update(['count' => max(0, $trueCount)]);
    }

    /**
     * Total active count for a concurrent counter across ALL users —
     * this is the primitive Phase B3e's global sandbox ceiling check
     * builds on (box can only sustain ~2-3 concurrent sandboxes total,
     * per the capacity analysis, regardless of any single user's own limit).
     */
    public function globalActiveCount(string $counterKey): int
    {
        return (int) UsageCounter::query()
            ->where('counter_key', $counterKey)
            ->where('window_type', 'concurrent')
            ->sum('count');
    }

    private function evaluate(User $user, string $actionKey, array $context, bool $increment): array
    {
        $rule = $this->actions()[$actionKey] ?? null;

        if ($rule === null) {
            return ['allowed' => false, 'reason' => 'unknown_action'];
        }

        try {
            $limits = $this->planService->limitsFor($user);
        } catch (\Throwable $e) {
            Log::warning("PlanGuard: plan lookup failed for user {$user->id}: {$e->getMessage()}");
            return ['allowed' => false, 'reason' => 'plan_lookup_failed'];
        }

        if (empty($limits)) {
            // No plan resolvable at all — deny rather than assume unlimited.
            return ['allowed' => false, 'reason' => 'no_plan_resolved'];
        }

        return match ($rule['type']) {
            'concurrent' => $this->evaluateConcurrent($user, $rule, $limits, $increment),
            'rate' => $this->evaluateRate($user, $rule, $limits, $increment),
            'count' => $this->evaluateCount($user, $rule, $limits, $context),
            'bytes' => $this->evaluateBytes($rule, $limits, $context),
            'boolean' => $this->evaluateBoolean($rule, $limits),
            'tier_compare' => $this->evaluateTierCompare($rule, $limits, $context),
            default => ['allowed' => false, 'reason' => 'unhandled_rule_type'],
        };
    }

    private function isUnlimited(int|bool|string|null $value): bool
    {
        return is_int($value) && $value === -1;
    }

    private function evaluateConcurrent(User $user, array $rule, array $limits, bool $increment): array
    {
        $limit = $limits[$rule['feature_key']] ?? 0;
        $current = $this->currentConcurrent($user, $rule['counter_key']);

        if (!$this->isUnlimited($limit) && $current >= $limit) {
            return ['allowed' => false, 'reason' => 'concurrent_limit_exceeded', 'limit' => $limit, 'usage' => $current];
        }

        // B3e — box-wide ceiling, independent of any single user's own
        // limit. Checked after the per-user check so a per-user denial
        // still reports the more specific/actionable reason; the global
        // ceiling is the fallback reason once every individual user's own
        // limit would otherwise allow the request.
        if (isset($rule['global_limit'])) {
            $globalCurrent = $this->globalActiveCount($rule['counter_key']);
            if ($globalCurrent >= $rule['global_limit']) {
                return [
                    'allowed' => false,
                    'reason' => 'global_capacity_reached',
                    'limit' => $rule['global_limit'],
                    'usage' => $globalCurrent,
                ];
            }
        }

        if ($increment) {
            $this->incrementConcurrent($user, $rule['counter_key']);
        }

        return ['allowed' => true, 'limit' => $limit, 'usage' => $current];
    }

    private function currentConcurrent(User $user, string $counterKey): int
    {
        return (int) (UsageCounter::query()
            ->where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('window_type', 'concurrent')
            ->value('count') ?? 0);
    }

    private function incrementConcurrent(User $user, string $counterKey): void
    {
        UsageCounter::query()->firstOrCreate(
            [
                'user_id' => $user->id,
                'counter_key' => $counterKey,
                'window_type' => 'concurrent',
                'window_start' => self::CONCURRENT_WINDOW_START,
            ],
            ['count' => 0]
        );

        UsageCounter::query()
            ->where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('window_type', 'concurrent')
            ->increment('count');
    }

    /**
     * Note: check-then-increment isn't wrapped in a DB lock here, so a user
     * firing many requests in the same instant could theoretically slip a
     * few over the limit before the count catches up. Acceptable for launch
     * — if it becomes a real abuse vector, wrap this in
     * DB::transaction + lockForUpdate() on the counter row.
     */
    private function evaluateRate(User $user, array $rule, array $limits, bool $increment): array
    {
        $hourLimit = $limits[$rule['feature_keys']['hour']] ?? 0;
        $dayLimit = $limits[$rule['feature_keys']['day']] ?? 0;

        $hourStart = Carbon::now()->startOfHour();
        $dayStart = Carbon::now()->startOfDay();

        $hourUsage = $this->currentWindowCount($user, $rule['counter_key'], 'hour', $hourStart);
        $dayUsage = $this->currentWindowCount($user, $rule['counter_key'], 'day', $dayStart);

        if (!$this->isUnlimited($hourLimit) && $hourUsage >= $hourLimit) {
            return ['allowed' => false, 'reason' => 'hourly_limit_exceeded', 'limit' => $hourLimit, 'usage' => $hourUsage];
        }

        if (!$this->isUnlimited($dayLimit) && $dayUsage >= $dayLimit) {
            return ['allowed' => false, 'reason' => 'daily_limit_exceeded', 'limit' => $dayLimit, 'usage' => $dayUsage];
        }

        if ($increment) {
            $this->incrementWindow($user, $rule['counter_key'], 'hour', $hourStart);
            $this->incrementWindow($user, $rule['counter_key'], 'day', $dayStart);
        }

        return ['allowed' => true, 'limit' => $hourLimit, 'usage' => $hourUsage];
    }

    private function currentWindowCount(User $user, string $counterKey, string $windowType, Carbon $windowStart): int
    {
        return (int) (UsageCounter::query()
            ->where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('window_type', $windowType)
            ->where('window_start', $windowStart)
            ->value('count') ?? 0);
    }

    private function incrementWindow(User $user, string $counterKey, string $windowType, Carbon $windowStart): void
    {
        UsageCounter::query()->firstOrCreate(
            [
                'user_id' => $user->id,
                'counter_key' => $counterKey,
                'window_type' => $windowType,
                'window_start' => $windowStart,
            ],
            ['count' => 0]
        );

        UsageCounter::query()
            ->where('user_id', $user->id)
            ->where('counter_key', $counterKey)
            ->where('window_type', $windowType)
            ->where('window_start', $windowStart)
            ->increment('count');
    }

    /**
     * Projects (and similarly, storage/other persistent resources) aren't
     * time-windowed — count against live rows so deletions self-correct the
     * count instead of drifting the way an incrementing counter would.
     * Caller may pass context['current_count'] to avoid a duplicate query
     * if it already has the count on hand.
     */
    private function evaluateCount(User $user, array $rule, array $limits, array $context): array
    {
        $limit = $limits[$rule['feature_key']] ?? 0;

        if ($this->isUnlimited($limit)) {
            return ['allowed' => true];
        }

        $current = $context['current_count'] ?? $user->projects()->count();

        if ($current >= $limit) {
            return ['allowed' => false, 'reason' => 'count_limit_exceeded', 'limit' => $limit, 'usage' => $current];
        }

        return ['allowed' => true, 'limit' => $limit, 'usage' => $current];
    }

    /**
     * Storage, like projects, is persistent state, not a time window —
     * caller must pass context['current_bytes'] (a live DB sum, e.g.
     * User::getUsedStorageBytes()), no query happens in here. Limit is
     * stored in plan_features as MB (human-readable in the DB, matching
     * sandbox.memory_mb's convention) and converted to bytes for the
     * comparison, which is what actually needs byte precision.
     */
    private function evaluateBytes(array $rule, array $limits, array $context): array
    {
        $limitMb = $limits[$rule['feature_key']] ?? 0;

        if ($this->isUnlimited($limitMb)) {
            return ['allowed' => true];
        }

        $limitBytes = $limitMb * 1048576;
        $currentBytes = $context['current_bytes'] ?? 0;

        if ($currentBytes >= $limitBytes) {
            return ['allowed' => false, 'reason' => 'storage_limit_exceeded', 'limit' => $limitBytes, 'usage' => $currentBytes];
        }

        return ['allowed' => true, 'limit' => $limitBytes, 'usage' => $currentBytes];
    }

    private function evaluateBoolean(array $rule, array $limits): array
    {
        $enabled = (bool) ($limits[$rule['feature_key']] ?? false);

        return $enabled
            ? ['allowed' => true]
            : ['allowed' => false, 'reason' => 'feature_not_enabled_for_plan'];
    }

    /**
     * context['model_tier'] should be the requested model's tier_required
     * value (e.g. from available_models), compared against the plan's
     * ai.max_model_tier ceiling using TIER_ORDER.
     */
    private function evaluateTierCompare(array $rule, array $limits, array $context): array
    {
        $maxTier = (string) ($limits[$rule['feature_key']] ?? 'free');
        $requestedTier = (string) ($context['model_tier'] ?? 'free');

        $maxOrdinal = self::TIER_ORDER[$maxTier] ?? 0;
        $requestedOrdinal = self::TIER_ORDER[$requestedTier] ?? 0;

        return $requestedOrdinal <= $maxOrdinal
            ? ['allowed' => true]
            : ['allowed' => false, 'reason' => 'model_tier_not_permitted', 'limit' => $maxTier, 'usage' => $requestedTier];
    }

    /**
     * Live remaining-usage snapshot for a rate/concurrent action, without
     * consuming any of it. Used by controllers that want to surface
     * "X requests remaining" in a response, and by the Phase C1 usage
     * widget (GET /me/usage) — one implementation, two consumers.
     *
     * @return array{hour_limit?: int, hour_remaining?: ?int, day_limit?: int, day_remaining?: ?int, limit?: int, remaining?: ?int}|null
     */
    public function remaining(User $user, string $actionKey): ?array
    {
        $rule = $this->actions()[$actionKey] ?? null;

        if ($rule === null) {
            return null;
        }

        try {
            $limits = $this->planService->limitsFor($user);
        } catch (\Throwable $e) {
            return null;
        }

        if (empty($limits)) {
            return null;
        }

        return match ($rule['type']) {
            'rate' => $this->remainingRate($user, $rule, $limits),
            'concurrent' => $this->remainingConcurrent($user, $rule, $limits),
            default => null,
        };
    }

    private function remainingRate(User $user, array $rule, array $limits): array
    {
        // E2b sub-part (PLAN_SYSTEM_TASKS.md Phase E): added hour_resets_at/
        // day_resets_at so the frontend can show a live "resets in Xh Ym"
        // countdown (the reported Claude-style ask). Computed server-side as
        // absolute UTC instants (ISO8601, via toISOString()) rather than
        // having the frontend guess "midnight" or "top of the hour" in the
        // browser's own timezone — that would silently disagree with the
        // actual boundary this class enforces (Carbon::now()->startOfHour/
        // startOfDay(), in the app's configured timezone) any time those two
        // timezones differ. A single $now snapshot is reused for both,
        // copied before each mutating startOf*() call — Carbon mutates in
        // place by default, so without ->copy() the day calculation below
        // would corrupt $now for anything computed after it.
        $now = Carbon::now();

        $hourLimit = $limits[$rule['feature_keys']['hour']] ?? 0;
        $hourUsage = $this->currentWindowCount($user, $rule['counter_key'], 'hour', $now->copy()->startOfHour());
        $dayLimit = $limits[$rule['feature_keys']['day']] ?? 0;
        $dayUsage = $this->currentWindowCount($user, $rule['counter_key'], 'day', $now->copy()->startOfDay());

        return [
            'hour_limit' => $hourLimit,
            'hour_remaining' => $this->isUnlimited($hourLimit) ? null : max(0, $hourLimit - $hourUsage),
            'hour_resets_at' => $now->copy()->startOfHour()->addHour()->toISOString(),
            'day_limit' => $dayLimit,
            'day_remaining' => $this->isUnlimited($dayLimit) ? null : max(0, $dayLimit - $dayUsage),
            'day_resets_at' => $now->copy()->startOfDay()->addDay()->toISOString(),
        ];
    }

    private function remainingConcurrent(User $user, array $rule, array $limits): array
    {
        $limit = $limits[$rule['feature_key']] ?? 0;
        $current = $this->currentConcurrent($user, $rule['counter_key']);

        return [
            'limit' => $limit,
            'remaining' => $this->isUnlimited($limit) ? null : max(0, $limit - $current),
        ];
    }

    /**
     * Logging must never break the guarded action itself — a failed insert
     * here is swallowed (and warned to the app log) rather than thrown.
     */
    private function log(User $user, string $actionKey, array $result): void
    {
        try {
            PlanActionLog::query()->create([
                'user_id' => $user->id,
                'plan_id_at_time' => optional($this->planService->planFor($user))->id,
                'action_key' => $actionKey,
                'allowed' => $result['allowed'],
                'limit_value' => isset($result['limit']) ? (string) $result['limit'] : null,
                'current_usage' => isset($result['usage']) ? (string) $result['usage'] : null,
                'reason' => $result['reason'] ?? null,
                'metadata' => null,
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("PlanGuard: failed to write plan_action_logs entry: {$e->getMessage()}");
        }
    }
}
