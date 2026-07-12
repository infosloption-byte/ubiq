<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * BoilerplateManager  —  Hardcoded-Template Edition
 *
 * PHILOSOPHY:
 *   Every framework scaffold is defined as hardcoded PHP arrays in this file.
 *   No zip files, no filesystem dependencies, no artisan commands needed.
 *
 *   When a user generates a project:
 *     1. detectFromPrompt()  →  boilerplate key  (e.g. 'laravel@11')
 *     2. write()             →  write all scaffold files to disk + DB in one pass
 *     3. AI is called with a focused prompt — generate APP FILES ONLY
 *     4. AI files are merged on top; protected scaffold files blocked
 *
 *   To update a template: edit the getFiles() method for that framework.
 *   No deployment steps, no zip rebuilds, no artisan commands.
 *
 * SUPPORTED KEYS:
 *   laravel@11, laravel@10, react, vue, nextjs, angular,
 *   node, flask, fastapi, django, html
 */
class BoilerplateManager
{
    // =========================================================================
    // PUBLIC API
    // =========================================================================

    /**
     * Detect the best boilerplate key from a user prompt.
     * Returns e.g. 'laravel@11', 'react', 'flask', 'html'
     */
    public static function detectFromPrompt(string $prompt): string
    {
        // PHP / Laravel — check version specifics first
        if (preg_match('/laravel\s*1[2-9]/i', $prompt))         return 'laravel@11'; // 12+ same structure as 11
        if (preg_match('/laravel\s*11/i', $prompt))             return 'laravel@11';
        if (preg_match('/laravel\s*(8|9|10)/i', $prompt))       return 'laravel@10';
        if (preg_match('/laravel/i', $prompt))                  return 'laravel@11'; // default latest
        if (preg_match('/php|symfony|codeigniter/i', $prompt))  return 'laravel@11';

        // Node / JS frameworks
        if (preg_match('/next\.?js|nextjs/i', $prompt))         return 'nextjs';
        if (preg_match('/angular/i', $prompt))                  return 'angular';
        if (preg_match('/svelte/i', $prompt))                   return 'react';   // fallback
        if (preg_match('/vue/i', $prompt))                      return 'vue';
        if (preg_match('/react/i', $prompt))                    return 'react';
        if (preg_match('/express|node\.?js|node\b/i', $prompt)) return 'node';

        // Python frameworks
        if (preg_match('/django/i', $prompt))                   return 'django';
        if (preg_match('/fastapi/i', $prompt))                  return 'fastapi';
        if (preg_match('/flask/i', $prompt))                    return 'flask';
        if (preg_match('/python/i', $prompt))                   return 'flask';   // default python

        // Static fallback
        return 'html';
    }

    /**
     * Write the scaffold for $boilerplateKey into $targetPath.
     *
     * - Creates $targetPath if it doesn't exist.
     * - Writes every scaffold file to disk.
     * - Sets storage/ and database/ to 0777 for Docker write access.
     * - Calls $syncCallback(string $relativePath, string $content) per file
     *   so the caller can sync files to the DB in one pass.
     *
     * Returns metadata: ['framework', 'runtime', 'port', 'files_written']
     *
     * @param  string        $boilerplateKey  e.g. 'laravel@11'
     * @param  string        $targetPath      Absolute path to workspace directory
     * @param  callable|null $syncCallback    Optional fn(string $relativePath, string $content)
     */
    public static function write(string $boilerplateKey, string $targetPath, ?callable $syncCallback = null): array
    {
        if (!is_dir($targetPath)) {
            mkdir($targetPath, 0777, true);
        }

        $ubiqConfig = self::getUbiqConfig($boilerplateKey);

        // Build ubiq.json content and prepend it to the files so it gets
        // written to disk AND synced to DB through the same callback as every
        // other scaffold file. Previously it was written AFTER the loop,
        // so it never reached the DB and the editor showed it as empty.
        $ubiqJsonContent = json_encode(array_merge($ubiqConfig, [
            'boilerplate' => $boilerplateKey,
            'generated'   => date('Y-m-d H:i:s'),
        ]), JSON_PRETTY_PRINT);

        $files = array_merge(['ubiq.json' => $ubiqJsonContent], self::getFiles($boilerplateKey));
        $filesWritten = 0;

        foreach ($files as $relativePath => $content) {
            $fullPath = rtrim($targetPath, '/') . '/' . $relativePath;
            $dir      = dirname($fullPath);

            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }

            file_put_contents($fullPath, $content);
            $filesWritten++;

            if ($syncCallback !== null) {
                $ext = strtolower(pathinfo($relativePath, PATHINFO_EXTENSION));
                // Skip binary / DB files from DB sync
                if (!in_array($ext, ['sqlite', 'png', 'jpg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'map', 'lock'], true)) {
                    ($syncCallback)($relativePath, $content);
                }
            }
        }

        // ── Post-write permission fixes ──────────────────────────────────────
        $writableDirs = ['storage', 'bootstrap/cache', 'database'];
        foreach ($writableDirs as $dir) {
            $fullDir = $targetPath . '/' . $dir;
            if (is_dir($fullDir)) {
                self::chmodRecursive($fullDir, 0777, 0666);
            }
        }

        // Ensure database.sqlite exists and is writable
        $sqlitePath = $targetPath . '/database/database.sqlite';
        if (is_dir($targetPath . '/database')) {
            if (!file_exists($sqlitePath)) {
                file_put_contents($sqlitePath, '');
            }
            chmod($sqlitePath, 0666);
            chmod($targetPath . '/database', 0777);
        }

        // Make artisan executable
        $artisanPath = $targetPath . '/artisan';
        if (file_exists($artisanPath)) {
            chmod($artisanPath, 0755);
        }

        Log::info("[BoilerplateManager] Wrote {$boilerplateKey} scaffold → {$targetPath} ({$filesWritten} files)");

        return array_merge($ubiqConfig, ['files_written' => $filesWritten]);
    }

    /**
     * Alias for write() — backwards compatibility with any code calling extract().
     */
    public static function extract(string $boilerplateKey, string $targetPath, ?callable $syncCallback = null): array
    {
        return self::write($boilerplateKey, $targetPath, $syncCallback);
    }

    /**
     * Get the AI system prompt for a boilerplate key.
     * Tells AI which files already exist (don't regenerate) and what to generate.
     */
    public static function getAiPrompt(string $boilerplateKey): string
    {
        return match(true) {
            str_starts_with($boilerplateKey, 'laravel@11') => self::laravelAiPrompt('11'),
            str_starts_with($boilerplateKey, 'laravel@10') => self::laravelAiPrompt('10'),
            $boilerplateKey === 'react'                    => self::reactAiPrompt(),
            $boilerplateKey === 'vue'                      => self::vueAiPrompt(),
            $boilerplateKey === 'nextjs'                   => self::nextjsAiPrompt(),
            $boilerplateKey === 'angular'                  => self::angularAiPrompt(),
            $boilerplateKey === 'node'                     => self::nodeAiPrompt(),
            $boilerplateKey === 'flask'                    => self::flaskAiPrompt(),
            $boilerplateKey === 'fastapi'                  => self::fastapiAiPrompt(),
            $boilerplateKey === 'django'                   => self::djangoAiPrompt(),
            default                                        => self::htmlAiPrompt(),
        };
    }

    /**
     * Get runtime/framework/port config for a boilerplate key.
     */
    public static function getUbiqConfig(string $boilerplateKey): array
    {
        return match(true) {
            str_starts_with($boilerplateKey, 'laravel') => ['runtime' => 'php',    'framework' => 'laravel', 'port' => 8000],
            $boilerplateKey === 'react'                 => ['runtime' => 'node',   'framework' => 'react',   'port' => 5173],
            $boilerplateKey === 'vue'                   => ['runtime' => 'node',   'framework' => 'vue',     'port' => 5173],
            $boilerplateKey === 'nextjs'                => ['runtime' => 'node',   'framework' => 'nextjs',  'port' => 3000],
            $boilerplateKey === 'angular'               => ['runtime' => 'node',   'framework' => 'angular', 'port' => 4200],
            $boilerplateKey === 'node'                  => ['runtime' => 'node',   'framework' => 'node',    'port' => 3000],
            $boilerplateKey === 'flask'                 => ['runtime' => 'python', 'framework' => 'flask',   'port' => 5000],
            $boilerplateKey === 'fastapi'               => ['runtime' => 'python', 'framework' => 'fastapi', 'port' => 8000],
            $boilerplateKey === 'django'                => ['runtime' => 'python', 'framework' => 'django',  'port' => 8000],
            default                                     => ['runtime' => 'static', 'framework' => 'html',    'port' => 80],
        };
    }

    /**
     * Returns file paths that MUST NOT be overwritten by AI output.
     * These are the scaffold/infrastructure files written by write().
     */
    public static function getProtectedPaths(string $boilerplateKey): array
    {
        $common = ['ubiq.json'];

        return match(true) {
            str_starts_with($boilerplateKey, 'laravel@11') => array_merge($common, [
                'artisan',
                'bootstrap/app.php',
                'bootstrap/providers.php',
                'public/index.php',
                'composer.json',
                '.env.example',
                'config/app.php',
                'config/auth.php',
                'config/cache.php',
                'config/database.php',
                'config/filesystems.php',
                'config/logging.php',
                'config/mail.php',
                'config/queue.php',
                'config/services.php',
                'config/session.php',
                'app/Http/Controllers/Controller.php',
                'app/Providers/AppServiceProvider.php',
                'app/Models/User.php',
                'routes/console.php',
            ]),
            str_starts_with($boilerplateKey, 'laravel@10') => array_merge($common, [
                'artisan',
                'bootstrap/app.php',
                'public/index.php',
                'composer.json',
                '.env.example',
                'config/app.php',
                'config/auth.php',
                'config/cache.php',
                'config/database.php',
                'config/filesystems.php',
                'config/logging.php',
                'config/mail.php',
                'config/queue.php',
                'config/services.php',
                'config/session.php',
                'app/Http/Controllers/Controller.php',
                'app/Http/Kernel.php',
                'app/Console/Kernel.php',
                'app/Exceptions/Handler.php',
                'app/Providers/AppServiceProvider.php',
                'app/Models/User.php',
                'routes/console.php',
            ]),
            in_array($boilerplateKey, ['react', 'vue'], true) => array_merge($common, [
                'package.json',
                'vite.config.js',
                'index.html',
                'src/main.jsx',
                'src/main.js',
            ]),
            $boilerplateKey === 'nextjs' => array_merge($common, [
                'package.json',
                'next.config.mjs',
                'app/layout.jsx',
            ]),
            $boilerplateKey === 'node' => array_merge($common, ['package.json']),
            $boilerplateKey === 'angular' => array_merge($common, [
                'package.json',
                'vite.config.ts',
                'tsconfig.json',
                'index.html',
                'src/main.ts',
                'src/styles.css',
            ]),
            in_array($boilerplateKey, ['flask', 'fastapi'], true) => array_merge($common, [
                'requirements.txt',
            ]),
            $boilerplateKey === 'django' => array_merge($common, [
                'manage.py',
                'requirements.txt',
                'config/settings.py',
                'config/wsgi.py',
                'config/asgi.py',
            ]),
            default => $common,
        };
    }

    // =========================================================================
    // SCAFFOLD FILE DEFINITIONS
    // =========================================================================

    /**
     * Returns all scaffold files for the given boilerplate key.
     * Keys are relative paths, values are file contents.
     *
     * @return array<string, string>
     */
    public static function getFiles(string $boilerplateKey): array
    {
        return match(true) {
            str_starts_with($boilerplateKey, 'laravel@11') => self::laravel11Files(),
            str_starts_with($boilerplateKey, 'laravel@10') => self::laravel10Files(),
            $boilerplateKey === 'react'                    => self::reactFiles(),
            $boilerplateKey === 'vue'                      => self::vueFiles(),
            $boilerplateKey === 'nextjs'                   => self::nextjsFiles(),
            $boilerplateKey === 'angular'                  => self::angularFiles(),
            $boilerplateKey === 'node'                     => self::nodeFiles(),
            $boilerplateKey === 'flask'                    => self::flaskFiles(),
            $boilerplateKey === 'fastapi'                  => self::fastapiFiles(),
            $boilerplateKey === 'django'                   => self::djangoFiles(),
            default                                        => self::htmlFiles(),
        };
    }

    // =========================================================================
    // LARAVEL 11
    // =========================================================================

    private static function laravel11Files(): array
    {
        return [

            // ── Entry points ─────────────────────────────────────────────────
            'artisan' => <<<'PHP'
#!/usr/bin/env php
<?php

use Symfony\Component\Console\Input\ArgvInput;

define('LARAVEL_START', microtime(true));

require __DIR__.'/vendor/autoload.php';

$status = (require_once __DIR__.'/bootstrap/app.php')
    ->handleCommand(new ArgvInput);

exit($status);
PHP,

            'public/index.php' => <<<'PHP'
<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

require __DIR__.'/../vendor/autoload.php';

(require_once __DIR__.'/../bootstrap/app.php')
    ->handleRequest(Request::capture());
PHP,

            // ── Bootstrap ────────────────────────────────────────────────────
            'bootstrap/app.php' => <<<'PHP'
<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        //
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
PHP,

            'bootstrap/providers.php' => <<<'PHP'
<?php

return [
    App\Providers\AppServiceProvider::class,
];
PHP,

            // ── Composer ─────────────────────────────────────────────────────
            'composer.json' => json_encode([
                'name'        => 'laravel/laravel',
                'type'        => 'project',
                'description' => 'The skeleton application for the Laravel framework.',
                'keywords'    => ['laravel', 'framework'],
                'license'     => 'MIT',
                'require'     => [
                    'php'               => '^8.2',
                    'laravel/framework' => '^11.0',
                    'laravel/tinker'    => '^2.9',
                ],
                'require-dev' => [
                    'fakerphp/faker'             => '^1.23',
                    'laravel/pint'               => '^1.13',
                    'mockery/mockery'            => '^1.6',
                    'nunomaduro/collision'       => '^8.0',
                    'phpunit/phpunit'            => '^11.0',
                ],
                'autoload' => [
                    'psr-4' => [
                        'App\\'               => 'app/',
                        'Database\\Factories\\' => 'database/factories/',
                        'Database\\Seeders\\'   => 'database/seeders/',
                    ],
                ],
                'autoload-dev' => [
                    'psr-4' => ['Tests\\' => 'tests/'],
                ],
                'scripts' => [
                    'post-autoload-dump'        => [
                        'Illuminate\\Foundation\\ComposerScripts::postAutoloadDump',
                        '@php artisan package:discover --ansi',
                    ],
                    'post-root-package-install' => [
                        '@php -r "file_exists(\'.env\') || copy(\'.env.example\', \'.env\');"',
                    ],
                ],
                'extra' => [
                    'laravel' => ['dont-discover' => []],
                ],
                'config' => [
                    'optimize-autoloader' => true,
                    'preferred-install'   => 'dist',
                    'sort-packages'       => true,
                    'allow-plugins'       => [
                        'pestphp/pest-plugin' => true,
                        'php-http/discovery'  => true,
                    ],
                ],
                'minimum-stability' => 'stable',
                'prefer-stable'     => true,
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            // ── Environment ──────────────────────────────────────────────────
            '.env.example' => <<<'ENV'
APP_NAME=Laravel
APP_ENV=local
APP_KEY=
APP_DEBUG=true
APP_TIMEZONE=UTC
APP_URL=http://localhost

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US

APP_MAINTENANCE_DRIVER=file

BCRYPT_ROUNDS=12

LOG_CHANNEL=stack
LOG_STACK=single
LOG_LEVEL=debug

DB_CONNECTION=sqlite
DB_DATABASE=/app/database/database.sqlite

SESSION_DRIVER=file
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null

BROADCAST_CONNECTION=log
FILESYSTEM_DISK=local
QUEUE_CONNECTION=sync

CACHE_STORE=file
ENV,

            // ── Application ──────────────────────────────────────────────────
            'app/Http/Controllers/Controller.php' => <<<'PHP'
<?php

namespace App\Http\Controllers;

abstract class Controller
{
    //
}
PHP,

            'app/Models/User.php' => <<<'PHP'
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password'          => 'hashed',
        ];
    }
}
PHP,

            'app/Providers/AppServiceProvider.php' => <<<'PHP'
<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        //
    }
}
PHP,

            // ── Config ───────────────────────────────────────────────────────
            'config/app.php' => <<<'PHP'
<?php

return [
    'name'     => env('APP_NAME', 'Laravel'),
    'env'      => env('APP_ENV', 'production'),
    'debug'    => (bool) env('APP_DEBUG', false),
    'url'      => env('APP_URL', 'http://localhost'),
    'timezone' => env('APP_TIMEZONE', 'UTC'),
    'locale'   => env('APP_LOCALE', 'en'),
    'fallback_locale' => env('APP_FALLBACK_LOCALE', 'en'),
    'faker_locale'    => env('APP_FAKER_LOCALE', 'en_US'),
    'cipher'   => 'AES-256-CBC',
    'key'      => env('APP_KEY'),
    'previous_keys' => [
        ...array_filter(explode(',', env('APP_PREVIOUS_KEYS', ''))),
    ],
    'maintenance' => [
        'driver' => env('APP_MAINTENANCE_DRIVER', 'file'),
    ],
];
PHP,

            'config/auth.php' => <<<'PHP'
<?php

return [
    'defaults' => [
        'guard'     => env('AUTH_GUARD', 'web'),
        'passwords' => env('AUTH_PASSWORD_BROKER', 'users'),
    ],
    'guards' => [
        'web' => ['driver' => 'session', 'provider' => 'users'],
    ],
    'providers' => [
        'users' => ['driver' => 'eloquent', 'model' => App\Models\User::class],
    ],
    'passwords' => [
        'users' => [
            'provider'  => 'users',
            'table'     => env('AUTH_PASSWORD_RESET_TOKEN_TABLE', 'password_reset_tokens'),
            'expire'    => 60,
            'throttle'  => 60,
        ],
    ],
    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 10800),
];
PHP,

            'config/cache.php' => <<<'PHP'
<?php

use Illuminate\Support\Str;

return [
    'default' => env('CACHE_STORE', 'file'),
    'stores'  => [
        'file'     => ['driver' => 'file', 'path' => storage_path('framework/cache/data'), 'lock_path' => storage_path('framework/cache/data')],
        'array'    => ['driver' => 'array', 'serialize' => false],
        'database' => ['driver' => 'database', 'table' => env('DB_CACHE_TABLE', 'cache'), 'connection' => null, 'lock_connection' => null],
    ],
    'prefix' => env('CACHE_PREFIX', Str::slug(env('APP_NAME', 'laravel'), '_').'_cache_'),
];
PHP,

            'config/database.php' => <<<'PHP'
<?php

use Illuminate\Support\Str;

return [
    'default' => env('DB_CONNECTION', 'sqlite'),
    'connections' => [
        'sqlite' => [
            'driver'   => 'sqlite',
            'database' => env('DB_DATABASE', database_path('database.sqlite')),
            'prefix'   => '',
            'foreign_key_constraints' => env('DB_FOREIGN_KEYS', true),
        ],
        'mysql' => [
            'driver'    => 'mysql',
            'host'      => env('DB_HOST', '127.0.0.1'),
            'port'      => env('DB_PORT', '3306'),
            'database'  => env('DB_DATABASE', 'laravel'),
            'username'  => env('DB_USERNAME', 'root'),
            'password'  => env('DB_PASSWORD', ''),
            'charset'   => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix'    => '',
            'strict'    => true,
            'engine'    => null,
        ],
    ],
    'migrations' => ['table' => 'migrations', 'update_date_on_publish' => true],
    'redis' => [
        'client'  => env('REDIS_CLIENT', 'phpredis'),
        'options' => ['cluster' => env('REDIS_CLUSTER', 'redis'), 'prefix' => env('REDIS_PREFIX', Str::slug(env('APP_NAME', 'laravel'), '_').'_database_')],
        'default' => ['url' => env('REDIS_URL'), 'host' => env('REDIS_HOST', '127.0.0.1'), 'password' => env('REDIS_PASSWORD'), 'port' => env('REDIS_PORT', '6379'), 'database' => '0'],
    ],
];
PHP,

            'config/filesystems.php' => <<<'PHP'
<?php

return [
    'default' => env('FILESYSTEM_DISK', 'local'),
    'disks'   => [
        'local'  => ['driver' => 'local', 'root' => storage_path('app'), 'throw' => false],
        'public' => ['driver' => 'local', 'root' => storage_path('app/public'), 'url' => env('APP_URL').'/storage', 'visibility' => 'public', 'throw' => false],
    ],
    'links' => [public_path('storage') => storage_path('app/public')],
];
PHP,

            'config/logging.php' => <<<'PHP'
<?php

use Monolog\Handler\NullHandler;
use Monolog\Handler\StreamHandler;

return [
    'default' => env('LOG_CHANNEL', 'stack'),
    'deprecations' => ['channel' => env('LOG_DEPRECATIONS_CHANNEL', 'null'), 'trace' => false],
    'channels' => [
        'stack'  => ['driver' => 'stack', 'channels' => explode(',', env('LOG_STACK', 'single')), 'ignore_exceptions' => false],
        'single' => ['driver' => 'single', 'path' => storage_path('logs/laravel.log'), 'level' => env('LOG_LEVEL', 'debug'), 'replace_placeholders' => true],
        'stderr' => ['driver' => 'monolog', 'level' => env('LOG_LEVEL', 'debug'), 'handler' => StreamHandler::class, 'with' => ['stream' => 'php://stderr']],
        'null'   => ['driver' => 'monolog', 'handler' => NullHandler::class],
    ],
];
PHP,

            'config/mail.php' => <<<'PHP'
<?php

return [
    'default' => env('MAIL_MAILER', 'log'),
    'mailers' => [
        'smtp'  => ['transport' => 'smtp', 'host' => env('MAIL_HOST', '127.0.0.1'), 'port' => env('MAIL_PORT', 2525), 'username' => env('MAIL_USERNAME'), 'password' => env('MAIL_PASSWORD')],
        'log'   => ['transport' => 'log', 'channel' => env('MAIL_LOG_CHANNEL')],
        'array' => ['transport' => 'array'],
    ],
    'from' => ['address' => env('MAIL_FROM_ADDRESS', 'hello@example.com'), 'name' => env('MAIL_FROM_NAME', 'Example')],
];
PHP,

            'config/queue.php' => <<<'PHP'
<?php

return [
    'default' => env('QUEUE_CONNECTION', 'sync'),
    'connections' => [
        'sync'     => ['driver' => 'sync'],
        'database' => ['driver' => 'database', 'table' => env('DB_QUEUE_TABLE', 'jobs'), 'queue' => 'default', 'retry_after' => 90, 'after_commit' => false],
    ],
    'failed' => ['driver' => env('QUEUE_FAILED_DRIVER', 'database-uuids'), 'database' => env('DB_CONNECTION', 'sqlite'), 'table' => 'failed_jobs'],
];
PHP,

            'config/services.php' => <<<'PHP'
<?php

return [
    'postmark' => ['token' => env('POSTMARK_TOKEN')],
    'ses'      => ['key' => env('AWS_ACCESS_KEY_ID'), 'secret' => env('AWS_SECRET_ACCESS_KEY'), 'region' => env('AWS_DEFAULT_REGION', 'us-east-1')],
    'slack'    => ['notifications' => ['bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'), 'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL')]],
];
PHP,

            'config/session.php' => <<<'PHP'
<?php

use Illuminate\Support\Str;

return [
    'driver'          => env('SESSION_DRIVER', 'file'),
    'lifetime'        => env('SESSION_LIFETIME', 120),
    'expire_on_close' => env('SESSION_EXPIRE_ON_CLOSE', false),
    'encrypt'         => env('SESSION_ENCRYPT', false),
    'files'           => storage_path('framework/sessions'),
    'connection'      => env('SESSION_CONNECTION'),
    'table'           => env('SESSION_TABLE', 'sessions'),
    'store'           => env('SESSION_STORE'),
    'lottery'         => [2, 100],
    'cookie'          => env('SESSION_COOKIE', Str::slug(env('APP_NAME', 'laravel'), '_').'_session'),
    'path'            => env('SESSION_PATH', '/'),
    'domain'          => env('SESSION_DOMAIN'),
    'secure'          => env('SESSION_SECURE_COOKIE'),
    'http_only'       => env('SESSION_HTTP_ONLY', true),
    'same_site'       => env('SESSION_SAME_SITE', 'lax'),
    'partitioned'     => env('SESSION_PARTITIONED_COOKIE', false),
];
PHP,

            // ── Routes ───────────────────────────────────────────────────────
            'routes/web.php' => <<<'PHP'
<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});
PHP,

            'routes/console.php' => <<<'PHP'
<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote')->hourly();
PHP,

            // ── Default view ─────────────────────────────────────────────────
            'resources/views/welcome.blade.php' => <<<'BLADE'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Laravel</title>
    <style>
        body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #1a202c; }
        .card { text-align: center; padding: 2rem 3rem; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
        h1 { font-size: 2rem; margin-bottom: .5rem; color: #e3342f; }
        p { color: #718096; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Laravel</h1>
        <p>Your application is ready. Start building!</p>
    </div>
</body>
</html>
BLADE,

            // ── Database ─────────────────────────────────────────────────────
            'database/migrations/2024_01_01_000001_create_users_table.php' => <<<'PHP'
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');
            $table->rememberToken();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
PHP,

            'database/migrations/2024_01_01_000002_create_cache_table.php' => <<<'PHP'
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

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
        Schema::dropIfExists('cache');
        Schema::dropIfExists('cache_locks');
    }
};
PHP,

            'database/seeders/DatabaseSeeder.php' => <<<'PHP'
<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        // \App\Models\User::factory(10)->create();
    }
}
PHP,

            // ── Storage dirs (gitkeep) ────────────────────────────────────────
            'storage/app/.gitkeep'              => '',
            'storage/app/public/.gitkeep'       => '',
            'storage/framework/cache/.gitkeep'  => '',
            'storage/framework/sessions/.gitkeep' => '',
            'storage/framework/views/.gitkeep'  => '',
            'storage/logs/.gitkeep'             => '',
            'bootstrap/cache/.gitkeep'          => '',
        ];
    }

    // =========================================================================
    // LARAVEL 10
    // =========================================================================

    private static function laravel10Files(): array
    {
        // Start from L11 base and override the version-specific files
        $files = self::laravel11Files();

        // Override bootstrap/app.php  — classic L10 container binding
        $files['bootstrap/app.php'] = <<<'PHP'
<?php

$app = new Illuminate\Foundation\Application(
    $_ENV['APP_BASE_PATH'] ?? dirname(__DIR__)
);

$app->singleton(
    Illuminate\Contracts\Http\Kernel::class,
    App\Http\Kernel::class
);

$app->singleton(
    Illuminate\Contracts\Console\Kernel::class,
    App\Console\Kernel::class
);

$app->singleton(
    Illuminate\Contracts\Debug\ExceptionHandler::class,
    App\Exceptions\Handler::class
);

return $app;
PHP;

        // Override public/index.php — L10 kernel dispatch
        $files['public/index.php'] = <<<'PHP'
<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

require __DIR__.'/../vendor/autoload.php';

$app = require_once __DIR__.'/../bootstrap/app.php';

$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

$response = $kernel->handle(
    $request = Request::capture()
)->send();

$kernel->terminate($request, $response);
PHP;

        // Override composer.json for L10
        $files['composer.json'] = json_encode([
            'name'        => 'laravel/laravel',
            'type'        => 'project',
            'description' => 'The skeleton application for the Laravel framework.',
            'keywords'    => ['laravel', 'framework'],
            'license'     => 'MIT',
            'require'     => [
                'php'               => '^8.1',
                'laravel/framework' => '^10.0',
                'laravel/tinker'    => '^2.8',
            ],
            'require-dev' => [
                'fakerphp/faker'       => '^1.9.1',
                'laravel/pint'         => '^1.0',
                'mockery/mockery'      => '^1.4.4',
                'nunomaduro/collision' => '^7.0',
                'phpunit/phpunit'      => '^10.1',
                'spatie/laravel-ignition' => '^2.0',
            ],
            'autoload' => [
                'psr-4' => [
                    'App\\'                => 'app/',
                    'Database\\Factories\\' => 'database/factories/',
                    'Database\\Seeders\\'   => 'database/seeders/',
                ],
            ],
            'autoload-dev' => ['psr-4' => ['Tests\\' => 'tests/']],
            'scripts' => [
                'post-autoload-dump' => ['Illuminate\\Foundation\\ComposerScripts::postAutoloadDump', '@php artisan package:discover --ansi'],
                'post-root-package-install' => ['@php -r "file_exists(\'.env\') || copy(\'.env.example\', \'.env\');"'],
            ],
            'extra'             => ['laravel' => ['dont-discover' => []]],
            'config'            => ['optimize-autoloader' => true, 'preferred-install' => 'dist', 'sort-packages' => true, 'allow-plugins' => ['pestphp/pest-plugin' => true, 'php-http/discovery' => true]],
            'minimum-stability' => 'stable',
            'prefer-stable'     => true,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        // Remove bootstrap/providers.php — not present in L10
        unset($files['bootstrap/providers.php']);

        // Add L10-specific kernel files
        $files['app/Http/Kernel.php'] = <<<'PHP'
<?php

namespace App\Http;

use Illuminate\Foundation\Http\Kernel as HttpKernel;

class Kernel extends HttpKernel
{
    protected $middleware = [
        \Illuminate\Http\Middleware\TrustProxies::class,
        \Illuminate\Http\Middleware\HandleCors::class,
        \Illuminate\Foundation\Http\Middleware\PreventRequestsDuringMaintenance::class,
        \Illuminate\Http\Middleware\ValidatePostSize::class,
        \Illuminate\Foundation\Http\Middleware\TrimStrings::class,
        \Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull::class,
    ];

    protected $middlewareGroups = [
        'web' => [
            \Illuminate\Cookie\Middleware\EncryptCookies::class,
            \Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse::class,
            \Illuminate\Session\Middleware\StartSession::class,
            \Illuminate\View\Middleware\ShareErrorsFromSession::class,
            \Illuminate\Foundation\Http\Middleware\VerifyCsrfToken::class,
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
        ],
        'api' => [
            \Illuminate\Routing\Middleware\ThrottleRequests::class.':api',
            \Illuminate\Routing\Middleware\SubstituteBindings::class,
        ],
    ];

    protected $middlewareAliases = [
        'auth'     => \Illuminate\Auth\Middleware\Authenticate::class,
        'throttle' => \Illuminate\Routing\Middleware\ThrottleRequests::class,
        'verified' => \Illuminate\Auth\Middleware\EnsureEmailIsVerified::class,
    ];
}
PHP;

        $files['app/Console/Kernel.php'] = <<<'PHP'
<?php

namespace App\Console;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    protected function schedule(Schedule $schedule): void
    {
        //
    }

    protected function commands(): void
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}
PHP;

        $files['app/Exceptions/Handler.php'] = <<<'PHP'
<?php

namespace App\Exceptions;

use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Throwable;

class Handler extends ExceptionHandler
{
    protected $dontFlash = [
        'current_password',
        'password',
        'password_confirmation',
    ];

    public function register(): void
    {
        $this->reportable(function (Throwable $e) {
            //
        });
    }
}
PHP;

        return $files;
    }

    // =========================================================================
    // REACT (Vite)
    // =========================================================================

    private static function reactFiles(): array
    {
        return [
            'package.json' => json_encode([
                'name'    => 'react-app',
                'private' => true,
                'version' => '0.0.0',
                'type'    => 'module',
                'scripts' => ['dev' => 'vite', 'build' => 'vite build', 'preview' => 'vite preview'],
                'dependencies'    => ['react' => '^18.3.1', 'react-dom' => '^18.3.1'],
                'devDependencies' => [
                    '@types/react'        => '^18.3.1',
                    '@types/react-dom'    => '^18.3.1',
                    '@vitejs/plugin-react' => '^4.3.1',
                    'vite'                => '^5.4.1',
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            'vite.config.js' => <<<'JS'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
JS,

            'index.html' => <<<'HTML'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
HTML,

            'src/main.jsx' => <<<'JSX'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
JSX,

            'src/App.jsx' => <<<'JSX'
import './App.css'

function App() {
  return (
    <div className="app">
      <h1>React App</h1>
      <p>Start building your application!</p>
    </div>
  )
}

export default App
JSX,

            'src/App.css' => <<<'CSS'
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}
CSS,

            'src/index.css' => <<<'CSS'
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1a202c; }
CSS,

            '.gitignore' => "node_modules\ndist\n.env\n",
        ];
    }

    // =========================================================================
    // VUE 3 (Vite)
    // =========================================================================

    private static function vueFiles(): array
    {
        return [
            'package.json' => json_encode([
                'name'    => 'vue-app',
                'private' => true,
                'version' => '0.0.0',
                'type'    => 'module',
                'scripts' => ['dev' => 'vite', 'build' => 'vite build', 'preview' => 'vite preview'],
                'dependencies'    => ['vue' => '^3.4.0'],
                'devDependencies' => [
                    '@vitejs/plugin-vue' => '^5.0.0',
                    'vite'               => '^5.4.1',
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            'vite.config.js' => <<<'JS'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
JS,

            'index.html' => <<<'HTML'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vue App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
HTML,

            'src/main.js' => <<<'JS'
import { createApp } from 'vue'
import './style.css'
import App from './App.vue'

createApp(App).mount('#app')
JS,

            'src/App.vue' => <<<'VUE'
<script setup>
// Your app logic here
</script>

<template>
  <div class="app">
    <h1>Vue App</h1>
    <p>Start building your application!</p>
  </div>
</template>

<style scoped>
.app {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}
</style>
VUE,

            'src/style.css' => <<<'CSS'
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1a202c; }
CSS,

            '.gitignore' => "node_modules\ndist\n.env\n",
        ];
    }

    // =========================================================================
    // NEXT.JS 14 (App Router)
    // =========================================================================

    private static function nextjsFiles(): array
    {
        return [
            'package.json' => json_encode([
                'name'    => 'nextjs-app',
                'version' => '0.1.0',
                'private' => true,
                'scripts' => ['dev' => 'next dev', 'build' => 'next build', 'start' => 'next start', 'lint' => 'next lint'],
                'dependencies' => [
                    'next'       => '^14.2.0',
                    'react'      => '^18.3.0',
                    'react-dom'  => '^18.3.0',
                ],
                'devDependencies' => [
                    '@types/node'    => '^20',
                    '@types/react'   => '^18',
                    '@types/react-dom' => '^18',
                    'typescript'     => '^5',
                    'eslint'         => '^8',
                    'eslint-config-next' => '14.2.0',
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            'next.config.mjs' => <<<'JS'
/** @type {import('next').NextConfig} */
const nextConfig = {}

export default nextConfig
JS,

            'app/layout.jsx' => <<<'JSX'
export const metadata = {
  title: 'Next.js App',
  description: 'Generated by Ubiq',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
JSX,

            'app/page.jsx' => <<<'JSX'
export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Next.js App</h1>
      <p>Start building your application!</p>
    </main>
  )
}
JSX,

            'app/globals.css' => <<<'CSS'
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1a202c; }
CSS,

            'public/.gitkeep' => '',
            '.gitignore' => "node_modules\n.next\n.env\n.env.local\n",
        ];
    }

    // =========================================================================
    // ANGULAR 17 (Vite + @analogjs/vite-plugin-angular)
    //
    // The old Angular CLI scaffold (@angular-devkit) required a 300MB npm install
    // and 4-6 minutes to start — unusable in a sandbox. This Vite-based scaffold
    // uses @analogjs/vite-plugin-angular (the official Vite adapter for Angular)
    // which installs in ~30 seconds and boots in under 5 seconds.
    // App code is identical Angular — standalone components, decorators, DI, etc.
    // =========================================================================

    private static function angularFiles(): array
    {
        return [
            'package.json' => json_encode([
                'name'    => 'angular-app',
                'version' => '0.0.0',
                'private' => true,
                'type'    => 'module',
                'scripts' => [
                    'dev'     => 'vite --host 0.0.0.0 --port 4200',
                    'build'   => 'vite build',
                    'preview' => 'vite preview',
                ],
                'dependencies' => [
                    '@angular/animations'            => '^17.3.0',
                    '@angular/common'                => '^17.3.0',
                    '@angular/compiler'              => '^17.3.0',
                    '@angular/core'                  => '^17.3.0',
                    '@angular/forms'                 => '^17.3.0',
                    '@angular/platform-browser'      => '^17.3.0',
                    '@angular/platform-browser-dynamic' => '^17.3.0',
                    '@angular/router'                => '^17.3.0',
                    'rxjs'                           => '~7.8.0',
                    'tslib'                          => '^2.6.0',
                    'zone.js'                        => '~0.14.0',
                ],
                'devDependencies' => [
                    '@analogjs/vite-plugin-angular' => '^1.6.0',
                    '@angular/compiler-cli'         => '^17.3.0',
                    'typescript'                    => '~5.4.0',
                    'vite'                          => '^5.2.0',
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            'vite.config.ts' => <<<'TS'
import { defineConfig } from 'vite'
import angular from '@analogjs/vite-plugin-angular'

export default defineConfig({
  plugins: [angular()],
  server: {
    host: '0.0.0.0',
    port: 4200,
  },
})
TS,

            'tsconfig.json' => json_encode([
                'compilerOptions' => [
                    'target'                 => 'ES2022',
                    'module'                 => 'ES2022',
                    'moduleResolution'       => 'bundler',
                    'lib'                    => ['ES2022', 'dom'],
                    'strict'                 => true,
                    'experimentalDecorators' => true,
                    'useDefineForClassFields' => false,
                    'sourceMap'              => true,
                    'declaration'            => false,
                    'skipLibCheck'           => true,
                    'esModuleInterop'        => true,
                    'allowSyntheticDefaultImports' => true,
                    'forceConsistentCasingInFileNames' => true,
                ],
                'angularCompilerOptions' => [
                    'strictInjectionParameters'  => true,
                    'strictInputAccessModifiers' => true,
                    'strictTemplates'            => true,
                ],
                'include' => ['src/**/*.ts'],
                'exclude' => ['node_modules'],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            'index.html' => <<<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Angular App</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <app-root></app-root>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
HTML,

            'src/main.ts' => <<<'TS'
import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent).catch(err => console.error(err));
TS,

            'src/styles.css' => <<<'CSS'
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1a202c; }
CSS,

            'src/app/app.component.ts' => <<<'TS'
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="container">
      <h1>Angular App</h1>
      <p>Start building your application!</p>
    </div>
  `,
  styles: [`
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; text-align: center; }
    h1 { font-size: 2rem; color: #c3002f; }
  `],
})
export class AppComponent {
  title = 'angular-app';
}
TS,

            '.gitignore' => "node_modules\ndist\n.env\n.angular\n",
        ];
    }

    // =========================================================================
    // NODE / EXPRESS
    // =========================================================================

    private static function nodeFiles(): array
    {
        return [
            'package.json' => json_encode([
                'name'    => 'node-app',
                'version' => '1.0.0',
                'main'    => 'server.js',
                'scripts' => ['start' => 'node server.js', 'dev' => 'node server.js'],
                'dependencies' => [
                    'express' => '^4.18.0',
                    'cors'    => '^2.8.5',
                ],
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES),

            'server.js' => <<<'JS'
const express = require('express')
const cors    = require('cors')

const app  = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.get('/', (req, res) => {
  res.json({ message: 'Node/Express server is running', status: 'ok' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`)
})

module.exports = app
JS,

            '.gitignore' => "node_modules\n.env\n",
        ];
    }

    // =========================================================================
    // FLASK
    // =========================================================================

    private static function flaskFiles(): array
    {
        return [
            'requirements.txt' => <<<'TXT'
flask>=3.0.0
python-dotenv>=1.0.0
TXT,

            'app.py' => <<<'PYTHON'
from flask import Flask, jsonify, render_template_string

app = Flask(__name__)

@app.route('/')
def index():
    return render_template_string("""
<!DOCTYPE html>
<html>
<head><title>Flask App</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:2rem auto;text-align:center">
  <h1>Flask App</h1>
  <p>Start building your application!</p>
</body>
</html>
""")

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
PYTHON,

            '.env.example' => "FLASK_ENV=development\nSECRET_KEY=change-me\n",

            '.gitignore' => "__pycache__\n*.pyc\n.env\nvenv\n",
        ];
    }

    // =========================================================================
    // FASTAPI
    // =========================================================================

    private static function fastapiFiles(): array
    {
        return [
            'requirements.txt' => <<<'TXT'
fastapi>=0.109.0
uvicorn[standard]>=0.27.0
python-dotenv>=1.0.0
TXT,

            'main.py' => <<<'PYTHON'
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI(title="FastAPI App", version="1.0.0")

@app.get("/", response_class=HTMLResponse)
async def root():
    return """
<!DOCTYPE html>
<html>
<head><title>FastAPI App</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:2rem auto;text-align:center">
  <h1>FastAPI App</h1>
  <p>Visit <a href="/docs">/docs</a> for the API documentation.</p>
</body>
</html>
"""

@app.get("/api/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
PYTHON,

            '.gitignore' => "__pycache__\n*.pyc\n.env\nvenv\n",
        ];
    }

    // =========================================================================
    // DJANGO 5
    // =========================================================================

    private static function djangoFiles(): array
    {
        return [
            'requirements.txt' => <<<'TXT'
django>=5.0.0
python-dotenv>=1.0.0
TXT,

            'manage.py' => <<<'PYTHON'
#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys

def main():
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed?"
        ) from exc
    execute_from_command_line(sys.argv)

if __name__ == '__main__':
    main()
PYTHON,

            'config/__init__.py' => '',

            'config/settings.py' => <<<'PYTHON'
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get('SECRET_KEY', 'django-insecure-dev-key-change-in-production')
DEBUG = True
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'app',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [BASE_DIR / 'templates'],
    'APP_DIRS': True,
    'OPTIONS': {
        'context_processors': [
            'django.template.context_processors.debug',
            'django.template.context_processors.request',
            'django.contrib.auth.context_processors.auth',
            'django.contrib.messages.context_processors.messages',
        ],
    },
}]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True
PYTHON,

            'config/urls.py' => <<<'PYTHON'
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('app.urls')),
]
PYTHON,

            'config/wsgi.py' => <<<'PYTHON'
import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
application = get_wsgi_application()
PYTHON,

            'config/asgi.py' => <<<'PYTHON'
import os
from django.core.asgi import get_asgi_application
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
application = get_asgi_application()
PYTHON,

            'app/__init__.py' => '',

            'app/models.py' => <<<'PYTHON'
from django.db import models

# Define your models here
PYTHON,

            'app/views.py' => <<<'PYTHON'
from django.http import HttpResponse

def index(request):
    html = """
<!DOCTYPE html>
<html>
<head><title>Django App</title></head>
<body style="font-family:sans-serif;max-width:800px;margin:2rem auto;text-align:center">
  <h1>Django App</h1>
  <p>Start building your application!</p>
</body>
</html>
"""
    return HttpResponse(html)
PYTHON,

            'app/urls.py' => <<<'PYTHON'
from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
]
PYTHON,

            'app/admin.py' => <<<'PYTHON'
from django.contrib import admin
# Register your models here.
PYTHON,

            'app/apps.py' => <<<'PYTHON'
from django.apps import AppConfig

class AppConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'app'
PYTHON,

            '.gitignore' => "__pycache__\n*.pyc\n.env\n*.sqlite3\n",
        ];
    }

    // =========================================================================
    // STATIC HTML
    // =========================================================================

    private static function htmlFiles(): array
    {
        return [
            'index.html' => <<<'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div class="container">
    <h1>My App</h1>
    <p>Start building your application!</p>
  </div>
  <script src="js/app.js"></script>
</body>
</html>
HTML,

            'css/style.css' => <<<'CSS'
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1a202c; }
.container { max-width: 800px; margin: 0 auto; padding: 2rem; text-align: center; }
h1 { font-size: 2.5rem; margin-bottom: 1rem; }
p { color: #718096; font-size: 1.1rem; }
CSS,

            'js/app.js' => <<<'JS'
// Application entry point
console.log('App loaded');
JS,
        ];
    }

    // =========================================================================
    // AI PROMPT TEMPLATES
    // =========================================================================

    private static function laravelAiPrompt(string $version): string
    {
        $kernelNote = $version === '11'
            ? "Laravel 11 — uses Application::configure() in bootstrap/app.php. NO app/Http/Kernel.php or app/Console/Kernel.php — do NOT generate them."
            : "Laravel 10 — uses classic Kernel pattern. app/Http/Kernel.php, app/Console/Kernel.php, and app/Exceptions/Handler.php already exist.";

        $bootstrapExtra = $version === '11' ? ', bootstrap/providers.php' : '';
        $kernelFiles    = $version === '10'
            ? "\n• app/Http/Kernel.php, app/Console/Kernel.php, app/Exceptions/Handler.php"
            : '';

        return <<<PROMPT
{$kernelNote}

THE FOLLOWING SCAFFOLD FILES ALREADY EXIST — DO NOT REGENERATE THEM:
• artisan, public/index.php
• bootstrap/app.php{$bootstrapExtra}
• composer.json, .env.example, ubiq.json
• config/app.php, config/auth.php, config/cache.php, config/database.php
• config/filesystems.php, config/logging.php, config/mail.php
• config/queue.php, config/services.php, config/session.php
• app/Http/Controllers/Controller.php
• app/Providers/AppServiceProvider.php, app/Models/User.php
• routes/console.php
• resources/views/welcome.blade.php
• database/migrations/2024_01_01_000001_create_users_table.php
• database/migrations/2024_01_01_000002_create_cache_table.php
• database/seeders/DatabaseSeeder.php{$kernelFiles}

YOU MUST GENERATE THESE APPLICATION FILES:
1. routes/web.php — ALL routes for the application (completely replace the placeholder)
2. routes/api.php — if REST API endpoints are needed
3. app/Http/Controllers/*.php — every controller the app needs (extend App\Http\Controllers\Controller)
4. app/Models/*.php — Eloquent models (skip User.php — it already exists)
5. database/migrations/YYYY_MM_DD_HHMMSS_create_things_table.php — all new migrations (DO NOT recreate users or cache tables)
6. resources/views/*.blade.php — all Blade templates the app needs
7. Any other files: Form Requests, Policies, Events, Listeners, Jobs, Middleware, etc.

DATABASE: SQLite only. DB_CONNECTION=sqlite, DB_DATABASE=/app/database/database.sqlite
SESSION: SESSION_DRIVER=file (already set — never use database driver)
MIGRATIONS: filename format MUST be: 2024_01_01_000100_create_things_table.php (use high sequence numbers to avoid conflicts)
CONTROLLERS: always include full namespace declaration and use statements
NEVER output empty file content — every file must have complete, working PHP code.
PROMPT;
    }

    private static function reactAiPrompt(): string
    {
        return <<<PROMPT
Scaffold already exists: package.json (react ^18, vite ^5), vite.config.js, index.html, src/main.jsx, src/App.css, src/index.css

DO NOT REGENERATE: package.json, vite.config.js, index.html, src/main.jsx, ubiq.json

YOU MUST GENERATE:
1. src/App.jsx — main component (REPLACE the placeholder completely)
2. src/components/*.jsx — all reusable components the app needs
3. src/pages/*.jsx — page-level components if routing is used
4. src/hooks/*.js — custom React hooks
5. src/App.css — updated styles for the application
Additional CSS files as needed.

RULES:
• Functional components + hooks only (no class components)
• If routing is needed: add react-router-dom to package.json AND generate router setup in App.jsx
• Every component file must have a default export
• Complete, working JSX — no TODO comments or placeholder functions
PROMPT;
    }

    private static function vueAiPrompt(): string
    {
        return <<<PROMPT
Scaffold already exists: package.json (vue ^3.4, vite ^5), vite.config.js, index.html, src/main.js, src/style.css

DO NOT REGENERATE: package.json, vite.config.js, index.html, src/main.js, ubiq.json

YOU MUST GENERATE:
1. src/App.vue — main component (REPLACE the placeholder completely)
2. src/components/*.vue — all reusable components
3. src/views/*.vue — page-level views if routing is used
4. src/router/index.js — router config if routing is needed (add vue-router to package.json)
5. src/stores/*.js — Pinia stores if state management is needed (add pinia to package.json)

RULES: Vue 3 Composition API with <script setup> syntax. Complete working code only.
PROMPT;
    }

    private static function nextjsAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: Next.js 14 App Router. package.json, next.config.mjs, app/layout.jsx, app/page.jsx, app/globals.css already exist.

DO NOT REGENERATE: package.json, next.config.mjs, app/layout.jsx, ubiq.json

YOU MUST GENERATE:
1. app/page.jsx — home page (REPLACE the placeholder completely)
2. app/[route]/page.jsx — additional pages as needed
3. app/api/[route]/route.js — API route handlers
4. components/*.jsx — shared UI components
5. app/globals.css — updated global styles

RULES: App Router (app/ directory). Server Components by default. Add 'use client' only when needed for interactivity.
PROMPT;
    }

    private static function angularAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: Angular 17 standalone components powered by Vite + @analogjs/vite-plugin-angular.
DO NOT regenerate: package.json, vite.config.ts, tsconfig.json, index.html, src/main.ts, src/styles.css, ubiq.json

Entry point: index.html loads src/main.ts which imports zone.js then bootstraps AppComponent.

YOU MUST GENERATE:
1. src/app/app.component.ts — main AppComponent (REPLACE placeholder, standalone: true, inline template+styles)
2. src/app/*.component.ts — additional standalone components as needed
3. src/app/*.service.ts — services (use inject() for DI)
4. src/app/app.routes.ts — routes array if navigation needed
5. src/styles.css — global styles (you MAY replace this)

COMPONENT RULES:
• Always standalone: true. Import CommonModule, FormsModule, RouterModule individually as needed.
• Use inline template and styles for all components: template: `...`, styles: [`...`]
• Do NOT use NgModule, BrowserModule, or AppModule — standalone only.
• Do NOT add zone.js or polyfills imports anywhere — already handled in src/main.ts.
• Decorators (experimentalDecorators) are enabled — @Component, @Injectable etc. work normally.

ROUTING: If needed, add to src/main.ts: import { provideRouter } from '@angular/router'; add to bootstrapApplication providers array.
PROMPT;
    }

    private static function nodeAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: Express 4. package.json (express ^4.18, cors ^2.8) and server.js skeleton already exist.

DO NOT REGENERATE: package.json, ubiq.json

YOU MUST GENERATE:
1. server.js — complete Express application (REPLACE the skeleton, must listen on 0.0.0.0:3000)
2. routes/*.js — route modules (imported in server.js)
3. controllers/*.js — controller functions
4. middleware/*.js — custom middleware
5. models/*.js — data models (use JSON file or in-memory store unless a DB package is added)

RULES: CommonJS (require/module.exports). Server MUST bind 0.0.0.0 on PORT env var or 3000.
PROMPT;
    }

    private static function flaskAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: Flask 3. requirements.txt (flask>=3.0.0) and app.py skeleton already exist.

DO NOT REGENERATE: requirements.txt, ubiq.json

YOU MUST GENERATE:
1. app.py — complete Flask application (REPLACE the skeleton, must run on host='0.0.0.0', port=5000)
2. templates/*.html — Jinja2 HTML templates
3. static/css/*.css, static/js/*.js — static assets

If a database is needed, add flask-sqlalchemy to requirements.txt and include model definitions in app.py.
RULES: App must bind 0.0.0.0:5000 for Docker to expose it. Include all routes, models, and templates.
PROMPT;
    }

    private static function fastapiAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: FastAPI. requirements.txt (fastapi>=0.109, uvicorn) and main.py skeleton already exist.

DO NOT REGENERATE: requirements.txt, ubiq.json

YOU MUST GENERATE:
1. main.py — complete FastAPI application (REPLACE the skeleton, must bind 0.0.0.0:8000)
2. routers/*.py — APIRouter modules for grouping endpoints
3. models/*.py — SQLAlchemy models if DB is needed (add sqlalchemy to requirements.txt)
4. schemas.py — Pydantic request/response schemas

RULES: async def for all route handlers. App MUST bind 0.0.0.0:8000.
PROMPT;
    }

    private static function djangoAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: Django 5. manage.py, config/settings.py, config/urls.py, config/wsgi.py, config/asgi.py, app/ module (with models.py, views.py, urls.py, admin.py, apps.py) already exist.

DO NOT REGENERATE: manage.py, requirements.txt, config/settings.py, config/wsgi.py, config/asgi.py, ubiq.json

YOU MUST GENERATE:
1. config/urls.py — root URL config (REPLACE, include app URLs)
2. app/views.py — all views (REPLACE the placeholder completely)
3. app/models.py — all models (REPLACE the placeholder)
4. app/urls.py — app URL patterns (REPLACE)
5. app/admin.py — register models with admin (REPLACE)
6. app/forms.py — Django forms if needed
7. templates/*.html — HTML templates (INSTALLED_APPS includes 'app', DIRS includes BASE_DIR/'templates')

RULES:
• INSTALLED_APPS already contains 'app'. ROOT_URLCONF = 'config.urls'. Database is SQLite at BASE_DIR/db.sqlite3.
• Server runs on 0.0.0.0:8000.
• Do NOT output migration files — Django generates them via manage.py makemigrations.
PROMPT;
    }

    private static function htmlAiPrompt(): string
    {
        return <<<PROMPT
Scaffold: Static site. index.html, css/style.css, js/app.js already exist.

YOU MUST GENERATE (REPLACE all placeholders completely):
1. index.html — complete, fully styled HTML page
2. css/style.css — all styles for the application
3. js/app.js — all JavaScript functionality
4. Additional *.html pages if the app needs multiple pages

RULES: Pure HTML/CSS/JavaScript only. No build tools, no npm. All asset paths must be relative (./css/style.css not /css/style.css).
PROMPT;
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private static function chmodRecursive(string $path, int $dirMode, int $fileMode): void
    {
        if (!is_dir($path)) {
            chmod($path, $fileMode);
            return;
        }
        chmod($path, $dirMode);
        $items = scandir($path);
        foreach ($items ?: [] as $item) {
            if ($item === '.' || $item === '..') continue;
            self::chmodRecursive($path . '/' . $item, $dirMode, $fileMode);
        }
    }
}