<?php
namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckSubscription
{
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

        // 3. Check custom subscription columns (Cashier's subscribed()/onTrial()
        //    are NOT used — subscriptions table is empty, we manage state ourselves)
        $status = $user->subscription_status;
        $tier   = $user->subscription_tier;

        // Active paid plan
        if ($tier === 'pro' && $status === 'active') {
            // Check subscription hasn't expired (null means ongoing/no expiry set)
            if (is_null($user->subscription_ends_at) || now()->lt($user->subscription_ends_at)) {
                return $next($request);
            }
        }

        // Active trial
        if ($status === 'trialing') {
            // Check trial hasn't expired
            if ($user->trial_ends_at && now()->lt($user->trial_ends_at)) {
                return $next($request);
            }
        }

        // 4. Blocked — not subscribed or expired
        return response()->json([
            'error'   => 'Subscription Required',
            'message' => 'Your access has expired. Please subscribe to a Pro plan to continue using Ubiq AI features and projects.',
            'status'  => 'inactive',
            'action'  => 'payment_required'
        ], 402);
    }
}