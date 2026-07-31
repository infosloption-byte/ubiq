<?php
namespace App\Http\Middleware;

use App\Services\PlanService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckSubscription
{
    public function __construct(private PlanService $planService)
    {
    }

    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // 1. No user logged in — let auth middleware handle it
        if (!$user) {
            return $next($request);
        }

        // 2. Admin bypass
        if ($user->is_admin) {
            return $next($request);
        }

        // 3. B4 — this used to require tier==='pro' && status==='active'
        // for EVERY route it guards, which meant Free/Starter/Creator
        // users were completely blocked with a 402 before ever reaching
        // PlanGuard's actual per-tier enforcement. PlanGuard (not this
        // middleware) is now the source of truth for what each tier can
        // do — this middleware's only remaining job is real billing
        // enforcement for users who WERE on a paid plan and have
        // genuinely lapsed.
        //
        // Starter/Creator currently have no PayPal plan wired up yet
        // (Phase C4) — nobody can become Starter/Creator except via a
        // manual admin/tinker change, so there's no billing state to
        // enforce for them yet. Only Pro has a real subscription lifecycle
        // right now, so only Pro gets checked below.
        $plan = $this->planService->planFor($user);

        if ($plan === null || $plan->key !== 'pro') {
            return $next($request);
        }

        $status = $user->subscription_status;

        // Active paid plan
        if ($status === 'active') {
            if (is_null($user->subscription_ends_at) || now()->lt($user->subscription_ends_at)) {
                return $next($request);
            }
        }

        // Active trial
        if ($status === 'trialing') {
            if ($user->trial_ends_at && now()->lt($user->trial_ends_at)) {
                return $next($request);
            }
        }

        // 4. Blocked — Pro specifically, not subscribed or expired
        return response()->json([
            'error'   => 'Subscription Required',
            'message' => 'Your Pro subscription has expired. Please renew to continue using Pro features.',
            'status'  => 'inactive',
            'action'  => 'payment_required'
        ], 402);
    }
}
