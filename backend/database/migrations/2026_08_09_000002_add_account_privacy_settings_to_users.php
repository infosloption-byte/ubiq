<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

/**
 * Phase E follow-up (E5 / E4 — see PLAN_SYSTEM_TASKS.md):
 *
 * - `password_set_at`: distinguishes a *real, user-chosen* password from
 *   the random throwaway one every Google OAuth signup gets
 *   (`Hash::make(Str::random(24))` in AuthController::handleGoogleCallback).
 *   Null means "this account has no password the user actually knows" —
 *   used to decide whether Settings shows "Change Password" or
 *   "Set a Password" (E5 decision, 2026-08-08). Deliberately NOT in
 *   User::$fillable — only ever set programmatically by
 *   register()/changePassword(), never from raw request input.
 *
 * - `default_project_visibility`: E4 Privacy tab setting. Used as the
 *   fallback in ProjectController::store() when a project is created
 *   without an explicit `visibility` param, instead of the previous
 *   hardcoded 'private'.
 *
 * Backfill: existing email/password accounts (no google_id) are assumed
 * to have deliberately set a password at signup — backfilled to
 * created_at. Existing Google-only accounts (google_id set) are left
 * null, matching the "no password the user actually knows" definition
 * above; they'll see "Set a Password" until they choose one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'password_set_at')) {
                $table->timestamp('password_set_at')->nullable()->after('password');
            }
            if (!Schema::hasColumn('users', 'default_project_visibility')) {
                $table->enum('default_project_visibility', ['private', 'public'])
                    ->default('private')
                    ->after('avatar');
            }
        });

        DB::table('users')
            ->whereNull('google_id')
            ->whereNull('password_set_at')
            ->update(['password_set_at' => DB::raw('created_at')]);
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['password_set_at', 'default_project_visibility']);
        });
    }
};
