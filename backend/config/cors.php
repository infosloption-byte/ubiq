<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Cross-Origin Resource Sharing (CORS) Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your settings for cross-origin resource sharing
    | or "CORS". This determines what cross-origin operations may execute
    | in web browsers. You are free to adjust these settings as needed.
    |
    | To learn more: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
    |
    */

    'paths' => ['api/*', 'sanctum/csrf-cookie', 'visit'],

    'allowed_methods' => ['*'],

    'allowed_origins' => ['https://ubiq-editor.space'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    // E4 fix (PLAN_SYSTEM_TASKS.md Phase E gap audit, 2026-08-09): the
    // frontend/backend run on different origins, so by default the browser
    // strips response headers that aren't on CORS's safelist —
    // Content-Disposition isn't on it. AuthController::exportData() sets
    // Content-Disposition with the server-generated filename
    // (ubiq-export-{username}-{date}.json) specifically so
    // PrivacyPanel.tsx's handleExport() can read it via
    // res.headers['content-disposition'], but without this it was always
    // silently empty and every export fell back to the generic client-side
    // filename. Not a crash — there's a fallback — but the intended
    // filename never made it through.
    'exposed_headers' => ['Content-Disposition'],

    'max_age' => 86400,

    'supports_credentials' => true,

];
