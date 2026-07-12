<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Thin wrapper around PayPal's REST API (Subscriptions + Webhooks).
 * No SDK dependency — plain HTTP calls via Laravel's Http client, same
 * philosophy as calling any other REST API.
 *
 * Docs:
 *   Subscriptions: https://developer.paypal.com/docs/api/subscriptions/v1/
 *   Webhooks:      https://developer.paypal.com/docs/api/webhooks/v1/
 */
class PayPalService
{
    protected string $baseUrl;

    public function __construct()
    {
        $this->baseUrl = config('services.paypal.mode') === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
    }

    /**
     * Get an OAuth2 access token, cached for its lifetime (minus a safety margin).
     */
    public function getAccessToken(): string
    {
        return Cache::remember('paypal_access_token', 8 * 60, function () {
            $response = Http::asForm()
                ->withBasicAuth(
                    config('services.paypal.client_id'),
                    config('services.paypal.client_secret')
                )
                ->post("{$this->baseUrl}/v1/oauth2/token", [
                    'grant_type' => 'client_credentials',
                ]);

            if (!$response->successful()) {
                Log::error('[PayPal] Failed to obtain access token', ['body' => $response->body()]);
                throw new \RuntimeException('Unable to authenticate with PayPal.');
            }

            $data = $response->json();

            // Cache slightly shorter than the actual expiry (usually 32400s / 9h)
            return $data['access_token'];
        });
    }

    protected function authedRequest()
    {
        return Http::withToken($this->getAccessToken())
            ->acceptJson()
            ->contentType('application/json');
    }

    /**
     * Fetch full subscription details from PayPal — used to verify a
     * subscription really exists and is active right after checkout approval,
     * rather than trusting the frontend blindly.
     */
    public function getSubscription(string $subscriptionId): ?array
    {
        $response = $this->authedRequest()
            ->get("{$this->baseUrl}/v1/billing/subscriptions/{$subscriptionId}");

        if (!$response->successful()) {
            Log::warning('[PayPal] getSubscription failed', [
                'subscription_id' => $subscriptionId,
                'status'           => $response->status(),
                'body'             => $response->body(),
            ]);
            return null;
        }

        return $response->json();
    }

    /**
     * Cancel a subscription. PayPal cancels immediately (no "at period end"
     * option like Paddle) — access is revoked via subscription_ends_at logic
     * in the app instead, using the current billing cycle's end date.
     */
    public function cancelSubscription(string $subscriptionId, string $reason = 'User requested cancellation'): bool
    {
        $response = $this->authedRequest()
            ->post("{$this->baseUrl}/v1/billing/subscriptions/{$subscriptionId}/cancel", [
                'reason' => $reason,
            ]);

        // PayPal returns 204 No Content on success
        if (!$response->successful()) {
            Log::error('[PayPal] cancelSubscription failed', [
                'subscription_id' => $subscriptionId,
                'status'           => $response->status(),
                'body'             => $response->body(),
            ]);
            return false;
        }

        return true;
    }

    /**
     * Verify an incoming webhook's signature against PayPal's
     * verify-webhook-signature endpoint. Always do this before trusting
     * webhook payload data — anyone can POST to a public URL otherwise.
     */
    public function verifyWebhookSignature(array $headers, array $body): bool
    {
        $webhookId = config('services.paypal.webhook_id');

        if (!$webhookId) {
            Log::error('[PayPal] PAYPAL_WEBHOOK_ID not configured — refusing to trust webhook.');
            return false;
        }

        $payload = [
            'transmission_id'   => $headers['paypal-transmission-id']   ?? null,
            'transmission_time' => $headers['paypal-transmission-time'] ?? null,
            'cert_url'          => $headers['paypal-cert-url']          ?? null,
            'auth_algo'         => $headers['paypal-auth-algo']         ?? null,
            'transmission_sig'  => $headers['paypal-transmission-sig']  ?? null,
            'webhook_id'        => $webhookId,
            'webhook_event'     => $body,
        ];

        $response = $this->authedRequest()
            ->post("{$this->baseUrl}/v1/notifications/verify-webhook-signature", $payload);

        if (!$response->successful()) {
            Log::error('[PayPal] Webhook verification request failed', ['body' => $response->body()]);
            return false;
        }

        $status = $response->json('verification_status');

        if ($status !== 'SUCCESS') {
            Log::warning('[PayPal] Webhook signature verification FAILED', ['status' => $status]);
        }

        return $status === 'SUCCESS';
    }
}