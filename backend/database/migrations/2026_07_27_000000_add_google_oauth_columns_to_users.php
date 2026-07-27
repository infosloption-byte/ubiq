<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add missing Google OAuth columns to users.
 *
 * `google_id` and `avatar` are declared in User::$fillable and used throughout
 * AuthController::handleGoogleCallback() to store the Google account's ID and
 * profile picture, but no migration ever created these columns — the same
 * class of bug as the `paddle_id` issue fixed in the PayPal migration. As a
 * result, every Google sign-in/sign-up attempt has failed in production with:
 *   SQLSTATE[42S22]: Column not found: 1054 Unknown column 'google_id' in 'field list'
 *
 * This adds:
 *   - google_id : Google account's unique subject ID (sub claim)
 *   - avatar    : Google profile picture URL
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'google_id')) {
                $table->string('google_id')->nullable()->unique()->after('password');
            }
            if (!Schema::hasColumn('users', 'avatar')) {
                $table->string('avatar')->nullable()->after('google_id');
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['google_id', 'avatar']);
        });
    }
};
