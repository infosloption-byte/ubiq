<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * G2b (PLAN_SYSTEM_TASKS.md Phase G): persists which
 * `BoilerplateManager` template key a project was actually scaffolded
 * with, so it's a stored fact rather than something re-derived from
 * the user's prompt text on every `generate()` call.
 *
 * Before this: `CompletionController::generate()` called
 * `BoilerplateManager::detectFromPrompt($userPrompt)` fresh every
 * single time, including on a project's SECOND, THIRD, etc. generate()
 * call. That's fragile in a way that only bites later — if a follow-up
 * prompt doesn't happen to contain whatever keywords the first one did,
 * detection can silently return a different key than what's actually
 * on disk, which then computes the WRONG protected-paths list against
 * an already-scaffolded project. Worse, nothing else in the app has
 * ever had a reliable way to ask "what framework is this project"
 * after the fact — `FileController` (see its own protected-path
 * enforcement added alongside this migration) needed exactly this to
 * exist before it could do that check at all.
 *
 * Nullable, defaults to null on every existing and new row — purely
 * additive. A null value means "unknown / pre-dates this column, or
 * never went through generate() at all" and every consumer of this
 * column (generate() itself, FileController) treats that as "don't
 * restrict anything" rather than guessing, exactly like `db_engine`'s
 * own null-means-old-behavior precedent right above this column.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->string('boilerplate_key')->nullable()->after('db_engine');
        });
    }

    public function down(): void
    {
        Schema::table('projects', function (Blueprint $table) {
            $table->dropColumn('boilerplate_key');
        });
    }
};
