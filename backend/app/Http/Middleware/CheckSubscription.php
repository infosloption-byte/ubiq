<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckSubscription
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        // 1. Safety check: If no user is logged in, skip this logic
        if (!$user) {
            return $next($request);
        }

        // 2. Admin Bypass
        if ($user->is_admin) {
            return $next($request);
        }

        /**
         * 3. The Paddle Access Check
         * * subscribed('default'): Checks if the user has an active, non-expired subscription.
         * onTrial(): Checks if the user is currently within their trial period.
         * * Cashier automatically handles the "grace period" (canceled but not yet expired).
         */
        if ($user->subscribed('default') || $user->onTrial()) {
            return $next($request);
        }

        // 4. Blocking Logic for API/React
        // If the code reaches here, the user is neither subscribed nor on a trial.
        return response()->json([
            'error' => 'Subscription Required',
            'message' => 'Your access has expired. Please subscribe to a Pro plan to continue using Ubiq AI features and projects.',
            'status' => 'inactive',
            'action' => 'payment_required'
        ], 402); 
    }
}