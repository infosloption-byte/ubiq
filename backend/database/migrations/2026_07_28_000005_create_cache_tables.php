<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * .env.example sets CACHE_STORE=database, but no cache table has ever
 * existed in this project (confirmed absent from schema.sql and every
 * prior migration). Any Cache::put()/remember() call currently throws
 * "Base table or view not found: cache" in production. PlanService (B1)
 * is the first thing that actually needs a working cache, so fixing this
 * prerequisite here rather than discovering it as a mystery outage later.
 *
 * Standard Laravel database-cache-driver schema (php artisan cache:table).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cache', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->mediumText('value');
            $table->integer('expiration');
        });

        Schema::create('cache_locks', function (Blueprint $table) {
            $table->string('key')->primary();
            $table->string('owner');
            $table->integer('expiration');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('cache_locks');
        Schema::dropIfExists('cache');
    }
};
