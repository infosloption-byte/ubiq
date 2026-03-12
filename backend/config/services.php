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
        'client_id' => '1058375657595-3qeslkpjie925539l5k3jaa75vdhneoa.apps.googleusercontent.com',
        'client_secret' => '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',
        'redirect' => 'https://api.ubiq-editor.space/api/v1/auth/google/callback',
    ],

    'paddle' => [
        'vendor_id' => env('PADDLE_VENDOR_ID'),
        'vendor_auth_code' => env('PADDLE_VENDOR_AUTH_CODE'),
        'mode' => env('PADDLE_ENV', 'sandbox'),
    ],

];
