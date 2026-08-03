<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * URGENT — site_visits was also never actually migrated, same bug
 * pattern as sandbox_runs (see that migration's docblock). Confirmed via
 * grep: zero migrations, zero mentions in schema.sql. This was
 * spamming production logs with QueryExceptions on every single
 * unauthenticated page visit (UsageController::recordVisit is on the
 * fully-public route list) — a real, ongoing cost of noise in Sentry
 * even though it fails silently to the end user (recordVisit's own
 * exception isn't caught, but nothing in the frontend surfaces it since
 * it's a fire-and-forget analytics call).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('site_visits', function (Blueprint $table) {
            $table->id();
            $table->string('ip_address');
            $table->string('user_agent')->nullable();
            $table->string('referer')->nullable();
            $table->timestamps();

            $table->index(['ip_address', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('site_visits');
    }
};
