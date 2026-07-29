<?php

namespace App\Services;

use App\Models\Plan;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

/**
 * B1 — Read layer for the plan system.
 *
 * Loads a plan's full feature set as a typed array, cached, with the
 * requesting user's overrides (user_plan_overrides) applied on top.
 * This is the *only* place plan_features gets read from — PlanGuard is the
 * only consumer, and controllers never touch Plan/PlanFeature directly.
 *
 * Sentinel: an int value of -1 means "unlimited". Callers must check for
 * this explicitly (see PlanGuard::isUnlimited()) rather than comparing
 * numerically, since -1 < anything would otherwise read as "always over
 * limit."
 */
class PlanService
{
    private const CACHE_TTL_SECONDS = 60;

    /**
     * Resolve the full, typed limit set for a user: plan defaults with any
     * active (non-expired) per-user overrides applied on top.
     *
     * @return array<string, int|bool|string>
     */
    public function limitsFor(User $user): array
    {
        $plan = $this->planFor($user);

        if ($plan === null) {
            // Fail closed: no plan resolvable. Caller (PlanGuard) treats an
            // empty limit set as "deny everything" rather than "allow
            // everything" — see PlanGuard::authorize().
            return [];
        }

        $limits = $this->cachedPlanFeatures($plan);

        foreach ($this->activeOverridesFor($user) as $override) {
            $limits[$override->feature_key] = $this->castOverrideValue(
                $override->override_value,
                $limits[$override->feature_key] ?? null
            );
        }

        return $limits;
    }

    public function limitFor(User $user, string $featureKey): int|bool|string|null
    {
        return $this->limitsFor($user)[$featureKey] ?? null;
    }

    /**
     * Resolve which Plan a user is on. Falls back to matching the legacy
     * subscription_tier column by plans.key if plan_id isn't set yet —
     * keeps existing users working during the Phase B4 migration window.
     */
    public function planFor(User $user): ?Plan
    {
        if ($user->plan_id !== null) {
            return Plan::query()->active()->find($user->plan_id);
        }

        if ($user->subscription_tier !== null) {
            return Plan::query()->active()->where('key', $user->subscription_tier)->first();
        }

        return Plan::query()->active()->where('key', 'free')->first();
    }

    /**
     * @return array<string, int|bool|string>
     */
    private function cachedPlanFeatures(Plan $plan): array
    {
        $cacheKey = "plan_features:{$plan->id}";

        return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($plan) {
            return $plan->features()
                ->get()
                ->mapWithKeys(fn ($feature) => [$feature->feature_key => $feature->castValue()])
                ->all();
        });
    }

    /**
     * @return \Illuminate\Support\Collection<int, \App\Models\UserPlanOverride>
     */
    private function activeOverridesFor(User $user): \Illuminate\Support\Collection
    {
        return $user->planOverrides()
            ->get()
            ->reject(fn ($override) => $override->isExpired());
    }

    private function castOverrideValue(string $rawValue, int|bool|string|null $likeValue): int|bool|string
    {
        return match (true) {
            is_int($likeValue) => (int) $rawValue,
            is_bool($likeValue) => filter_var($rawValue, FILTER_VALIDATE_BOOLEAN),
            default => $rawValue,
        };
    }

    /**
     * Call after any admin write to plan_features (Phase B5) so changes are
     * visible immediately instead of waiting out the TTL.
     */
    public function forgetPlan(int $planId): void
    {
        Cache::forget("plan_features:{$planId}");
    }
}
