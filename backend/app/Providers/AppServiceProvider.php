<?php

// ============================================================
// File: app/Providers/AppServiceProvider.php
// ============================================================
// Register the Paddle webhook listener here.
// In Laravel 11, EventServiceProvider is merged into here.
// ============================================================

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
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
        // Register Paddle webhook listener
        Event::listen(
            WebhookReceived::class,
            PaddleWebhookListener::class
        );
    }
}