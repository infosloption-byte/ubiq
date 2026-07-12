<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Services\PayPalService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class PayPalController extends Controller
{
    public function __construct(protected PayPalService $paypal) {}

    /**
     * Called by the frontend right after the PayPal Buttons onApprove()
     * fires with a subscriptionID. We re-verify against PayPal's own API
     * rather than trusting the frontend's data directly — the webhook will
     * also confirm/correct this asynchronously, but this gives an instant
     * UI update without waiting for the webhook round-trip.
     */
    public function confirm(Request $request)
    {
        $request->validate([
            'subscription_id' => 'required|string',
        ]);

        $user = $request->user();
        $subscriptionId = $request->input('subscription_id');

        $subscription = $this->paypal->getSubscription($subscriptionId);

        if (!$subscription) {
            return response()->json(['error' => 'Could not verify subscription with PayPal.'], 422);
        }

        // Confirm this subscription is actually for the expected plan.
        if ($subscription['plan_id'] !== config('services.paypal.plan_id')) {
            Log::warning('[PayPal] Plan ID mismatch on confirm', [
                'expected' => config('services.paypal.plan_id'),
                'got'      => $subscription['plan_id'] ?? null,
                'user_id'  => $user->id,
            ]);
            return response()->json(['error' => 'Subscription plan mismatch.'], 422);
        }

        $this->applySubscriptionState($user, $subscriptionId, $subscription);

        return response()->json(['user' => $user->fresh()]);
    }

    /**
     * User-initiated cancellation from the Settings page.
     * PayPal cancels immediately — there's no built-in "cancel at period end"
     * like Paddle. We keep subscription_tier = pro until subscription_ends_at
     * (the current period's end) to give the same "access until period end"
     * experience, then a scheduled task / next login check should downgrade
     * once subscription_ends_at has passed.
     */
    public function cancel(Request $request)
    {
        $user = $request->user();

        if (!$user->paypal_subscription_id) {
            return response()->json(['error' => 'No active subscription found.'], 404);
        }

        $success = $this->paypal->cancelSubscription($user->paypal_subscription_id);

        if (!$success) {
            return response()->json(['error' => 'Failed to cancel subscription with PayPal. Please contact support.'], 502);
        }

        $user->update([
            'subscription_status' => 'canceled',
            // subscription_ends_at already holds the current period end from
            // the last webhook/confirm sync — leave it as-is so Pro access
            // continues until then, matching the Paddle-era UX.
        ]);

        return response()->json(['user' => $user->fresh()]);
    }

    public function status(Request $request)
    {
        return response()->json(['user' => $request->user()]);
    }

    /**
     * PayPal webhook endpoint — public, signature-verified.
     * Configure this URL (https://api.ubiq-editor.space/api/v1/paypal/webhook)
     * in the PayPal Developer Dashboard under your app's Webhooks section,
     * subscribed to the BILLING.SUBSCRIPTION.* and PAYMENT.SALE.* events.
     */
    public function webhook(Request $request)
    {
        $body = $request->all();

        $verified = $this->paypal->verifyWebhookSignature($request->headers->all(), $body);

        if (!$verified) {
            Log::warning('[PayPal] Rejected webhook with invalid signature.');
            return response()->json(['error' => 'Invalid signature'], 400);
        }

        $eventType = $body['event_type'] ?? null;
        $resource  = $body['resource']   ?? [];

        Log::info("[PayPal] Webhook received: {$eventType}");

        $relevantEvents = [
            'BILLING.SUBSCRIPTION.ACTIVATED',
            'BILLING.SUBSCRIPTION.UPDATED',
            'BILLING.SUBSCRIPTION.CANCELLED',
            'BILLING.SUBSCRIPTION.SUSPENDED',
            'BILLING.SUBSCRIPTION.EXPIRED',
            'PAYMENT.SALE.COMPLETED',   // renewal payment succeeded
            'PAYMENT.SALE.DENIED',      // renewal payment failed
        ];

        if (!in_array($eventType, $relevantEvents)) {
            return response()->json(['status' => 'ignored']);
        }

        // For subscription-level events, resource IS the subscription object.
        // For payment events, resource is a sale/payment — the subscription
        // ID lives at resource.billing_agreement_id.
        $subscriptionId = $resource['id'] ?? $resource['billing_agreement_id'] ?? null;

        if (!$subscriptionId) {
            Log::warning('[PayPal] Webhook missing subscription id', ['event' => $eventType]);
            return response()->json(['status' => 'no_subscription_id']);
        }

        $user = DB::table('users')->where('paypal_subscription_id', $subscriptionId)->first();

        if (!$user) {
            Log::warning("[PayPal] No user found for subscription_id={$subscriptionId}");
            return response()->json(['status' => 'user_not_found']);
        }

        // Re-fetch the authoritative subscription state rather than trusting
        // the webhook payload's partial view of it.
        $subscription = $this->paypal->getSubscription($subscriptionId);

        if ($subscription) {
            $userModel = \App\Models\User::find($user->id);
            $this->applySubscriptionState($userModel, $subscriptionId, $subscription);
        }

        return response()->json(['status' => 'ok']);
    }

    /**
     * Single source of truth for writing PayPal subscription state onto a user.
     * Used by both the synchronous confirm() call and the webhook handler.
     */
    protected function applySubscriptionState($user, string $subscriptionId, array $subscription): void
    {
        $status = $subscription['status'] ?? 'APPROVAL_PENDING'; // ACTIVE, SUSPENDED, CANCELLED, EXPIRED, APPROVAL_PENDING, APPROVED

        // Map PayPal's status vocabulary to the app's existing status column.
        $statusMap = [
            'ACTIVE'           => 'active',
            'APPROVED'         => 'active',
            'APPROVAL_PENDING' => 'pending',
            'SUSPENDED'        => 'past_due', // failed renewal payment, PayPal auto-retries
            'CANCELLED'        => 'canceled',
            'EXPIRED'          => 'expired',
        ];
        $newStatus = $statusMap[$status] ?? 'free';

        // Grace period same as before: pro while active, past_due (payment retrying)
        $newTier = in_array($newStatus, ['active', 'past_due']) ? 'pro' : 'free';

        $subscriptionEndsAt = null;
        if (!empty($subscription['billing_info']['next_billing_time'])) {
            $subscriptionEndsAt = Carbon::parse($subscription['billing_info']['next_billing_time']);
        } elseif (!empty($subscription['billing_info']['final_payment_time'])) {
            $subscriptionEndsAt = Carbon::parse($subscription['billing_info']['final_payment_time']);
        }

        $user->update([
            'paypal_subscription_id' => $subscriptionId,
            'subscription_status'    => $newStatus,
            'subscription_tier'      => $newTier,
            'subscription_ends_at'   => $subscriptionEndsAt,
        ]);

        Log::info("[PayPal] User {$user->id} updated → status={$newStatus}, tier={$newTier}");
    }
}