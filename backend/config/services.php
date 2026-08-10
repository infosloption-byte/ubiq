<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => 'https://api.ubiq-editor.space/api/v1/auth/google/callback',
    ],

    // F3 (PLAN_SYSTEM_TASKS.md Phase F): GitHub OAuth App, used to connect
    // a user's GitHub account for Source Control (createPr/importFromGithub)
    // instead of asking them to paste a Personal Access Token. Distinct
    // GitHub OAuth App from any used for "Login with GitHub" (there isn't
    // one here) — this app only ever needs 'repo' scope, requested in
    // GithubOAuthController::redirect().
    'github' => [
        'client_id' => env('GITHUB_CLIENT_ID'),
        'client_secret' => env('GITHUB_CLIENT_SECRET'),
        'redirect' => env('GITHUB_REDIRECT_URI', 'https://api.ubiq-editor.space/api/v1/auth/github/callback'),
    ],

    'paddle' => [
        'vendor_id' => env('PADDLE_VENDOR_ID'),
        'vendor_auth_code' => env('PADDLE_VENDOR_AUTH_CODE'),
        'mode' => env('PADDLE_ENV', 'sandbox'),
    ],

    'paypal' => [
        'client_id'     => env('PAYPAL_CLIENT_ID'),
        'client_secret' => env('PAYPAL_CLIENT_SECRET'),
        'mode'          => env('PAYPAL_MODE', 'sandbox'), // 'sandbox' or 'live'
        'plan_id'       => env('PAYPAL_PLAN_ID'),          // Pro plan ID from PayPal dashboard
        'webhook_id'    => env('PAYPAL_WEBHOOK_ID'),       // Webhook ID for signature verification
    ],

];
