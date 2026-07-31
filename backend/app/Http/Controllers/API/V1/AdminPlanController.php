<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Plan;
use App\Models\PlanFeature;
use App\Services\PlanGuard;
use App\Services\PlanService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * B5 — Admin CRUD for plans/plan_features. This is what makes "manage it
 * over the database" actually true day-to-day — tuning a limit is a PUT
 * request from here on, not an SSH session + tinker.
 *
 * Auth: covered entirely by the route-level `admin` middleware (see
 * routes/api.php) — matches the existing convention in AdminController,
 * which doesn't re-check is_admin inside its own methods either.
 */
class AdminPlanController extends Controller
{
    public function __construct(private PlanService $planService)
    {
    }

    /** GET /admin/plans — every plan (active + inactive), features nested. */
    public function index()
    {
        return response()->json([
            'plans' => Plan::with('features')->orderBy('sort_order')->get(),
        ]);
    }

    /** GET /admin/plans/{plan} */
    public function show(Plan $plan)
    {
        return response()->json(['plan' => $plan->load('features')]);
    }

    /**
     * POST /admin/plans — create a new plan (e.g. a 5th tier later).
     * Optionally accepts an initial `features` array so a new plan can be
     * fully specified in one call instead of create-then-PUT-features.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'key'              => 'required|string|max:50|unique:plans,key|alpha_dash',
            'name'             => 'required|string|max:100',
            'price_cents'      => 'required|integer|min:0',
            'currency'         => 'sometimes|string|size:3',
            'billing_interval' => 'sometimes|in:month,year',
            'paypal_plan_id'   => 'nullable|string|max:191',
            'is_active'        => 'sometimes|boolean',
            'sort_order'       => 'sometimes|integer|min:0',
            'features'         => 'sometimes|array',
            'features.*.feature_key'   => 'required_with:features|string|max:100',
            'features.*.feature_value' => 'required_with:features|string',
            'features.*.value_type'    => 'required_with:features|in:int,bool,string',
        ]);

        $features = $validated['features'] ?? [];
        unset($validated['features']);

        $plan = Plan::create(array_merge([
            'currency' => 'USD',
            'billing_interval' => 'month',
            'is_active' => true,
            'sort_order' => (Plan::max('sort_order') ?? 0) + 1,
        ], $validated));

        foreach ($features as $feature) {
            $plan->features()->create($feature);
        }

        return response()->json(['plan' => $plan->load('features')], 201);
    }

    /** PUT /admin/plans/{plan} — core fields only, not features (see updateFeatures). */
    public function update(Request $request, Plan $plan)
    {
        $validated = $request->validate([
            'name'             => 'sometimes|string|max:100',
            'price_cents'      => 'sometimes|integer|min:0',
            'currency'         => 'sometimes|string|size:3',
            'billing_interval' => 'sometimes|in:month,year',
            'paypal_plan_id'   => 'nullable|string|max:191',
            'is_active'        => 'sometimes|boolean',
            'sort_order'       => 'sometimes|integer|min:0',
            // key intentionally not editable — PlanGuard/PlanSeeder and
            // every ACTIONS-adjacent lookup elsewhere match by key, so
            // renaming it here would silently break those without any
            // error at write time. Delete and recreate if a key genuinely
            // needs to change.
        ]);

        $plan->update($validated);
        $this->planService->forgetPlan($plan->id);

        return response()->json(['plan' => $plan->load('features')]);
    }

    /**
     * GET /admin/plans/{plan}/features
     */
    public function features(Plan $plan)
    {
        return response()->json(['features' => $plan->features]);
    }

    /**
     * PUT /admin/plans/{plan}/features — bulk upsert, matching how an admin
     * form would realistically save several limits at once. Body:
     *   { "features": [{"feature_key":"ai.requests_per_hour","feature_value":"50","value_type":"int"}, ...] }
     *
     * Soft-validates (warns, doesn't block) if sandbox.max_concurrent would
     * push the box past its known capacity ceiling — see the
     * SANDBOX_GLOBAL_CONCURRENT_LIMIT check below. An admin can still
     * override; this is guidance, not a hard business rule enforced
     * against itself.
     */
    public function updateFeatures(Request $request, Plan $plan)
    {
        $validated = $request->validate([
            'features'                 => 'required|array|min:1',
            'features.*.feature_key'   => 'required|string|max:100',
            'features.*.feature_value' => 'required|string',
            'features.*.value_type'    => 'required|in:int,bool,string',
        ]);

        $warnings = [];

        foreach ($validated['features'] as $feature) {
            if ($feature['feature_key'] === 'sandbox.max_concurrent') {
                $globalCeiling = (int) env('SANDBOX_GLOBAL_CONCURRENT_LIMIT', 3);
                if ((int) $feature['feature_value'] > $globalCeiling) {
                    $warnings[] = "sandbox.max_concurrent={$feature['feature_value']} exceeds the box's global ceiling ({$globalCeiling}, from SANDBOX_GLOBAL_CONCURRENT_LIMIT). PlanGuard's global check still applies regardless of this per-plan value — saved anyway, but a single user on this plan alone could never actually use this many concurrently.";
                }
            }

            PlanFeature::query()->updateOrCreate(
                ['plan_id' => $plan->id, 'feature_key' => $feature['feature_key']],
                ['feature_value' => $feature['feature_value'], 'value_type' => $feature['value_type']]
            );
        }

        // Immediate visibility instead of waiting out PlanService's 60s
        // cache TTL — this is exactly what forgetPlan() exists for.
        $this->planService->forgetPlan($plan->id);

        return response()->json([
            'plan' => $plan->load('features'),
            'warnings' => $warnings,
        ]);
    }

    /** DELETE /admin/plans/{plan}/features/{featureKey} */
    public function destroyFeature(Plan $plan, string $featureKey)
    {
        $deleted = $plan->features()->where('feature_key', $featureKey)->delete();
        $this->planService->forgetPlan($plan->id);

        return response()->json([
            'deleted' => (bool) $deleted,
        ]);
    }
}
