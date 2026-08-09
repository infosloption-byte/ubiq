<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * E3b (PLAN_SYSTEM_TASKS.md Phase E) — best-effort IP → city/region/country
 * lookup for the Active Sessions feature. Uses ip-api.com's free tier (no
 * API key required for non-commercial use, ~45 requests/minute limit —
 * fine here since this only runs once per login/token creation, not per
 * page load).
 *
 * IMPORTANT — this specific HTTP call could not be executed from the
 * sandbox this was written in (ip-api.com isn't on that environment's
 * allowed-domains list for outbound requests). The code below is written
 * and reasoned through carefully, but needs an actual smoke test against
 * a real IP once deployed — see PLAN_SYSTEM_TASKS.md's decision log for
 * this task.
 *
 * Every failure mode here — timeout, non-200, malformed response, private/
 * local IP — returns nulls rather than throwing. A geolocation lookup
 * failing must never block or slow down login meaningfully; the caller
 * (AuthController::createTokenWithMetadata) always has the raw IP address
 * itself to fall back to even when this returns nothing.
 */
class IpGeolocationService
{
    /**
     * @return array{city: ?string, region: ?string, country: ?string}
     */
    public function lookup(?string $ip): array
    {
        $empty = ['city' => null, 'region' => null, 'country' => null];

        if (!$ip || $this->isPrivateOrLocal($ip)) {
            // Nothing meaningful to resolve for localhost/LAN addresses —
            // this is the common case during local development, and
            // skipping it outright avoids a pointless network call on
            // every dev-machine login.
            return $empty;
        }

        try {
            $response = Http::timeout(2)->get("http://ip-api.com/json/{$ip}", [
                'fields' => 'status,city,regionName,country',
            ]);

            if (!$response->successful()) {
                return $empty;
            }

            $data = $response->json();
            if (($data['status'] ?? null) !== 'success') {
                return $empty;
            }

            return [
                'city' => $data['city'] ?? null,
                'region' => $data['regionName'] ?? null,
                'country' => $data['country'] ?? null,
            ];
        } catch (\Throwable $e) {
            // Network error, timeout, DNS failure, whatever — log it for
            // visibility but never let a geolocation lookup break login.
            Log::warning('IpGeolocationService lookup failed', ['ip' => $ip, 'error' => $e->getMessage()]);
            return $empty;
        }
    }

    private function isPrivateOrLocal(string $ip): bool
    {
        return $ip === '127.0.0.1'
            || $ip === '::1'
            || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
    }
}
