<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * D8 fix (PLAN_SYSTEM_TASKS.md Phase D): BYOK provider secrets — Google,
 * OpenAI, OpenRouter, Mistral keys — previously lived only in the browser's
 * localStorage, plaintext, sent in the body of every AI request. This table
 * moves them server-side, encrypted at rest. The `value` column is decrypted
 * transparently by Eloquent's 'encrypted' cast on App\Models\UserAiKey
 * (AES-256-CBC via APP_KEY) — never store or read it as plain text.
 *
 * Deliberately does NOT cover Ollama URLs (local/remote): those are
 * per-request connection targets the backend proxies to, not bearer-token
 * secrets, and still travel with each request the same as before — see the
 * 2026-08-07 decision-log entry for the full reasoning.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_ai_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('provider'); // 'google' | 'openai' | 'openrouter' | 'mistral'
            $table->text('value'); // encrypted at rest — see App\Models\UserAiKey cast
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'provider']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_ai_keys');
    }
};
