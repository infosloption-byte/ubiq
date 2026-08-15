<?php

namespace App\Services;

use App\Models\Project;
use App\Models\User;

/**
 * G2c (PLAN_SYSTEM_TASKS.md Phase G) — AI autonomy mode.
 *
 * Three modes, applying to G2a's review-screen flow (the only live
 * caller today — see G2b's decision-log entry for why `generate()`
 * itself isn't wired to anything yet):
 *   - `always_review`             — every proposal always goes through
 *                                    the review screen. Default, and
 *                                    the ONLY mode Free/Starter can use.
 *   - `auto_apply_except_protected` — non-sensitive files write
 *                                    immediately with no review screen;
 *                                    protected scaffold files AND the
 *                                    fixed sensitive set below still
 *                                    always stop for review.
 *   - `fully_autonomous`          — everything except protected
 *                                    scaffold files writes immediately.
 *                                    Sensitive files are NOT exempted
 *                                    in this mode — that's the actual
 *                                    difference from the mode above.
 *
 * Protected scaffold files (`BoilerplateManager::getProtectedPaths()`)
 * are never auto-written in ANY mode, including fully_autonomous — see
 * FileController::isProtectedAiProposal(), which has no autonomy-mode
 * awareness at all and blocks them unconditionally. This service's job
 * is deciding whether the REVIEW SCREEN shows at all for the rest, not
 * whether a protected file can ultimately be written — it never can,
 * from here.
 */
class AiAutonomyService
{
    public const ALWAYS_REVIEW = 'always_review';
    public const AUTO_APPLY_EXCEPT_PROTECTED = 'auto_apply_except_protected';
    public const FULLY_AUTONOMOUS = 'fully_autonomous';

    private const VALID_MODES = [self::ALWAYS_REVIEW, self::AUTO_APPLY_EXCEPT_PROTECTED, self::FULLY_AUTONOMOUS];

    /**
     * Fixed "user-marked-sensitive" set per the original spec wording.
     * Deliberately NOT actually user-configurable yet — the spec says
     * "user-marked-sensitive files" implying people could add their own,
     * but that's its own small feature (a places-to-store-and-edit-the-
     * list problem) that wasn't asked for build alongside the mode
     * mechanism itself. This is the fixed baseline the spec names
     * explicitly (`.env`, migrations, `package.json`); flagged in
     * PLAN_SYSTEM_TASKS.md as a follow-up, not silently dropped.
     */
    private const SENSITIVE_BASENAMES = ['package.json', '.env'];

    public function __construct(private PlanGuard $planGuard)
    {
    }

    /**
     * The mode that actually applies right now for this user+project —
     * after reading stored preference AND clamping for tier. Callers
     * should only ever use THIS, never read the raw stored preference
     * directly, or they'll skip the tier enforcement.
     */
    public function resolve(User $user, ?Project $project): string
    {
        $stored = $this->storedMode($user, $project);

        if ($stored !== self::ALWAYS_REVIEW && !$this->planGuard->check($user, 'ai.autonomy_auto_apply')) {
            // Tier doesn't allow it — clamp silently rather than error.
            // Covers a downgraded former Creator/Pro user whose saved
            // preference still says otherwise; nothing about picking a
            // mode you can no longer use should be a hard failure, it
            // should just behave as if you'd picked the default.
            return self::ALWAYS_REVIEW;
        }

        return $stored;
    }

    /** Raw stored preference, before tier clamping — per-project override wins over the global default, which wins over always_review. */
    private function storedMode(User $user, ?Project $project): string
    {
        $settings = $this->decodedEditorSettings($user);
        $autonomy = $settings['aiAutonomy'] ?? [];

        if ($project && isset($autonomy['perProject'][(string) $project->id])) {
            $mode = $autonomy['perProject'][(string) $project->id];
            if (in_array($mode, self::VALID_MODES, true)) return $mode;
        }

        $global = $autonomy['global'] ?? self::ALWAYS_REVIEW;
        return in_array($global, self::VALID_MODES, true) ? $global : self::ALWAYS_REVIEW;
    }

    private function decodedEditorSettings(User $user): array
    {
        $raw = $user->preferences?->editor_settings;
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            return is_array($decoded) ? $decoded : [];
        }
        return is_array($raw) ? $raw : [];
    }

    /**
     * The fixed sensitive-file check `auto_apply_except_protected` still
     * stops for review on, even though it skips review for everything
     * else. NOT checked for `fully_autonomous` — that mode's whole
     * point is skipping this too, only protected scaffold files remain
     * unconditional (and those are enforced independently, not via
     * this class at all — see the class docblock).
     */
    public function isSensitivePath(string $path): bool
    {
        $basename = basename($path);
        if (in_array($basename, self::SENSITIVE_BASENAMES, true)) return true;
        // Migrations: any path segment literally named "migrations",
        // covers Laravel's database/migrations, Django's
        // <app>/migrations, etc. without hardcoding one framework's
        // exact directory shape.
        return in_array('migrations', explode('/', trim($path, '/')), true);
    }
}
