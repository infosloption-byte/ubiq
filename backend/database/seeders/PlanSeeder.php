<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Phase A5 — Seed the 4 plans + their features.
 *
 * Safe to re-run: plans are upserted by `key`, features by
 * (plan_id, feature_key). Re-running this after tweaking the numbers below
 * updates existing rows rather than duplicating them.
 *
 * Sentinel convention: -1 means "unlimited" for numeric limits.
 *
 * Numbers here come from the cost/capacity analysis done alongside
 * PLAN_SYSTEM_TASKS.md — treat them as the initial launch defaults, not
 * permanent. Once real usage data exists (60-day revisit), edit rows
 * directly via the Phase B5 admin endpoints — no migration/redeploy needed.
 */
class PlanSeeder extends Seeder
{
    public function run(): void
    {
        $plans = [
            [
                'key' => 'free',
                'name' => 'Free',
                'price_cents' => 0,
                'sort_order' => 1,
                'features' => [
                    'sandbox.max_concurrent' => ['1', 'int'],
                    'sandbox.cpu' => ['0.5', 'string'],
                    'sandbox.memory_mb' => ['512', 'int'],
                    'sandbox.idle_timeout_minutes' => ['20', 'int'],
                    'ai.requests_per_hour' => ['15', 'int'],
                    'ai.requests_per_day' => ['50', 'int'],
                    'ai.max_model_tier' => ['free', 'string'],
                    'projects.max_count' => ['3', 'int'],
                    'sharing.enabled' => ['false', 'bool'],
                    'storage.max_mb' => ['512', 'int'],
                ],
            ],
            [
                'key' => 'starter',
                'name' => 'Starter',
                'price_cents' => 500,
                'sort_order' => 2,
                'features' => [
                    'sandbox.max_concurrent' => ['1', 'int'],
                    'sandbox.cpu' => ['0.75', 'string'],
                    'sandbox.memory_mb' => ['512', 'int'],
                    'sandbox.idle_timeout_minutes' => ['45', 'int'],
                    'ai.requests_per_hour' => ['40', 'int'],
                    'ai.requests_per_day' => ['200', 'int'],
                    'ai.max_model_tier' => ['starter', 'string'],
                    'projects.max_count' => ['10', 'int'],
                    'sharing.enabled' => ['false', 'bool'],
                    'storage.max_mb' => ['1024', 'int'],
                ],
            ],
            [
                'key' => 'creator',
                'name' => 'Creator',
                'price_cents' => 1200,
                'sort_order' => 3,
                'features' => [
                    'sandbox.max_concurrent' => ['1', 'int'],
                    'sandbox.cpu' => ['0.75', 'string'],
                    'sandbox.memory_mb' => ['1024', 'int'],
                    'sandbox.idle_timeout_minutes' => ['90', 'int'],
                    'ai.requests_per_hour' => ['100', 'int'],
                    'ai.requests_per_day' => ['600', 'int'],
                    'ai.max_model_tier' => ['creator', 'string'],
                    'projects.max_count' => ['30', 'int'],
                    'sharing.enabled' => ['true', 'bool'],
                    'storage.max_mb' => ['5120', 'int'],
                ],
            ],
            [
                'key' => 'pro',
                'name' => 'Pro',
                'price_cents' => 2200,
                'sort_order' => 4,
                'features' => [
                    'sandbox.max_concurrent' => ['2', 'int'],
                    'sandbox.cpu' => ['1.0', 'string'],
                    'sandbox.memory_mb' => ['1536', 'int'],
                    'sandbox.idle_timeout_minutes' => ['180', 'int'],
                    'ai.requests_per_hour' => ['250', 'int'],
                    'ai.requests_per_day' => ['1500', 'int'],
                    'ai.max_model_tier' => ['pro', 'string'],
                    'projects.max_count' => ['-1', 'int'],
                    'sharing.enabled' => ['true', 'bool'],
                    'storage.max_mb' => ['10240', 'int'],
                ],
            ],
        ];

        foreach ($plans as $plan) {
            $features = $plan['features'];
            unset($plan['features']);

            $planId = DB::table('plans')->updateOrInsert(
                ['key' => $plan['key']],
                array_merge($plan, [
                    'currency' => 'USD',
                    'billing_interval' => 'month',
                    'is_active' => true,
                    'updated_at' => now(),
                    'created_at' => now(),
                ])
            );

            $planId = DB::table('plans')->where('key', $plan['key'])->value('id');

            foreach ($features as $key => [$value, $type]) {
                DB::table('plan_features')->updateOrInsert(
                    ['plan_id' => $planId, 'feature_key' => $key],
                    [
                        'feature_value' => $value,
                        'value_type' => $type,
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );
            }
        }
    }
}
