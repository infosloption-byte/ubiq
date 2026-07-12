<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Sanctum configuration for API authentication
        $middleware->api(prepend: [
            \Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful::class,
        ]);

        // Middleware aliases
        $middleware->alias([
            'verified' => \App\Http\Middleware\EnsureEmailIsVerified::class,
            'rate.limit' => \App\Http\Middleware\RateLimitMiddleware::class,
            'admin' => \App\Http\Middleware\AdminMiddleware::class,
            'subscribed' => \App\Http\Middleware\CheckSubscription::class,
        ]);

        // CORS configuration for API
        $middleware->validateCsrfTokens(except: [
            'api/*',
            'api/v1/paypal/webhook', // Explicitly excluded for clarity
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        // Report all unhandled exceptions to Sentry.
        // Excludes validation errors and 404s which are not actionable.
        $exceptions->reportable(function (\Throwable $e) {
            if (app()->bound('sentry') && $e instanceof \Exception) {
                \Sentry\captureException($e);
            }
        });
    })->create();