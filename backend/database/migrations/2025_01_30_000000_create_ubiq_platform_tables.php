<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        // 1. Users Table
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('username')->unique();
            $table->string('email')->unique();
            $table->string('password');
            $table->enum('subscription_tier', ['free', 'pro'])->default('free');
            $table->string('api_key')->nullable()->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->rememberToken();
            $table->timestamps();
        });

        // 2. User Preferences
        Schema::create('user_preferences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('preferred_model')->default('codellama:7b');
            $table->string('theme')->default('dark');
            $table->text('editor_settings')->nullable(); // JSON
            $table->boolean('auto_complete')->default(true);
            $table->boolean('code_suggestions')->default(true);
            $table->timestamps();
        });

        // 3. Projects (UPDATED FOR SMART FEATURES)
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('language')->nullable();
            $table->enum('visibility', ['private', 'public'])->default('private');
            $table->boolean('is_archived')->default(false);
            
            // --- NEW FIELDS FOR SMART PROJECTS ---
            $table->enum('source', ['manual', 'upload', 'github'])->default('manual'); 
            $table->string('repository_url')->nullable(); // e.g. https://github.com/user/repo
            $table->string('branch')->default('main');
            $table->text('github_token')->nullable(); // Encrypt this!
            $table->string('storage_path')->nullable(); // Path on server disk
            
            $table->timestamps();
        });

        // 4. Files
        Schema::create('files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->constrained()->onDelete('cascade');
            $table->string('name');
            $table->string('path', 400);
            $table->longText('content')->nullable(); // Consider moving large files to disk later
            $table->string('language')->nullable();
            $table->unsignedInteger('size_bytes')->default(0);
            $table->boolean('is_deleted')->default(false);
            $table->timestamps();
        });

        // 5. Chat Sessions
        Schema::create('chat_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->foreignId('project_id')->nullable()->constrained()->onDelete('set null');
            $table->string('title')->default('New Chat');
            $table->string('model_used')->nullable();
            $table->boolean('is_archived')->default(false);
            $table->timestamps();
        });

        // 6. Chat Messages
        Schema::create('chat_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('session_id')->constrained('chat_sessions')->onDelete('cascade');
            $table->enum('role', ['user', 'assistant', 'system']);
            $table->text('content');
            $table->text('code_context')->nullable(); // JSON or text
            $table->unsignedInteger('tokens_used')->default(0);
            $table->timestamps();
        });

        // 7. Available Models
        Schema::create('available_models', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('display_name');
            $table->string('model_type')->default('both'); // chat, completion, both
            $table->string('size')->nullable();
            $table->unsignedInteger('context_window')->default(4096);
            $table->boolean('is_active')->default(true);
            $table->enum('tier_required', ['free', 'premium'])->default('free');
            $table->text('description')->nullable();
            $table->string('parameters_count')->nullable();
            $table->timestamps();
        });

        // 8. Model Metrics
        Schema::create('model_metrics', function (Blueprint $table) {
            $table->id();
            $table->string('model_name');
            $table->decimal('avg_latency_ms', 10, 2)->default(0);
            $table->decimal('success_rate', 5, 2)->default(0);
            $table->unsignedBigInteger('total_requests')->default(0);
            $table->unsignedBigInteger('total_tokens')->default(0);
            $table->date('date');
            $table->timestamps();
            
            $table->unique(['model_name', 'date']);
        });

        // 9. Usage Logs
        Schema::create('usage_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->string('request_type')->nullable(); // chat, completion
            $table->string('model_used')->nullable();
            $table->unsignedInteger('tokens_input')->default(0);
            $table->unsignedInteger('tokens_output')->default(0);
            $table->unsignedInteger('latency_ms')->default(0);
            $table->boolean('success')->default(true);
            $table->text('error_message')->nullable();
            $table->string('ip_address')->nullable();
            $table->string('user_agent')->nullable();
            $table->timestamps();
        });

        // 10. Rate Limits
        Schema::create('rate_limits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->unsignedInteger('request_count')->default(0);
            $table->timestamp('window_start');
            $table->timestamp('window_end');
            $table->timestamps();
        });

        // 11. Personal Access Tokens (Sanctum)
        Schema::create('personal_access_tokens', function (Blueprint $table) {
            $table->id();
            $table->morphs('tokenable');
            $table->string('name');
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::dropIfExists('personal_access_tokens');
        Schema::dropIfExists('rate_limits');
        Schema::dropIfExists('usage_logs');
        Schema::dropIfExists('model_metrics');
        Schema::dropIfExists('available_models');
        Schema::dropIfExists('chat_messages');
        Schema::dropIfExists('chat_sessions');
        Schema::dropIfExists('files');
        Schema::dropIfExists('projects');
        Schema::dropIfExists('user_preferences');
        Schema::dropIfExists('users');
    }
};