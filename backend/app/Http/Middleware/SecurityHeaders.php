<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Adds security hardening headers to every response.
 *
 * Register in AppServiceProvider (already done) — no need to touch Kernel.php.
 */
class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Prevent browsers from MIME-sniffing a response away from the declared content-type
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        // Block clickjacking — only allow framing from same origin
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');

        // Enable XSS filter in older browsers
        $response->headers->set('X-XSS-Protection', '1; mode=block');

        // Referrer policy — don't leak full URL in Referer header to third parties
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');

        // Permissions policy — disable unused browser features
        $response->headers->set(
            'Permissions-Policy',
            'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
        );

        // HSTS — tell browsers to always use HTTPS for 1 year (production only)
        if (app()->environment('production')) {
            $response->headers->set(
                'Strict-Transport-Security',
                'max-age=31536000; includeSubDomains'
            );
        }

        // Content Security Policy
        // - Tightened: only allow scripts/styles from same origin and trusted CDNs
        // - 'unsafe-inline' for styles only (Monaco editor injects inline styles)
        // - No 'unsafe-eval' — prevents most XSS escalation
        // - frame-src allows sandbox preview iframes from the same domain only
        $csp = implode('; ', [
            "default-src 'self'",
            "script-src 'self' https://www.paypal.com https://www.sandbox.paypal.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://api.ubiq-editor.space wss://api.ubiq-editor.space https://api.anthropic.com https://www.paypal.com https://www.sandbox.paypal.com",
            // PayPal's subscription approval flow renders in an iframe/popup
            // served from paypal.com — needed for the Buttons widget to work.
            "frame-src 'self' https://www.paypal.com https://www.sandbox.paypal.com",
            "frame-ancestors 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ]);

        $response->headers->set('Content-Security-Policy', $csp);

        return $response;
    }
}