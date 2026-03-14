<?php

// ============================================================
// File: app/Listeners/PaddleWebhookListener.php
// ============================================================

namespace App\Listeners;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Laravel\Paddle\Events\WebhookReceived;

class PaddleWebhookListener
{
    public function handle(WebhookReceived $event): void
    {
        $payload    = $event->payload;
        $eventType  = $payload['event_type'] ?? null;
        $data       = $payload['data']        ?? [];
        $customData = $data['custom_data']    ?? [];

        Log::info("[Paddle] Webhook received: {$eventType}");

        $userId     = $customData['user_id'] ?? null;
        $customerId = $data['customer_id']   ?? null;

        // ── Step 1: Link paddle_id on first contact ───────────────────────────
        if ($userId && $customerId) {
            $affected = DB::table('users')
                ->where('id', $userId)
                ->whereNull('paddle_id')
                ->update(['paddle_id' => $customerId, 'updated_at' => now()]);

            if ($affected) {
                Log::info("[Paddle] Linked paddle_id={$customerId} to user_id={$userId}");
            }
        }

        // ── Step 2: Handle subscription events ───────────────────────────────
        if (!in_array($eventType, [
            'subscription.created',
            'subscription.updated',
            'subscription.activated',
            'subscription.canceled',
            'subscription.expired',  // Fired when grace period ends after cancellation
            'subscription.past_due',
            'subscription.paused',
        ])) {
            return; // Ignore non-subscription events (transaction.created etc.)
        }

        $rawStatus = $data['status'] ?? 'active';

        // Map Paddle status to your app's status
        // 'trialing' = on trial (charged after trial ends)
        // 'active'   = paying subscriber
        $newStatus = $rawStatus; // trialing, active, canceled, past_due, paused

        // Tier: pro for any paying/trialing state, free when canceled or expired
        $newTier = in_array($newStatus, ['active', 'past_due', 'trialing'])
            ? 'pro'
            : 'free';

        // ── Trial end date ────────────────────────────────────────────────────
        // Paddle sends next_billed_at = when trial ends / when they get charged
        $trialEndsAt = null;
        if ($newStatus === 'trialing' && !empty($data['next_billed_at'])) {
            $trialEndsAt = \Carbon\Carbon::parse($data['next_billed_at'])->format('Y-m-d H:i:s');
        }

        // ── Subscription end date (current billing period end) ────────────────
        // current_billing_period.ends_at = end of current paid period
        $subscriptionEndsAt = null;
        if (!empty($data['current_billing_period']['ends_at'])) {
            $subscriptionEndsAt = \Carbon\Carbon::parse($data['current_billing_period']['ends_at'])->format('Y-m-d H:i:s');
        } elseif (!empty($data['next_billed_at'])) {
            $subscriptionEndsAt = \Carbon\Carbon::parse($data['next_billed_at'])->format('Y-m-d H:i:s');
        }

        Log::info("[Paddle] Resolving update", [
            'event'               => $eventType,
            'status'              => $newStatus,
            'tier'                => $newTier,
            'trial_ends_at'       => $trialEndsAt,
            'subscription_ends_at'=> $subscriptionEndsAt,
            'customer_id'         => $customerId,
            'user_id'             => $userId,
        ]);

        // ── Find user ─────────────────────────────────────────────────────────
        $query = null;
        if ($customerId) {
            $count = DB::table('users')->where('paddle_id', $customerId)->count();
            if ($count > 0) {
                $query = DB::table('users')->where('paddle_id', $customerId);
            }
        }
        if (!$query && $userId) {
            $query = DB::table('users')->where('id', $userId);
        }

        if (!$query) {
            Log::warning("[Paddle] Could not identify user. customer_id={$customerId}, user_id={$userId}");
            return;
        }

        // ── Write to DB — raw query bypasses $fillable, save(), and all model events ──
        $updateData = [
            'subscription_status' => $newStatus,
            'subscription_tier'   => $newTier,
            'updated_at'          => now(),
        ];

        if ($trialEndsAt) {
            $updateData['trial_ends_at'] = $trialEndsAt;
        }

        if ($subscriptionEndsAt) {
            $updateData['subscription_ends_at'] = $subscriptionEndsAt;
        }

        // Also stamp paddle_id in case Step 1 didn't catch it (e.g. no customData)
        if ($customerId && $userId) {
            $updateData['paddle_id'] = $customerId;
        }

        $affected = $query->update($updateData);

        if ($affected) {
            Log::info("[Paddle] ✅ DB updated → status={$newStatus}, tier={$newTier}, trial_ends_at={$trialEndsAt} ({$affected} row)");
        } else {
            Log::warning("[Paddle] ⚠️ No rows updated. customer_id={$customerId}, user_id={$userId}");
        }
    }
}