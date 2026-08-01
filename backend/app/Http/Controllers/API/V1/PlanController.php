<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\Plan;

/**
 * C3 — Public pricing page data. Deliberately a SEPARATE controller from
 * AdminPlanController rather than an extra method there — this route has
 * no auth middleware at all, and keeping it out of the Admin* namespace
 * avoids a future reader assuming every method in that file is
 * admin-gated. If admin-only concerns (create/edit/delete) ever need to
 * share logic with this, extract a shared query into PlanService instead
 * of merging the controllers.
 */
class PlanController extends Controller
{
    /** GET /plans — active plans only, ordered for display. */
    public function index()
    {
        return response()->json([
            'plans' => Plan::with('features')
                ->where('is_active', true)
                ->orderBy('sort_order')
                ->get(),
        ]);
    }
}
