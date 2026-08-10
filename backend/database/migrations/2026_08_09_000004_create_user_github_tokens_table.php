<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * F3 (PLAN_SYSTEM_TASKS.md Phase F, roadmap section F3): replaces
 * pasted GitHub Personal Access Tokens — previously stored in the
 * browser's localStorage in plaintext (SourceControlPanel.tsx,
 * `ubiq_api_keys.github`) and sent in the body of every PR-creation
 * request — with a real GitHub OAuth App flow. The token this table
 * stores is the OAuth access token GitHub issues after the user
 * authorizes Ubiq; it's encrypted at rest via App\Models\UserGithubToken's
 * 'encrypted' cast (AES-256-CBC, keyed by APP_KEY) and never sent back
 * to the browser.
 *
 * Kept as its own table rather than folded into `user_ai_keys`
 * (provider = 'github'): GitHub connections carry OAuth-specific
 * metadata that table doesn't model — github_username/avatar for
 * displaying "Connected as X" in Settings, and granted scopes — and a
 * dedicated table keeps `user_ai_keys` scoped to what its name says
 * (BYOK provider secrets) rather than growing a second, differently-
 * shaped concept inside it. See UBIQ_ENHANCEMENT_ROADMAP.md F3b for
 * the "which table" call.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_github_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('access_token'); // encrypted at rest — see UserGithubToken cast
            $table->string('github_username')->nullable();
            $table->string('github_avatar_url')->nullable();
            $table->string('scopes')->nullable(); // comma-separated, as GitHub returns them
            $table->timestamp('connected_at')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_github_tokens');
    }
};
