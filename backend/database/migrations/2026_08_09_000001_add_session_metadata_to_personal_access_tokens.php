<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * E3b (PLAN_SYSTEM_TASKS.md Phase E) — Active Sessions.
 *
 * Sanctum's stock personal_access_tokens table has no device or location
 * columns at all — only name/abilities/last_used_at/expires_at. This adds
 * exactly what's needed to show "device, location, created, updated" per
 * session: raw user_agent (device is parsed from this on the fly when
 * listing sessions, not stored pre-parsed, so a future parsing improvement
 * doesn't require a backfill), ip_address, and city/region/country from a
 * best-effort geolocation lookup done once at token-creation time (see
 * AuthController::createTokenWithMetadata()).
 *
 * All nullable: every column here is best-effort. A lookup failure/timeout,
 * a local/private IP during development, or a token created before this
 * migration ran should all just show as "Unknown" in the UI, never break
 * anything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->string('user_agent')->nullable()->after('abilities');
            $table->string('ip_address', 45)->nullable()->after('user_agent'); // 45 = max IPv6 length
            $table->string('city')->nullable()->after('ip_address');
            $table->string('region')->nullable()->after('city');
            $table->string('country')->nullable()->after('region');
        });
    }

    public function down(): void
    {
        Schema::table('personal_access_tokens', function (Blueprint $table) {
            $table->dropColumn(['user_agent', 'ip_address', 'city', 'region', 'country']);
        });
    }
};
