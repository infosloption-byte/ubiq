<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Event;
use Laravel\Paddle\Events\WebhookReceived;
use App\Listeners\PaddleWebhookListener;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        // ── Default string length for older MySQL ──────────────────────────
        Schema::defaultStringLength(191);

        // ── Paddle Webhook Listener ────────────────────────────────────────
        // Handles subscription upgrades, cancellations, payment events, etc.
        // Removing this means Paddle events fire but nothing acts on them —
        // subscriptions will never update in your DB.
        Event::listen(
            WebhookReceived::class,
            PaddleWebhookListener::class
        );

        // ── Force HTTPS in production ──────────────────────────────────────
        // Ensures all generated URLs (signed preview URLs, Paddle redirects,
        // password reset links) always use https:// — never http://.
        if ($this->app->environment('production')) {
            URL::forceScheme('https');

            // Trust the load balancer / nginx proxy's X-Forwarded-Proto header
            // so Laravel knows requests arriving via HTTPS are actually HTTPS.
            $this->app['request']->server->set('HTTPS', 'on');
        }

        // ── Security Headers middleware ────────────────────────────────────
        // Adds hardening headers to every response. Applied globally so nothing
        // can accidentally skip them.
        $this->app['router']->pushMiddlewareToGroup('api',
            \App\Http\Middleware\SecurityHeaders::class
        );
        $this->app['router']->pushMiddlewareToGroup('web',
            \App\Http\Middleware\SecurityHeaders::class
        );

        // Attach authenticated user context to every Sentry event.
        // This lets you search errors by user ID or email in the dashboard.
        if (app()->bound('sentry')) {
            \Sentry\configureScope(function (\Sentry\State\Scope $scope): void {
                if ($user = auth()->user()) {
                    $scope->setUser([
                        'id'       => $user->id,
                        'email'    => $user->email,
                        'username' => $user->username,
                    ]);
                }
            });
        }
    }
}