<?php

namespace App\Http\Controllers\API\V1;

use App\Http\Controllers\Controller;
use App\Models\SandboxRun;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;

/**
 * F1d (PLAN_SYSTEM_TASKS.md Phase F / UBIQ_ENHANCEMENT_ROADMAP.md
 * "Ephemeral preview links").
 *
 * Not a route the browser ever calls directly. nginx's preview server
 * block (see nginx.conf's `preview-` server_name regex) fires this as an
 * `auth_request` subrequest for every single request to
 * https://preview-{token}.ubiq-editor.space/*, and reads this response's
 * X-Target-Host / X-Target-Port headers back out to build the actual
 * `proxy_pass` target — see nginx.conf for the full mechanism. This
 * endpoint itself proxies nothing; it only says which container:port a
 * valid, still-running token currently maps to (200) or that it doesn't
 * (404, which nginx turns into its own 404 for the visitor).
 *
 * Deliberately public (no auth:sanctum) — the person viewing a preview
 * link is very often not the project owner and has no Ubiq session at
 * all (that's the whole point of a shareable preview link). The token
 * itself is the credential; see SandboxRun::getPreviewTokenAttribute()
 * for why a signed, unstored token is enough here without a bearer auth
 * layer on top.
 */
class PreviewResolveController extends Controller
{
    public function resolve(Request $request): Response
    {
        // nginx forwards the regex-captured subdomain label as this
        // header (see nginx.conf: fastcgi_param HTTP_X_PREVIEW_TOKEN
        // $preview_token;) rather than this controller trying to parse
        // $request->getHost() itself — keeps the "which part of the
        // Host header is the token" parsing in exactly one place
        // (nginx's server_name regex), not duplicated here.
        $token = (string) $request->header('X-Preview-Token', '');

        // Format is "{run_id}-{32 hex chars}" — see
        // SandboxRun::getPreviewTokenAttribute(). Reject anything that
        // doesn't even match the shape before touching the DB or
        // computing an HMAC.
        if (!preg_match('/^(\d+)-([a-f0-9]{32})$/', $token, $m)) {
            return $this->deny();
        }

        [, $runId, $suppliedHmac] = $m;

        $expectedHmac = substr(
            hash_hmac('sha256', 'preview:' . $runId, config('app.key')),
            0,
            32
        );

        // hash_equals — constant-time, same reasoning as anywhere else
        // in this codebase a secret gets compared (see TerminalController's
        // exec_secret check use of a plain '!==' being safe there only
        // because it's a random 48-char token, not a value an attacker
        // could otherwise brute a single byte of at a time here where
        // we'd normally not need to worry either, but this is the cheap,
        // correct default for any HMAC comparison).
        if (!hash_equals($expectedHmac, $suppliedHmac)) {
            return $this->deny();
        }

        // Short cache: this fires on EVERY asset request a live preview
        // makes (HTML, JS, CSS, images, XHR — all proxied through nginx,
        // all triggering their own auth_request), so a bare DB hit per
        // request would multiply sandbox_runs load by the visitor's own
        // request count. 3s keeps "link dies when the run stops" close
        // to instant (reapStaleSandboxes/stopProject/heartbeat-timeout
        // all just stamp stopped_at — nothing here needs to know about
        // those specifically, this cache is the only thing standing
        // between a stop and the preview actually 404ing) while still
        // cutting real load by orders of magnitude for an actively
        // loading page.
        $run = Cache::remember("preview_resolve:{$runId}", 3, function () use ($runId) {
            return SandboxRun::whereKey($runId)
                ->whereNull('stopped_at')
                ->first(['id', 'container_name', 'project_id', 'internal_port']);
        });

        if (!$run || !$run->internal_port) {
            // Covers: never existed, already stopped, or a legacy row
            // from before internal_port existed (see that migration's
            // docblock — no way to resolve those, same as exec_secret's
            // precedent for pre-migration rows).
            return $this->deny();
        }

        return response('', 200)
            ->header('X-Target-Host', $run->docker_name)
            ->header('X-Target-Port', (string) $run->internal_port);
    }

    private function deny(): Response
    {
        return response('', 404);
    }
}
