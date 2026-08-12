# Plan / Tier System — Implementation Tracker

Update this file in the same commit as the work it describes. Mark `[x]` when
done, add the commit hash next to it, and add short notes if a task changed
scope from what was originally planned.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

**Status as of 2026-08-12: Phases A–E complete. Phase F (Enhancement
Roadmap) in progress — F0 (P0 sandbox slot leak) done, F0c (Terminal
panel using stale pre-F0b container name) done, F3 (GitHub OAuth) done
except F3e stretch, G1 (usage dashboard) done except G1d stretch,
F1a/F1c/F1d/F1e/F1f/F1g done, F1b reverted (see notes), F1h (new
Sandboxes list page) done, G2 next.**
Phase F tracks `UBIQ_ENHANCEMENT_ROADMAP.md` — prioritized and broken
into implementable tasks below. Work it top-to-bottom; the order
already reflects priority (retention-critical → differentiation →
self-hosted → later/earn-it), so don't reorder without a
decisions-log entry explaining why. See the dated log entries below
each phase for implementation notes, and "Decisions made" sections
for anything that required a judgment call along the way.

---

## Phase A — Database Migrations

- [x] A1 — Core plan tables: `plans`, `plan_features`
- [x] A2 — User/plan linkage: `users.plan_id` FK + `user_plan_overrides` table
- [x] A3 — Usage counters: `usage_counters` table (fast increment/check path)
- [x] A4 — Audit log: `plan_action_logs` table
- [x] A5 — Seeders: seed 4 plans (free/starter/creator/pro) + their features, re-runnable upsert

## Phase B — Backend

- [x] B1 — `PlanService`: load + cache plan limits, resolve overrides
- [x] B2 — `PlanGuard`: central check/authorize chokepoint, fail-closed, writes to `plan_action_logs`
- [x] B3a — Wire `PlanGuard` into `ai.request` (CompletionController/AiController) — first action, lowest risk
- [x] B3b — Wire `PlanGuard` into `sandbox.start` (ProjectController::runProject) + release on stop/cleanup
- [x] B3c — Wire `PlanGuard` into `project.create`
- [x] B3d — Wire `PlanGuard` into `sharing.enabled` / model tier access
- [x] B3e — Global concurrency ceiling check (total active sandboxes vs. box capacity)
- [x] B4 — Retire old scattered logic: `CompletionController::$rateLimits` array, `available_models.tier_required` direct checks, `subscription_tier` column
- [x] B5 — Admin CRUD endpoints: `GET/POST/PUT /admin/plans`, `/admin/plans/{id}/features`
- [x] B6 — Reporting helpers against `plan_action_logs` (denial rate by tier/action, usage percentiles)

## Phase C — Frontend

- [x] C1 — Usage widget: `GET /me/usage`, live counts vs. limits in admin/user dashboard
- [x] C2 — Structured limit-hit handling: denial payload → friendly upgrade prompt (not generic 429 toast)
- [x] C3 — Public pricing page sourced live from `GET /plans`
- [x] C4 — Upgrade/downgrade flow via PayPal, webhook updates `users.plan_id`, downgrade-over-limit policy (grandfather existing, block new)
- [x] C5 — Internal admin UI to edit `plan_features` values directly

## Phase D — ProjectEditorPage Reliability & Panel Fixes

Found during a routine review of `frontend/src/pages/ProjectEditorPage.tsx`,
unrelated to the Plan/Tier system itself but tracked here since it's the only
active tracker in this repo. Ordered by urgency (data-loss / correctness
first) and security, not by discovery order.

- [x] D0a — Right panel (Chat ↔ Sandbox Runner) tab switch was unmounting the
      inactive component via a ternary, resetting `ProjectRunner`'s live
      state (logs, polling, preview URL) every time you switched to Chat and
      back — required a full re-run to see logs again.
- [x] D0b — Same bug, `TerminalPanel`: hiding the terminal (`showTerminal`
      toggle) unmounted it entirely, wiping command history and output.
- [x] D1 — **[data loss]** File-switch/tab-close silently discards unsaved
      manual edits. Only AI-proposed diffs (`proposedContent`) were guarded
      by the discard-confirmation dialog; plain typed edits had no dirty
      check at all.
- [x] D2 — **[data integrity]** Stale-response race in `loadFileContent`:
      switching files quickly (before the previous file's fetch resolves)
      can let an old file's content land in the editor under the new file's
      tab, since there's no request-id/cancellation guard.
- [x] D3 — **[perf/cost, grows over a session]** Monaco inline-completion
      provider is re-registered on every file switch (editor remounts via
      `key={editor-${activeFile.fileId}}`) but the returned disposable is
      never stored/disposed. Long sessions accumulate duplicate global
      providers, each independently firing `aiAPI.completion` per keystroke.
      _(Backend cross-check: this endpoint is PlanGuard-gated on `ai.request`
      — see 2026-08-06 decision-log entry, no backend bug, but pre-fix
      sessions over-consumed each user's real rate-limit allowance.)_
- [x] D4 — **[data integrity, edge case]** Concurrent `Ctrl+S` saves aren't
      guarded — two in-flight `fileAPI.update` calls can resolve out of
      order, with the later-arriving response's content winning regardless
      of which was actually sent last.
- [x] D8 — **[security]** ~~AI provider keys and the remote Ollama URL are
      stored in plaintext `localStorage`~~ Fixed: google/openai/openrouter/
      mistral BYOK secrets now live server-side, encrypted at rest, via
      `App\Models\UserAiKey` — never round-tripped back to the browser after
      the initial save. Ollama URLs (local/remote) deliberately left as
      client-supplied per-request connection targets, not secrets — see the
      2026-08-07 decision-log entry for the full reasoning. Originally
      scoped as informational-only; upgraded to an actual fix per request.
- [x] D5 — Blocking `alert()` used for "Connection URL updated!", "Please
      open a file," "Select some code first." — jarring UX, not a toast.
- [x] D6 — `closeTab` always reactivates the *last* tab in the list rather
      than the tab adjacent to the one just closed.
- [x] D7 — `sidebarWidth`/`chatWidth` aren't persisted to localStorage the
      way open tabs are — resets on every reload.

---

## Phase F — Enhancement Roadmap (`UBIQ_ENHANCEMENT_ROADMAP.md`)

Source doc: `UBIQ_ENHANCEMENT_ROADMAP.md` (prepared 2026-08-09). That
file is the rationale/spec; this section is the flattened,
priority-ordered task list derived from it, following its own
"Suggested build order" exactly. Each task below cites the roadmap
section it comes from (F1a, G2c, etc.) — read that section in the
roadmap before starting the task for the full reasoning, file-level
detail, and sequencing notes; this tracker intentionally doesn't
duplicate all of it.

**Priority order (why this order, not roadmap document order):**
1. **F0 — P0 sandbox-slot leak.** Live bug actively costing Pro
   conversions today. Ahead of every feature below, no exceptions —
   fix bugs bleeding revenue before building anything new.
2. **F3 — GitHub OAuth.** Smallest, cleanest lift (reuses the existing
   Google OAuth + `UserAiKey` encryption pattern), and the one item
   with an active, verified security hole (plaintext PAT in
   `localStorage`) rather than just a missing feature.
3. **G1 — Usage dashboard.** Best effort-to-trust payoff on the whole
   list — data already exists (`usage_counters`, `plan_action_logs`),
   this is a read/UI layer over it. Can ship while F1 is in progress.
4. **F1 — Full-stack sandbox parity + portable export.** The real
   engineering lift. Internally sequenced a→b→c→d per the roadmap
   (a is small and standalone; b is the real work everything else
   depends on; c depends on b; d can run parallel to b/c).
5. **G2 — Multi-file diff review + autonomy modes.** The headline
   differentiator, deliberately sequenced *after* the retention-critical
   items above so it's not competing for time against things actively
   losing customers right now. Internal order a→b→c→d is load-bearing
   (see sequencing note under G2) — do not start G2c before G2a/b ship.
6. **G3 — Self-hosted/on-prem tier.** Sales-and-docs-heavy, wants a
   track record from 1–5 behind it first.
7. **Bucket 3 — Later/earn it** (collab, SSO, admin analytics). No
   task breakdown yet on purpose — revisit once a team/enterprise plan
   exists to sell them into. Admin analytics is the one item that can
   move earlier opportunistically since G1a's aggregation makes it
   nearly free once G1 ships.

Explicitly *not* front-loaded, per the roadmap: custom domains / full
production hosting (deliberately cut from F1, not deferred — see the
correction note in the roadmap's F1 intro), and SSO/collab (gated on a
team plan that doesn't exist yet).

- [x] **F0 — Fix concurrent sandbox slot leak on re-run** *(P0, do first)* — 2026-08-09, commit `<fill in after commit>`
  - [x] F0a — In `runProject()` (`ProjectController`), close out any
        existing open `SandboxRun` for the same project before
        `authorize()` — reuse `stopProject()`'s close-out logic so
        re-running a project always self-releases its own previous
        slot atomically.
  - [x] F0b — Include the run ID (not just project ID) in the sandbox
        container name, so `reapStaleSandboxes()` can tell an old run's
        container apart from a new one in genuine edge cases (crash,
        browser closed mid-session).

- [x] **F0c — Fix `TerminalController` using the pre-F0b container name** *(found 2026-08-11, same class of bug as F0)* — see 2026-08-11 decision-log entry.
  - [x] Resolve the container name from the project's open `SandboxRun`
        (`$run->docker_name`) instead of the hardcoded, pre-F0b
        `"ubiq_project_{$project->id}"` string that F0b already made
        stale everywhere else.
  - [x] Verify the resolved container is actually `docker ps` alive
        before exec'ing into it, and return a clear, actionable message
        ("click RUN" / "click RESTART") instead of silently trying to
        exec into a nonexistent container.
  - [x] Remove the controller's own separate `startContainer()`
        auto-heal fallback (generic base images, no Dockerfile, no
        `SandboxRun` bookkeeping — a second, drifting reimplementation
        of sandbox boot that predates F1a/F1c and was the root cause
        pattern here). Starting a sandbox now stays the sole
        responsibility of `ProjectController::runProject()`.

- [x] **F0d — Terminal panel still didn't work after F0c** *(found 2026-08-11,
      F0c's own "not yet done" smoke test caught the real remaining bug)*
      — see 2026-08-11 decision-log entry.
  - [x] Root cause: F0c fixed the container-name lookup, but the
        `docker exec` call itself is rejected outright by the
        socket-proxy (`EXEC: 0`, see docker-compose.yml's FIX #9 note) —
        every command was failing at the daemon boundary, independent of
        which container name was used.
  - [x] Fix: each sandbox container now runs its own tiny command
        listener (started in `generateStartupScript()`, right before any
        runtime-specific install step), reachable only over the internal
        `ubiq_sandbox` network by container name — no Docker API call
        involved, so `EXEC: 0` has no bearing on it either way. Gated by
        a per-run secret (`sandbox_runs.exec_secret`, new column) so
        reaching the listener isn't enough on its own to run something.
  - [x] `TerminalController::execute()` now talks to that listener over
        a plain TCP socket instead of shelling out to `docker exec`.
  - [x] `ubiq_api` joins the pre-existing `ubiq_sandbox` network in
        `docker-compose.yml` so it can resolve sandbox containers by
        name — a static compose network membership, unaffected by the
        socket-proxy either.
  - [ ] Not yet done: the same real-Docker-host smoke test F0c's entry
        flagged as missing — no Docker in this environment to run one.
        Before shipping: start a project, confirm the "Exec listener up
        on :7411" line appears in Live Server Logs, run a command in the
        Terminal panel, then stop the sandbox and confirm the panel falls
        back to its "click RUN"/"click RESTART" messages correctly.

- [x] **F3 — GitHub OAuth (replace pasted PATs)** — 2026-08-09, F3a–F3d done, F3e stretch not started
  - [x] F3a — Register GitHub OAuth App; add `GET /auth/github/redirect`
        and `GET /auth/github/callback`, mirroring
        `AuthController::handleGoogleCallback`. *(Implemented as
        `POST /auth/github/connect` + `GET /auth/github/callback` — see
        2026-08-09 decision-log entry for why the initiating endpoint
        ended up POST+authenticated rather than a plain GET redirect.)*
  - [x] F3b — Store the token server-side encrypted — either a
        `provider = 'github'` row on the `UserAiKey`-style table, or a
        small dedicated `user_github_tokens` table if GitHub's
        refresh-token/scope handling doesn't fit the generic shape.
        *(Went with the dedicated table — see decision-log entry.)*
  - [x] F3c — Cut over call sites: `SourceControlPanel.tsx`
        (`localStorage.getItem('ubiq_api_keys')`) and
        `ProjectController::importFromGithub()` (`github_token` request
        param) both read the server-stored token; token never
        round-trips to the browser.
  - [x] F3d — Migration path: on first Source Control action post-ship,
        detect a legacy `localStorage` token, prompt one-time re-auth
        via the new OAuth flow, then clear the old `localStorage` value.
  - [ ] F3e — Stretch: repo picker UI using the real OAuth token scopes,
        instead of pasting a repo URL by hand. *(Not started — the
        connect/disconnect plumbing this depends on is now in place,
        so this is a smaller follow-up whenever it's prioritized.)*

- [x] **G1 — Usage transparency dashboard** — 2026-08-09. Most of this
      turned out to already be built under Phase C1/C2/E2b, before the
      roadmap was written — see the 2026-08-09 decision-log entry for
      what was found already in place vs. what was actually new work.
  - [x] G1a — `GET /user/usage-summary`: current-window counts vs. caps
        per `counter_key`, plus last N `plan_action_logs` denials for
        the authenticated user. Pull cap values through `PlanGuard`'s
        own lookup (never duplicate limit numbers elsewhere) — and
        write the aggregation so it generalizes to instance-wide later
        (see G1d / Bucket 3 admin analytics), not as a strictly
        per-user query. *(The counts-vs-caps half already existed as
        `GET /user/plan-usage`, built in Phase C1/E2b — not a new
        endpoint. Only the denials list was actually added here.)*
  - [x] G1b — Frontend "Usage" panel (Settings or its own nav item):
        one bar/ring per `counter_key`, hour/day windows shown
        separately, plain-language line when at/recently hit a cap.
        Map `reason` enum values (`concurrent_limit_exceeded`,
        `plan_lookup_failed`, etc.) to real sentences. *(The bars/
        rings/hour-day split already existed as `PlanUsageWidget.tsx`
        — Phase C1/E2b again. Only the "Recent limits hit" denials
        list is new; it reuses the same `REASON_COPY` mapping G1c
        already had, exported for that purpose.)*
  - [x] G1c — Surface the same human-readable reason at the point of
        failure (chat input, "start sandbox" button), not only in the
        dashboard. *(Already fully done — Phase C2's global axios
        interceptor + `REASON_COPY` in `planLimitStore.ts` catches
        every 429/403 with a `reason` field and shows a mapped message
        via a shared modal, regardless of which action triggered it.
        Nothing added here; G1b above now reuses this same table.)*
  - [ ] G1d — (stretch, low priority) Confirm G1a's aggregation query
        generalizes cleanly instance-wide, to save rework when Bucket
        3's admin analytics gets picked up. *(Not re-verified — the
        recent-denials query added for G1a is a plain per-user
        `WHERE user_id = ?`, would need an instance-wide variant with
        its own pagination/limits when Bucket 3 gets picked up, not
        just dropping the WHERE clause.)*

- [ ] **F1 — Full-stack sandbox parity + portable export**
  - [x] F1a — Externalize the real Dockerfile: generate it from the
        same framework-detection logic currently only living as an
        in-memory PHP array in `runProject()`, write it into the
        project's own workspace directory (alongside `ubiq.json`) so
        the existing `download()` zip ships it automatically. No
        changes needed to `download()` itself. — 2026-08-10, see notes
  - [~] F1b — Multi-service sandboxes via `docker-compose`: attempted,
        hit a real infra wall on the socket-proxy (NETWORKS:0 blocks GET
        too, and compose needs that regardless of `network_mode`),
        reverted live execution back to plain `docker run`. Re-scoped:
        see F1c below for the actual path to "app + db together"
        that doesn't need compose as the execution engine. Portable
        *export* `docker-compose.yml` (written into the workspace,
        shipped via download) kept — that part never touched the
        socket-proxy and is still useful on its own. — 2026-08-11,
        see notes for the full story
  - [x] F1c — DB service in the sandbox, re-scoped: NOT via
        `docker compose` (see F1b above — the socket-proxy makes
        compose-as-execution-engine a real security trade-off for no
        current benefit). Instead: a second `docker run
        --network=ubiq_sandbox ...` for the `db` container, same
        mechanism the existing `app` container already uses
        successfully — no Networks-API call either way, so no proxy
        change needed. Both containers tracked under the same
        `SandboxRun`/project; still one slot against
        `SANDBOX_GLOBAL_CONCURRENT_LIMIT` regardless of container
        count, per the original scoping. Storage: almost certainly hits
        the same `VOLUMES:0` GET-is-blocked-too problem a named Docker
        volume would — plan a bind-mount into a project-scoped host
        directory from the start (same approach the app's own source
        files already use) rather than `docker volume create`. The
        *exported* `docker-compose.yml` (F1b's export half) can still
        gain a `db:` service for portability even though live execution
        stays on two `docker run` calls — export and live execution are
        already two different code paths, so this isn't a new split.
        — 2026-08-11, see notes. Scoped to Laravel only + opt-in via
        new `db_engine` project column, both deliberate narrowings not
        in the original wording — see notes for why.
  - [x] F1d — Ephemeral preview links: signed token derived from a
        running `SandboxRun` row, resolving
        `preview-{token}.ubiq-editor.space` proxied to that run's
        allocated port; link dies the moment existing reaping logic
        marks the run stopped. Needs one-time wildcard cert
        (`*.ubiq-editor.space` via certbot DNS-01). Can be built in
        parallel with F1b/F1c — only depends on existing `SandboxRun`
        tracking. No deploy history/rollback/uptime story by design.
        `nginx.conf`'s regex `server_name`/`auth_request`/
        `PreviewResolveController` chain deployed and token resolution
        itself works — a live preview URL now generates and loads a
        page. Two things still broken before this can ship, both at
        the **master_nginx** layer (outside this repo, not yet
        located/fixed — see notes): (1) no wildcard cert exists yet for
        `*.ubiq-editor.space`, so every preview link is served under
        the wrong cert (`NET::ERR_CERT_COMMON_NAME_INVALID`); (2)
        master_nginx has no `server_name` match for the
        `preview-*.ubiq-editor.space` pattern at all, so TLS-terminated
        requests are falling through to whatever vhost is acting as
        the default/fallback server — confirmed landing on the **Asset
        Tracking** project instead of the sandbox's own dev server.
        Same root-cause family (missing/wrong routing at a layer this
        repo doesn't control) as the frontend-container regression
        this same nginx.conf rewrite caused — see notes. The sandbox
        UI's apparent "logs disappeared" symptom traced to the SAME
        cause (see notes) — `ProjectRunner.tsx`'s `isMixedContent`
        check correctly switched to its https-iframe branch once
        preview links became `https://`, it's just embedding a URL
        still broken by (1)/(2) above; no frontend fix needed once
        those land. — 2026-08-11, see notes
        **DONE — 2026-08-12, see F1e/F1f notes below.** master_nginx
        wildcard cert + routing landed; then two more bugs found and
        fixed against the real preview flow: **F1e** —
        `auth_request`'s `fastcgi_params` include ordering was
        clobbering `REQUEST_URI` back to the visitor's own URL, so
        `PreviewResolveController` was never actually reached (see
        note). **F1f** — after F1e shipped, symptoms persisted because
        `ubiq_nginx`'s single-file bind mount was pinned to a stale
        inode from before the fix and needed `--force-recreate`, not
        just a config reload (see note). Once both landed, preview
        links load correctly. Frontend note: `ProjectRunner.tsx`'s
        auto-embedding iframe branch (dead code while preview links
        were `http://`, per the note above) turned out to actively
        need disabling once links became reachable `https://` — it
        was `z-20` over the log terminal's `z-10` and silently covered
        it every run; reverted to the intended logs + "Open Preview in
        New Tab" UX unconditionally (see note).

- [x] **F1h — Sandboxes list page** *(new left-nav page, not from the
      original roadmap doc — added directly per product ask, sequenced
      here since it's a thin UI/read layer over the `SandboxRun`
      tracking F0-F1d already built, not new sandbox-lifecycle logic)*
      — 2026-08-12, see notes below
  - [x] Backend: `SandboxController` (`GET /sandboxes`,
        `POST /sandboxes/{sandboxRun}/stop`) — cross-project inventory
        of a user's `SandboxRun` rows, reconciled against live
        `docker inspect`/`docker stats` per row (so a DB-open row whose
        container actually died reports as "crashed", not a false
        "running"), plus recent stopped-run history and usage vs.
        `sandbox.max_concurrent` (reuses `PlanGuard::remaining()`).
        `stop()` mirrors `ProjectController::stopProject()`'s
        kill → verify → stamp → release sequence exactly, addressed by
        run id instead of "project's latest run" since this list spans
        multiple projects at once.
  - [x] Frontend: new `SandboxesPage.tsx`, new "Sandboxes" left-nav
        item in `Layout.tsx` (between Projects and AI Chat), new
        `/sandboxes` route in `App.tsx` (same auth + `SubscriptionGuard`
        pattern as `/projects`). UI/UX deliberately mirrors
        `ProjectsPage.tsx`'s card grid (same header, search bar, empty
        state, card shell) rather than inventing a new layout language.
        Each card shows status (running/stopped/crashed), live
        CPU/Memory/Network/health vitals, live uptime, and a Stop
        action (confirm dialog via the existing `ConfirmDialog`); a
        collapsible history list covers recently-stopped runs. Polls
        `GET /sandboxes` every 10s for live vitals/health drift.

- [ ] **G2 — Multi-file diff review screen + user-controlled autonomy**
  - [ ] G2a — Build the batch review screen: file list with
        +added/−removed stat and New/Modified/Deleted badge per file;
        click opens diff in the existing Monaco `DiffEditor` (reused,
        not rebuilt); per-file Accept/Reject plus Accept All/Reject
        All; protected-scaffold files (`getProtectedPaths()`) visually
        flagged and blocked from silent overwrite regardless of
        autonomy mode. Nothing writes to disk until confirmed. Prove
        this on the already-safe single-file chat Apply path before
        touching `generate()`.
  - [ ] G2b — Rewire `CompletionController::generate()`'s final step
        from immediate `file_put_contents()` to "return proposed file
        set to frontend, open G2a with it." Extend `chat()` so
        multi-file-implying responses also return a structured
        multi-file payload routed through G2a, instead of only ever
        offering one Apply button for the currently-open file.
  - [ ] G2c — User-controlled autonomy setting (per-project + global
        default in Settings), three modes: **Always review** (default;
        only mode on Free/Starter), **Auto-apply except protected/
        user-marked-sensitive files** (`.env`, migrations,
        `package.json`, plus framework protected-scaffold list always
        stop for review), **Fully autonomous** (Creator/Pro only,
        no review screen). Store on `UserPreference.editor_settings`
        (extend existing JSON column, no new table) with per-project
        override. Log every AI-initiated write to `plan_action_logs`
        with before/after content references in every mode, including
        fully-autonomous.
  - [ ] G2d — UX polish (after a–c are functionally solid): AI
        activity indicator during multi-file generation (extend the
        existing single-file "Reading: App.jsx" pattern); one-click
        revert for an already-accepted change using G2c's before/after
        log; short natural-language change summary above the G2a file
        list.

- [ ] **G3 — Self-hosted / on-prem tier** *(after 1–5 above are live with real users)*
  - [ ] G3a — Audit the existing `docker-compose.yml` end to end for
        anything fine on a trusted single-operator dev box but not an
        arbitrary customer's production environment (default
        passwords, open ports, missing resource limits).
  - [ ] G3b — Turn hardcoded infra values into a first-run setup step:
        `nginx.conf`'s `server_name ubiq-editor.space`, the CORS
        `allowed_origins` in `backend/config/cors.php`, and the
        wildcard-subdomain preview assumption from F1d — interactive
        script or documented `.env` pass, not hand-edited config files.
  - [ ] G3c — Lightweight license-key check (signed token, checked
        periodically) against a licensing endpoint on your own infra —
        no heavyweight DRM.
  - [ ] G3d — Decide and document support/SLA terms for self-hosted
        customers before the first sales conversation (response-time
        SLA, support channel, what "supported version" means).

- [ ] **Bucket 3 — Later / earn it** *(no task breakdown yet — revisit once a team/enterprise plan exists)*
  - [ ] Real-time collaborative editing (Yjs + sync server, presence,
        conflict handling) — gated on a team/multi-seat plan existing;
        none does today (`Plan` model has no multi-seat concept).
  - [ ] SSO (SAML/OIDC) — bundle with G3 (self-hosted); same buyer
        segment.
  - [ ] Admin analytics UI — builds on G1a's aggregation (G1d) once
        live; instance-wide view over the same `usage_counters`/
        `plan_action_logs` data. Can move earlier opportunistically.

---

## Notes / decisions log

(Add dated entries here when a design decision changes mid-build — e.g. a
feature_key gets renamed, a limit default changes, a phase gets reordered.)

- 2026-08-11 — F1d's `nginx.conf` rewrite (consolidating three
  `server` blocks into one file so the preview regex `server_name` +
  `resolver` could share an nginx instance) broke the live root
  domain. Reported as: `https://ubiq-editor.space/` returning a plain
  nginx `500 Internal Server Error` page (nginx/1.31.2 default error
  page, not a Laravel error) immediately on landing the change.
    - **Root cause:** the rewrite changed the `ubiq-editor.space`
      server block from proxying to the `frontend` container to
      serving static files directly (`root /var/www/frontend;
      try_files $uri $uri/ /index.html;`). The `nginx` service in
      `docker-compose.yml` only mounts `./backend:/var/www/html` — it
      has no volume, bind mount, or build step that puts anything at
      `/var/www/frontend`. That path never existed inside the
      `ubiq_nginx` container, so `try_files` against a nonexistent
      root threw nginx's own internal 500 before the request ever
      reached PHP-FPM or app code. The actual built frontend assets
      were sitting the whole time in the separate `frontend` container
      (its own `nginx:alpine`, own `nginx.frontend.conf`, serving
      `/usr/share/nginx/html`) — already on `ubiq-net`, just no longer
      reachable from anywhere.
    - **Fix:** reverted that block to `proxy_pass http://frontend:80;`
      (plus standard `X-Forwarded-*`/`Host` headers) instead of
      `root`/`try_files` — same container-name-resolves-via-Docker's-
      embedded-DNS pattern already used for `api:9000` fastcgi two
      blocks down. No new volumes, mounts, or build changes needed;
      the working nginx was already there, just unproxied. Root domain
      confirmed back up after this.
    - **Still open, found while re-testing after the fix above (not
      yet fixed, both outside this repo):** (1) a generated preview
      link (`preview-{token}.ubiq-editor.space`) loads over HTTPS with
      `NET::ERR_CERT_COMMON_NAME_INVALID` — no wildcard cert for
      `*.ubiq-editor.space` has actually been issued yet (F1d's own
      task text flagged this as needed, just hadn't been done). (2)
      more concerning: the page that *does* load under that mismatched
      cert is the **Asset Tracking** project's login screen, not the
      sandbox's own dev server — meaning master_nginx (the host-level
      TLS-terminating reverse proxy in front of every project's
      container, not part of this repo) has no `server_name` entry
      matching `preview-*.ubiq-editor.space` at all, so the request is
      falling through to whatever vhost is currently acting as
      master_nginx's default/fallback server, which happens to be
      Asset Tracking's. Both need a wildcard cert (DNS-01) and a
      matching master_nginx `server_name`/`proxy_pass` block added at
      that layer, routing to 127.0.0.1:8082 same as the plain
      `ubiq-editor.space` domain already does — this repo's own
      `nginx.conf` regex/`auth_request`/token-resolution chain is
      confirmed working once a request actually reaches it.
    - **Follow-up same session — turned out to be the SAME bug, not a
      second one:** the sandbox UI's "Sandbox Server" panel appeared
      to lose its live server logs and inline "Open Preview" link
      after a run. Traced to `ProjectRunner.tsx`'s `isMixedContent`
      check (`https:` page + `http:` previewUrl) — pre-F1d preview
      URLs were plain `http://`, which tripped that check and kept
      the component on its Log Terminal branch (block 1, with its own
      "Open Preview in New Tab" link) since browsers won't embed HTTP
      in an HTTPS iframe. F1d's `https://preview-{token}...` links
      correctly clear that check, so the component now switches to
      its success-iframe branch (block 3) as designed — but the
      iframe is loading a URL still broken by the cert/routing issue
      above, so it just renders the browser's own native "page might
      be temporarily down" error inside the iframe. Header's "Open
      Tab" link (unconditional on `previewUrl`, separate from block
      1's mixed-content-only one) is still rendering the whole time,
      just pointing at that same broken URL. No frontend code change
      needed here — once the wildcard cert + master_nginx routing is
      fixed, this resolves on its own. Worth a follow-up hardening
      pass later regardless: there's currently no fallback UI at all
      if a *genuinely* broken preview URL ever reaches the iframe
      branch again (e.g. run stopped mid-view) — iframes can't
      reliably signal cross-origin load failure back to the parent,
      so there's no "having trouble? view logs" escape hatch once
      you're past the mixed-content branch.

- 2026-08-11 — F1d, continued: with the master_nginx wildcard-cert +
  routing fix live (added a `preview-*.ubiq-editor.space` server block
  to `master_nginx`'s `ubiq.conf`, TLS via the new `certbot --manual
  --preferred-challenges dns` wildcard lineage
  `ubiq-editor.space-0001`, `proxy_pass`ing to the same
  `127.0.0.1:8082` the root domain already uses), the cert/routing
  layer confirmed fixed — but preview links then hit a plain nginx 500
  again, this time from *inside* `ubiq_nginx`'s own `nginx.conf`
  (the container this repo actually controls). Two compounding bugs,
  both in the F1d `auth_request` chain itself:
    - **Bug A:** `auth_request /_preview_resolve;` fired at a path that
      was never actually registered. `routes/api.php`'s
      `Route::get('/internal/preview-resolve', ...)` reads like a bare
      path, but `bootstrap/app.php`'s `api:` entry gives every route
      in that file an implicit `/api` prefix, and the file's own
      `Route::prefix('v1')` group adds `/v1` on top — so the real,
      effective path is `/api/v1/internal/preview-resolve`. Every
      token, valid or not, was hitting Laravel's own unmatched-route
      404.
    - **Bug B, the one that actually produced the raw 500 (would have
      bitten even with Bug A fixed):** nginx's `auth_request` module
      only ever passes through `2xx`, `401`, or `403` from the
      subrequest to the visitor — *any other status, 404 included,
      becomes a flat 500 before `error_page` ever gets a chance to
      remap it.* `PreviewResolveController::deny()` was returning 404
      for an invalid/stale token, so even a correctly-routed "this
      token doesn't exist" response would still have 500'd instead of
      showing the intended "invalid or no longer active" message —
      the original `error_page 401 403 404 = @preview_not_found` line
      was written assuming 404 flows through normally, which
      `auth_request` never allows.
    - **Fix:** `nginx.conf`'s `location` and `auth_request` both
      updated to the real `/api/v1/internal/preview-resolve` path;
      `PreviewResolveController::deny()` changed to return `403`
      instead of `404`; `error_page` mapping narrowed to `401 403`
      (404 dropped — it can never legitimately arrive here now, auth
      subrequests only ever produce 2xx/401/403 by design). Not yet
      re-verified live against an actual running sandbox after this
      specific edit — next step once deployed is generating a fresh
      preview link and confirming both the happy path (loads the real
      sandbox) and the deliberate-failure path (an expired/garbage
      token shows the friendly message, not a raw 500).

- 2026-08-11 — F0c (Terminal panel exec'ing into a nonexistent
  container) found and fixed. Reported as: "Sandbox is running (Live
  Server Logs shows it serving fine), but the Terminal panel says
  `Error response from daemon: No such container: ubiq_project_16`
  for every command."
    - **Root cause:** `TerminalController::execute()` still hardcoded
      `$containerName = "ubiq_project_{$project->id}"` — the
      project-scoped (not run-scoped) naming scheme from *before* F0b
      (2026-08-09) switched every other container-touching call site
      over to `SandboxRun::docker_name`. After F0b shipped, a project's
      real running container is named
      `ubiq_project_{id}_run{run_id}`; nothing is ever named the bare
      `ubiq_project_{id}` form for an active run anymore (that string
      only still means anything as `docker_name`'s legacy fallback for
      rows created before the F0b migration). `TerminalController` was
      the one call site F0b's cleanup pass missed, so it was — and
      always would be, for any project run after 2026-08-09 — checking
      for a container name nothing is ever given.
    - **Compounding factor, not the root cause but worth recording:**
      on a cache miss, the controller tried to "auto-heal" by booting a
      *replacement* container via its own `startContainer()` — a
      second, independent reimplementation of sandbox boot (generic
      `node:20-alpine`/`composer:2.7`/`python:3.11-alpine` images, no
      `BoilerplateManager`/Dockerfile involvement, no framework
      detection beyond a crude file-existence check, and critically no
      `SandboxRun` row created or updated at all). This predates F1a's
      Dockerfile externalization and F1c's db-companion work entirely,
      and had clearly drifted out of sync with the real boot pipeline
      in `ProjectController::runProject()` — exactly the failure mode
      "two copies of boot logic" tends to produce. Even if the naming
      bug hadn't existed, this fallback would have started an
      untracked container the rest of the platform (usage counters,
      concurrency limits, stop/cleanup, F1c's db pairing) has no
      knowledge of.
    - **Fix:** `TerminalController::execute()` now looks up the
      project's currently open `SandboxRun`
      (`whereNull('stopped_at')->latest('id')->first()`) and uses its
      `docker_name` accessor — the same pattern every other call site
      already uses post-F0b. If no open run exists, or `docker ps`
      shows the resolved container isn't actually alive, it returns a
      clear 409 with an actionable message ("click RUN" / "click
      RESTART") instead of guessing or silently exec'ing into nothing.
      The old `startContainer()` auto-heal method (both the live
      version and the larger dead, commented-out first draft above it)
      was deleted outright — starting a sandbox stays the sole
      responsibility of `runProject()`, so there's only ever one place
      that logic can drift from.
    - **Not yet done:** a real smoke test against a live Docker host
      (no Docker in this sandbox to run one) — before shipping, start a
      project, open the Terminal panel, confirm a command actually
      reaches the running container, then stop the sandbox and confirm
      the panel now returns the "click RUN" message instead of a raw
      Docker error.

- 2026-08-11 — F0d found and fixed, same terminal-panel report as F0c,
  after F0c's own container-name fix turned out not to be the whole
  story. Reported as: exec'ing into the correct, live container now (no
  more "No such container"), but commands still silently produced no
  output.
    - **Root cause:** `TerminalController::execute()` shells out via
      `Process::run("docker exec ...")`, and `ubiq_api`'s `DOCKER_HOST`
      points at the socket-proxy sidecar added for FIX #9 — which has
      `EXEC: 0` (see docker-compose.yml). The proxy accepts `docker ps`/
      `docker inspect` (both used a few lines earlier in the same
      method, which is why those checks kept working and the failure
      looked container-name-shaped rather than proxy-shaped) but flatly
      rejects exec, by design, for every container, not just other
      users'. `getBuildLog()`'s own docblock had already noted this
      ("docker exec ... is rejected by the socket-proxy (EXEC: 0), so
      that's not available either") in the context of crash detection —
      this is the same wall, just hit from a second call site.
    - **Why not just set `EXEC: 1`:** that flag is global on the proxy —
      it can't be scoped to "only this container, only for a request
      already authenticated as that container's owner". `EXEC: 1` would
      mean any code path in Laravel, for any reason, can exec into any
      sandbox container on the box. `TerminalController`'s own
      `$project->user_id !== $request->user()->id` check is the only
      thing that would stand between "user runs a command in their own
      sandbox" and "user runs a command in someone else's" in that
      world, and that check only holds if Laravel itself hasn't been
      compromised through something entirely unrelated (an injection, an
      auth bypass) — exactly the scenario FIX #9 introduced the proxy to
      contain in the first place. Reverting `EXEC` to `1` to fix a
      terminal bug would undo that.
    - **Fix — a listener scoped to one container instead of a daemon
      capability scoped to none:** `generateStartupScript()` now emits a
      small snippet, run first (before any runtime-specific package
      install, so the terminal doesn't sit dead through a slow `npm
      install`), that `apk add`s `socat` and starts
      `socat TCP-LISTEN:7411,reuseaddr,fork SYSTEM:/tmp/.ubiq_exec_handler.sh`
      in the background. That handler script (written to `/tmp` by the
      container itself at boot via a heredoc, never touching the
      bind-mounted `/app` workspace, so it never shows up in the file
      tree) reads two newline-terminated lines — a shared secret, then
      the command base64-encoded — and only runs the command if the
      secret matches `$UBIQ_EXEC_SECRET`. Deliberately not real HTTP:
      parsing HTTP requests correctly in POSIX `sh` (Alpine's `/bin/sh`
      is `ash`, not `bash` — no `/dev/tcp`, as the F1c db-wait-loop note
      already established) is much more surface area to get wrong than
      two `read -r` lines.
    - `sandbox_runs` gets a new nullable `exec_secret` column
      (migration `2026_08_11_000004`), generated once per run in
      `claimPortAndReserve()` (`bin2hex(random_bytes(24))`) and injected
      into the container as `UBIQ_EXEC_SECRET` in `runProject()`'s
      `docker run` — same env-var mechanism `PORT` already uses there.
      Added to `SandboxRun::$hidden` so it can never leak out through an
      incidental `toJson()`/API response; only `TerminalController` and
      the container itself ever see it.
    - `TerminalController::execute()` now opens a plain `fsockopen()` to
      `$containerName:7411` (resolved by Docker's embedded DNS — no
      `-p` publish for this port, it's never reachable from outside the
      `ubiq_sandbox` network at all) instead of shelling out to `docker
      exec`. `docker ps` stays as the pre-flight liveness check — that
      call was never the problem, only the exec itself was.
    - `ubiq_api` needs to actually be *on* `ubiq_sandbox` to resolve
      container names on it, so `docker-compose.yml` adds it as a third
      network membership (alongside `ubiq-net`/`proxy-net`/`shared_net`)
      and declares `ubiq_sandbox: external: true`, matching how
      `shared_net` was already declared. This is a compose-file network
      attachment applied directly against the real daemon by whoever
      runs `docker compose up` — it has no relationship to the
      socket-proxy's `NETWORKS`/`EXEC` settings, which only gate what
      `ubiq_api`'s own *runtime* `DOCKER_HOST` connection can do through
      the proxy, not how compose wires the container up in the first
      place.
    - **Not a new exposure, same existing trust boundary:** every
      sandbox container has always been on the shared `ubiq_sandbox`
      bridge network, reachable from every other container on it by
      name — that's the exact mechanism F1c's `db` network-alias already
      relies on. Any sandbox container could already open a TCP
      connection to any other sandbox's published service port on this
      network before this change; the exec listener is one more port in
      that same category, gated by its own per-run secret so reachability
      alone isn't sufficient. `ubiq_api` joining this network is new, but
      what it gains is "can open a TCP connection to a container," the
      same thing any sandbox container could already do to another —
      not any Docker-daemon capability, and specifically not the global
      exec-into-anything capability `EXEC: 1` would have granted.
    - **Not yet done:** same caveat as F0c — no Docker host available in
      this environment to actually run a project, confirm the listener's
      boot line, and exercise the Terminal panel end-to-end. See the
      task-list entry above for the exact smoke-test steps.

- 2026-08-11 — F1c (opt-in real DB in the sandbox) complete, built on
  top of F1b's revert (see that entry immediately below — read it
  first, this one assumes it). Delivered exactly the re-scoped design
  from F1c's own checklist entry above: a second `docker run
  --network=ubiq_sandbox --network-alias=db ...`, no compose, no
  Networks/Volumes API calls anywhere.
    - **New `db_engine` column on `projects`** (migration
      `2026_08_11_000001`), nullable, default null on every row.
      `PATCH /projects/{project}/db-engine` (owner-only, validates
      `nullable|in:mysql,postgres`) is the only way to set it — not
      folded into the generic project-update route, since flipping this
      does something far more consequential (a second container plus a
      persistent bind-mounted directory on disk) than an ordinary field
      edit.
    - **Two deliberate narrowings from the roadmap/checklist wording,
      both worth flagging:**
        1. **Opt-in, not automatic.** The checklist entry describes
           "DB service in the sandbox" without saying explicitly opt-in
           vs. on-by-default for whichever frameworks need one. Went
           with strictly opt-in (`db_engine` null by default) rather
           than auto-detecting "this Laravel project probably wants a
           real DB" and switching existing projects over automatically
           — an automatic switch changes what already-working projects
           connect to, untestable in this sandbox (no live Docker/PHP
           here), for behavior that used to work fine on SQLite. Opt-in
           means zero blast radius: nothing about any existing
           project's sandbox changes unless someone explicitly calls
           the new endpoint.
        2. **Laravel only.** The only framework wired to actually *use*
           `db_engine` (`laravelRealDbCommands()` in
           `defaultStartCommands`) is Laravel — the one framework with
           an active hardcoded SQLite override
           (`laravelSqliteCommands()`, extracted unchanged from what
           was already there) to swap out. Django's startup block
           already just runs `migrate --run-syncdb` against whatever
           `settings.py` says (normally SQLite by Django's own
           convention) with no Ubiq-side override to fight — wiring
           `db_engine` into it would mean *editing the AI-generated
           settings.py* to point at `db`, a materially different (and
           riskier) change than Laravel's "flip env vars Laravel
           already reads" case. Left for a follow-up if real demand
           shows up; `db_engine` on the project itself is
           framework-agnostic already, so extending to Django later is
           additive, not a redesign.
    - **`dbEngineSpec()`**: one source of truth for image
      (`mysql:8.0` / `postgres:16-alpine`), port, env, and the
      in-container data path — read by both `startDbContainer()` (live
      sandbox) and `laravelRealDbCommands()`/`writeDockerComposeExport()`
      (startup script and export respectively), so none of the three
      can drift into disagreeing about the port or credentials.
    - **Storage**: `dbDataPaths()` returns a bind-mount host directory
      scoped to the *project* (`{id}-dbdata`, sibling to the project's
      own workspace dir), not the run — same reasoning F1c's checklist
      entry called out: a named Docker volume would need
      `docker volume create`, which almost certainly hits the same
      `VOLUMES:0`-blocks-GET wall that killed F1b's compose attempt. A
      bind mount is the same "just a directory the daemon can see"
      mechanism the app container's own source mount already uses
      successfully through this proxy. Every run gets a fresh `db`
      *container*; the data underneath survives stop/start exactly like
      the app's own workspace already does. `destroy()` (deleting the
      whole project) is the one place that data actually gets deleted —
      every ordinary stop/restart in between leaves it alone on purpose.
    - **Connectivity**: `startDbContainer()` gives the container
      `--network-alias=db` (not its own per-run-unique name) on the
      shared `ubiq_sandbox` network — Docker's embedded DNS resolves
      that alias to whichever container currently holds it, so the
      generated startup script can hardcode `DB_HOST=db` as static
      text, no interpolation of a container name needed. The same
      alias is why `DB_HOST: "db"` in the exported compose's `app`
      service environment means the same thing there too.
    - **Readiness**: no `docker exec`-based healthcheck (blocked by the
      proxy's `EXEC:0`, same constraint `getBuildLog()`'s own docblock
      already documents) and no shell `nc`/`/dev/tcp` wait (`nc` isn't
      guaranteed installed on these slim images; `/dev/tcp` is a
      bash-only feature and this script's shebang is plain `sh`, ash/
      dash on Alpine). Used a `php -r` fsockopen retry loop instead —
      PHP is guaranteed present in any Laravel image already, so this
      adds no new assumption about the base image. Non-fatal: 30 one-
      second retries, then continues regardless, logging rather than
      hanging the whole sandbox boot if the db container is somehow
      never reachable.
    - **Cleanup**: every existing container-removal site
      (`stopProject`, `reapStaleSandboxes`, `closeOpenRunForProject`,
      both `runProject` failure/exception branches, `destroy`,
      `CleanupSandboxes`) got one extra `docker rm -f {name}-db
      2>/dev/null || true` alongside its existing app-container removal
      — a harmless no-op for the vast majority of projects that never
      had a db container, cheap insurance for the ones that did, rather
      than adding a `db_engine` lookup + conditional at every site.
    - **Export** (`writeDockerComposeExport`): rewrote from heredoc
      interpolation of pre-indented blocks to a plain line array after
      catching a real indentation bug in my own first draft this way
      (over-indented `environment:`/`depends_on:` blocks that would
      have produced invalid YAML) — verified the corrected version
      round-trips through `pyyaml` correctly for both the with-db and
      without-db cases before considering this done.
    - Same caveat as everything else in this log: no live Docker/PHP in
      this sandbox to actually run a `db_engine=mysql` project end to
      end. Checked by hand (brace/paren balance, the export YAML
      parsed, the shell-escaping in the `php -r` wait line traced
      character-by-character) but genuinely needs a real smoke test — a
      Laravel project with `db_engine` set, confirm migrations actually
      land in MySQL/Postgres and not silently fall through to SQLite —
      before this ships to users.

- 2026-08-11 — F1b (multi-service `docker-compose` sandboxes) attempted
  and reverted. Full story below because the reasoning matters more than
  the result here — same "why," not just "what," standard as the rest of
  this log.
    - **What was tried:** replaced the single `docker run ...` string in
      `runProject()` with a generated, per-run `docker-compose.yml` +
      `docker compose -f ... -p ... up -d`. Deliberately a drop-in
      equivalent for the single-container case — same image, bind mount,
      resource limits, security flags, and `ubiq_sandbox` network
      attachment as the old `docker run` command, just expressed as one
      compose service instead of CLI flags.
    - **First blocker, found by checking the actual proxy config, not
      guessed:** the root `docker-compose.yml`'s socket-proxy sidecar has
      `NETWORKS: 0` and `VOLUMES: 0` — it rejects `POST /networks/create`.
      Worked around by declaring `ubiq_sandbox` (the same pre-existing
      network `--network=ubiq_sandbox` already used) as `external: true`,
      so compose wouldn't try to create anything.
    - **Second blocker, found during real deploy testing on the EC2 box:**
      a manual `docker network inspect ubiq_sandbox` through the proxy
      came back `403 Forbidden`. Turns out `NETWORKS: 0` blocks `GET` on
      `/networks/*` too, not only `POST` — and compose does exactly that
      `GET` to resolve an `external: true` network before attaching a
      container to it, so `docker compose up` hit the same wall. Switched
      to `network_mode: ubiq_sandbox` at the service level (a raw
      `HostConfig.NetworkMode` pass-through, same mechanism `docker run
      --network=` already used successfully) — still `403`.
    - **Third check, this time via direct `curl` against the proxy
      instead of guessing again:** `GET /networks` (plain and with a
      compose-project label filter) both `403`'d; `/containers/json`
      `200`'d fine. Conclusion: `docker compose up` does an unconditional
      `GET /networks` for its own project-state reconciliation on every
      `up` — independent of whether any service actually declares a
      `networks:` block or uses `network_mode` instead. There is no way
      to make `docker compose up` work against this proxy without
      enabling `NETWORKS` on it.
    - **Why this stopped here instead of just flipping the setting:**
      the proxy's `POST` and `DELETE` toggles are already globally `1`.
      There's no read-only variant of the `NETWORKS` toggle — enabling it
      to permit the `GET` compose needs would *also* permit
      `POST /networks/create` and `DELETE /networks/{id}` through the
      same proxy. That's a real widening of what a Laravel bug or
      compromise could do to the host (arbitrary network
      creation/deletion, not just sandbox-container management), directly
      contradicting the least-privilege reasoning FIX #9 built this proxy
      for in the first place. Trading that away to unlock a capability
      (F1c's db-in-sandbox) that isn't blocking anything today isn't a
      reasonable trade — reverted rather than making it.
    - **What got reverted:** `runProject()` back to plain `docker run`,
      byte-for-byte the same flags as before this attempt.
      `buildRuntimeComposeYaml()`, `runtimeComposePath()`,
      `cleanupRuntimeCompose()`, and their three call sites
      (`stopProject`, `reapStaleSandboxes`, `closeOpenRunForProject`)
      removed entirely — they only ever existed to support the
      compose-as-execution-engine path.
    - **What was kept, since it never touched the socket-proxy at all:**
      `writeDockerComposeExport()` — the portable, `build`-based
      `docker-compose.yml` written into the workspace and shipped via
      `download()`. That one only ever runs on someone else's machine,
      never against Ubiq's own proxy, so none of the above applies to it.
      Docblock updated to stop referencing the now-deleted runtime
      generator. `docker-compose-plugin` left installed in
      `backend/Dockerfile` (harmless on its own, and removing it would
      cost another image rebuild for zero benefit) even though nothing
      server-side calls `docker compose` anymore.
    - **F1c re-scoped as a direct result** (see its checklist entry
      above): not via `docker compose`, but a second `docker run
      --network=ubiq_sandbox ...` for the `db` container — the exact
      same mechanism the `app` container already uses, which never
      touches the Networks API either way. Gets the actual product goal
      (frontend + backend + db together in one sandbox) without the
      security trade-off that killed the compose approach. The export
      `docker-compose.yml` can still grow a `db:` service for portability
      independent of this — export and live execution were already two
      separate code paths before this happened.
    - Net effect on `runProject()` today: none. Byte-for-byte the same
      `docker run` command that ran before this entire attempt started.

- 2026-08-10 — Panel-fix, not part of the roadmap: Source Control panel
  overflowed into the center editor when the sidebar was resized
  narrower than 288px. Root cause: `SourceControlPanel.tsx`'s own root
  div had a hardcoded `w-72` (288px), completely ignoring the parent
  sidebar's actual `sidebarWidth` (freely resizable 150–600px per
  `ProjectEditorPage.tsx`'s resize handler) — the Files tab never has
  this problem because `FileTree`'s wrapper has no fixed width at all,
  it just fills whatever the parent gives it. Below 288px, the fixed
  width overflowed past its parent, and since the sidebar container had
  no `overflow-hidden`, that overflow visually bled into the editor
  pane instead of being clipped.
    - Fix: removed the hardcoded `w-72` (now `w-full`, filling the
      parent like the Files tab does) and the redundant `border-r`
      already provided one level up by the sidebar container itself.
    - Defense in depth: added `overflow-hidden` to the sidebar
      container so any future panel with the same mistake clips
      instead of bleeding into the editor.
    - Checked for other usage sites before removing `w-72` —
      `SourceControlPanel` is only ever rendered from
      `ProjectEditorPage.tsx`, so no other layout context depended on
      the fixed width.
    - `tsc -b --noEmit` clean on both touched files. Not yet manually
      tested by dragging the resize handle in a real browser — same
      caveat as everything else built in a sandbox without a live
      preview.

- 2026-08-09 — G1 (usage transparency dashboard) complete except the
  G1d stretch. Worth flagging clearly: most of G1's scope turned out to
  already exist, built under Phase C1 ("consolidated usage widget"),
  C2 (the reason→copy interceptor), and E2b — apparently before
  `UBIQ_ENHANCEMENT_ROADMAP.md` was written, since the roadmap
  describes G1 as if none of it existed yet. Checked what was actually
  there before writing anything:
    - `GET /user/plan-usage` (Phase C1/E2b) already returned live
      hour/day AI usage, sandbox concurrency, storage, and project
      counts, all sourced through `PlanGuard::remaining()` — exactly
      what G1a asked for as a *new* `GET /user/usage-summary` endpoint.
      Did not build a second endpoint; extended this one instead so
      there's still exactly one source of truth for "current usage."
    - `PlanUsageWidget.tsx` (Phase C1/E2b) already rendered all of that
      as bars with live "resets in Xh Ym" countdowns — G1b's "one bar/
      ring per counter_key, hour/day windows shown separately" was
      already built.
    - The axios response interceptor + `REASON_COPY` table in
      `planLimitStore.ts` (Phase C2) already caught every 429/403 with
      a `reason` field, from any action, and showed a mapped
      human-readable message via a shared modal — G1c was already
      fully done, nothing added for it.
  What was actually new, then, was just the piece none of that covered
  — a *history* of recent denials, not just live current totals:
    - `UsageController::planUsage()` now also returns `recent_denials`:
      the last 10 `plan_action_logs` rows for this user where
      `allowed = false`, raw `action_key`/`reason`/`limit_value`/
      `current_usage`/`created_at`, deliberately untranslated at the
      API layer.
    - `PlanUsageWidget.tsx` renders those under a new "Recent limits
      hit" section, mapping `reason` through the *same* `REASON_COPY`
      table G1c already relies on — exported it from
      `planLimitStore.ts` for that reuse, rather than writing a second
      reason→sentence table that could drift from the modal's wording
      over time.
  G1d (confirm the aggregation generalizes instance-wide) intentionally
  left unchecked: the new `recent_denials` query is a plain per-user
  `WHERE user_id = ?`, and an instance-wide version for Bucket 3's
  admin analytics would need its own pagination/limits, not just
  dropping that clause — flagged rather than silently assumed done.
  Same caveat as F0/F3: no PHP available in this sandbox to run this
  live — reasoned through by hand, brace/paren-checked, not
  smoke-tested.

- 2026-08-09 — F3 (GitHub OAuth, F3a–F3d) complete; F3e stretch not
  started. New `user_github_tokens` table (migration
  `2026_08_09_000004`) + `UserGithubToken` model, `access_token`
  encrypted at rest via the same `encrypted` Eloquent cast
  `UserAiKey` uses — reused the *pattern*, not the literal table,
  per F3b's own "or a small dedicated table" option: GitHub
  connections carry OAuth-specific metadata (username/avatar for
  Settings display, granted scopes) that `user_ai_keys`'s
  `{provider, value}` shape doesn't model, and a dedicated table keeps
  that one scoped to what its name says.
    - **Deviation from F3a's literal wording, and why:** F3a specified
      `GET /auth/github/redirect` mirroring
      `AuthController::handleGoogleCallback`. Built it as
      `POST /auth/github/connect` (authenticated) instead. Reason: the
      Google flow is a *login* — it creates/finds a Ubiq account and
      issues a fresh token, so there's no existing session to carry
      across the redirect. This flow is the opposite: an *already
      logged-in* user is connecting a second account, and a plain GET
      redirect has no Authorization header to identify who that is on
      a full-page browser navigation to github.com and back. Fixed by
      reusing the exact Cache-based one-time-code idiom
      `handleGoogleCallback`/`exchangeOAuthCode` already established in
      this file: `connect()` mints a random ticket tied to the caller's
      user id (`Cache::put`, 10 min TTL), returns a URL for the
      frontend to `window.location.href` to (can't be a fetch/axios
      call — has to actually leave the SPA), threads the ticket through
      GitHub's own `state` query param, and `callback()` recovers the
      user id via `Cache::pull` (single-use) before exchanging the
      code via `Socialite::driver('github')->stateless()->user()`.
      `GET /auth/github/callback` itself is still public, same as the
      task said, since GitHub has to be able to land the browser there
      with no auth header available — identity comes from the ticket,
      not from the route being protected.
    - **F3c:** `SourceControlPanel.tsx` no longer reads/writes
      `localStorage.getItem('ubiq_api_keys')` for GitHub — it calls the
      new `GET /user/github` status endpoint on mount and shows a
      "Connect GitHub" CTA when disconnected; `handlePrClick` calls
      `createPr()` with no token at all when connected. Backend side:
      `GitController::createPr()` and
      `ProjectController::store()`/`importFromGithub()` both now
      resolve `UserGithubToken::where('user_id', ...)->first()?->access_token`
      first, falling back to the client-supplied `token`/`github_token`
      param only when no connection exists — kept as a real fallback
      (not removed outright) for one-off imports of a repo the
      connected account itself can't access, and so this doesn't break
      anyone mid-migration before they've reconnected (see F3d).
    - **F3d:** a mount-time effect in `SourceControlPanel.tsx` checks
      `localStorage['ubiq_api_keys'].github`; if present, deletes just
      that key (leaves any other stored provider keys alone), and shows
      a small "we removed an old saved token, reconnect above" notice
      when the account isn't already OAuth-connected. Deliberately
      client-side/lazy (runs whenever the panel is next opened) rather
      than a one-time server migration script, since the value being
      migrated only ever lived in the browser to begin with — there's
      nothing server-side to migrate.
    - **F3e (repo picker) intentionally not started** — the
      connect/disconnect plumbing it would sit on top of is now in
      place, so it's a smaller follow-up whenever it's prioritized, not
      blocked on anything from this task.
    - Same caveat as F0: no PHP/Docker/live GitHub OAuth App available
      in this sandbox to actually run the flow end-to-end — reasoned
      through by hand and checked for brace/paren balance, not
      smoke-tested. Before this goes live: register the real GitHub
      OAuth App, set `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (and
      `GITHUB_REDIRECT_URI` if the callback URL differs from the
      `services.php` default), and run `php artisan migrate`.

- 2026-08-09 — F0 (P0 sandbox slot leak) complete, both sub-items.
  Root cause confirmed exactly as scoped in the roadmap:
  `runProject()` force-removed the previous container under a name
  shared by every run of the same project (`ubiq_project_{id}`)
  without ever telling that old run's `SandboxRun` row it was done —
  the new container was genuinely alive under that same name, so
  every later state check (`reapStaleSandboxes`, the cron) believed
  the *old* row's container was still running too and never released
  its slot. Two changes, matching F0a/F0b:
    - **F0a:** new `closeOpenRunForProject()` in `ProjectController`,
      called right after `reapStaleSandboxes($user)` and before
      `planGuard->authorize()` in `runProject()`. Finds the project's
      current open `SandboxRun` (if any), force-removes its container,
      verifies removal, stamps `stopped_at`, and releases the
      `active_sandboxes` counter — reusing the same kill → verify →
      stamp → release sequence `stopProject()` already had, not a
      second copy of it. Deliberately unconditional on whether the
      container is genuinely still alive (unlike `reapStaleSandboxes`,
      which only reaps dead ones) — a re-run always intends to replace
      it regardless.
    - **F0b:** new nullable `container_name` column on `sandbox_runs`
      (migration `2026_08_09_000003`), stamped in
      `claimPortAndReserve()` right after the row is created as
      `ubiq_project_{project_id}_run{run_id}` — unique per row by
      construction instead of shared per-project. Added
      `SandboxRun::getDockerNameAttribute()` (`$run->docker_name`) as
      the one place the "use container_name, fall back to the legacy
      project-scoped name for pre-migration rows" logic lives, and
      switched every call site that names/inspects/removes a specific
      run's container to use it: `reapStaleSandboxes()`,
      `stopProject()`, `destroy()`, `getBuildLog()`, `runProject()`'s
      post-claim container name and both its failure/exception cleanup
      branches, and `CleanupSandboxes` (the idle-timeout cron).
      `runProject()`'s pre-claim "CONTAINER PREP" sweep (the step that
      used to derive the container name directly) is now explicitly
      defense-in-depth for *untracked* leftovers only — matches both
      the legacy and run-scoped naming pattern via one regex filter,
      since F0a already closes out the tracked case before this point
      is ever reached.
  No new migration conflicts: found the date slot `2026_08_09_000001`
  was already taken by an unrelated same-day migration
  (`add_session_metadata_to_personal_access_tokens`) and
  `_000002` by `add_account_privacy_settings_to_users` — this one is
  `_000003`. **Smoke-tested and confirmed working** (re-run-without-stop
  no longer leaks a slot) — caveat about untested-in-this-sandbox
  removed.

- 2026-08-09 — Phase F added: flattened `UBIQ_ENHANCEMENT_ROADMAP.md`
  into a task list (F0, F3, G1, F1, G2, G3, Bucket 3), ordered by the
  roadmap's own "Suggested build order" — P0 bug fix first, then
  smallest/safest lifts (F3 GitHub OAuth, G1 usage dashboard) before
  the bigger builds (F1 full-stack sandboxes, G2 diff review +
  autonomy), self-hosted (G3) after those have real usage behind them,
  Bucket 3 deferred until a team/enterprise plan exists to sell it
  into. No tasks started yet. Each roadmap section (F1a, G2c, etc.) has
  more detail/rationale than duplicated here — check the roadmap doc
  itself before starting a task, this list is deliberately the short
  form. Next action: start F0a/F0b (the sandbox slot leak).

- 2026-08-10 — F1a (externalize the real Dockerfile) complete. Added
  `writeDockerfile()` right beside `selectDockerImage()` in
  `ProjectController`, called from `runProject()` immediately after
  image selection (step 4, before the port claim) — same
  `$dockerConfig` the live sandbox itself just used for this run, so
  the two can't drift apart into two different sources of truth for
  "what image does this project actually use." Writes `Dockerfile` to
  the workspace directory and persists it via `$project->files()`
  `updateOrCreate`, the identical pattern `startup.sh` already uses a
  few lines earlier — same idempotent-every-run approach, not a new
  pattern.
    - **Deliberately not a bind-mount recreation of the live sandbox.**
      The sandbox itself mounts the workspace into a stock image for a
      fast dev loop (no rebuild per keystroke); a `docker run -v
      {ubiq's own host path}:/app` command means nothing on someone
      else's server. The generated Dockerfile is `FROM {image}` / `COPY
      . .` / `CMD ["sh", "startup.sh"]` instead — a real, standalone,
      buildable image. `docker build && docker run` should work
      anywhere Docker is installed, with zero Ubiq-specific assumptions
      baked in.
    - **No changes needed to `download()`** — confirmed it already just
      zips the workspace directory wholesale, so writing the Dockerfile
      to disk is sufficient; it ships in the existing export
      automatically, exactly as scoped.
    - **Left the sandbox's own resource flags (`--memory`, `--cpus`,
      `--network=ubiq_sandbox`, etc.) out of the Dockerfile entirely,
      on purpose** — those are `docker run` runtime flags specific to
      how Ubiq schedules containers on its own infra, not something
      that belongs baked into an image definition someone's taking to
      their own server.
    - Added a comment at the top of the generated file itself (not just
      here) telling the user editing this Dockerfile has no effect on
      how their live Ubiq sandbox runs — it's the exported artifact,
      not the thing driving the preview — so nobody edits it expecting
      their sandbox to change and gets confused when it doesn't.
    - Same caveat as F0/F3/G1: no PHP/Docker available in this sandbox
      to actually run `docker build` against the generated file — code
      review only, needs a real smoke test (build one of each runtime
      type — node/php/python/static — and confirm the image actually
      runs and serves) before this ships to users.
  F1b (multi-service `docker-compose` sandboxes) was attempted next —
  see the 2026-08-11 entry above for why it was reverted.

- 2026-07-28 — Phase A complete. Sentinel convention: `-1` means "unlimited"
  for numeric `plan_features` values (used by `projects.max_count` on Pro).
  `users.subscription_tier` kept (deprecated, not dropped) until B4 — every
  controller still reads it until PlanGuard replaces those checks action by
  action.

- 2026-07-28 — B1/B2 complete. Found `.env.example` sets `CACHE_STORE=database`
  but no `cache`/`cache_locks` tables have ever existed in this project —
  added migration `2026_07_28_000005_create_cache_tables.php` as a
  prerequisite fix, since `PlanService` needed a working cache and this
  would otherwise have surfaced as a silent production outage.
  `PlanGuard::check()` is read-only and does NOT write to `plan_action_logs`
  (used for UI pre-flight checks); only `authorize()` is audited — this
  narrows the original architecture note slightly to avoid flooding the log
  with polling reads. `evaluateRate()`'s check-then-increment is not
  transaction-locked (minor race window under burst traffic) — noted as an
  acceptable v1 tradeoff, upgrade to `lockForUpdate()` if it becomes a real
  issue. `project.create` counts live `projects` rows rather than an
  incrementing counter, so it self-corrects on deletion.

- 2026-07-28 — B3a complete. `CompletionController`'s old `$rateLimits`
  array + `checkRateLimit()` (the method that already caused the
  Paddle→PayPal 'premium'/'pro' key-mismatch bug) is now fully replaced by
  `PlanGuard::authorize($user, 'ai.request')` across all 5 AI-calling
  endpoints (`generate`, `complete`, `review`, `debug`, `explain`).
  `chat()` had NO rate limiting at all before this — added the guard there
  too, closing a real gap rather than just migrating existing behavior.
  `checkRateLimit()` left in place as a throwing stub (not deleted) so any
  external caller surfaces loudly instead of silently no-op'ing; confirmed
  no other file calls it. Added `PlanGuard::remaining()` as a small reusable
  addition — used here for the `remaining_requests` response field, and
  will be reused by Phase C1's `GET /me/usage` endpoint. The old
  `rate_limits` DB table/model is now unused but not dropped yet — safe to
  drop once B4 does the full old-logic retirement pass.

- 2026-07-28 — B3b complete. `ProjectController::runProject` now checks
  `PlanGuard::authorize($user, 'sandbox.start')` before any file writes or
  docker calls; released on both docker-run failure paths (no free ports,
  docker start failure), on explicit `stopProject()`, and on
  `CleanupSandboxes` auto-stop. Also closed a gap while here: `sandbox.cpu`
  and `sandbox.memory_mb` were seeded per-tier in Phase A but never actually
  read anywhere — `docker run` was hardcoded to `--cpus=0.75` and
  runtime-based memory regardless of plan. Now reads tier values from
  `PlanService`; memory uses `max(tier_value, runtime_minimum)` rather than
  a hard cap, since a Node/Angular build genuinely needs ~700-900MB to not
  OOM and silently failing free-tier builds wasn't a deliberate call — swap
  to `min()` if a hard tier ceiling is wanted instead. Similarly,
  `sandbox.idle_timeout_minutes` was seeded but unused — `CleanupSandboxes`
  used one flat `--hours=2` for everyone; now checks each open sandbox
  against its owner's plan-specific timeout (kept `--hours` as an explicit
  manual override for emergency sweeps, removed it from the hourly
  schedule in `routes/console.php`). Known limitation: cleanup still runs
  hourly, so a Free-tier sandbox nominally capped at 20min idle can
  actually hold resources up to ~80min worst-case before the cron catches
  it — tighten the schedule frequency if that gap matters in practice.
  Also noted: the frontend's own idle-warning threshold (ProjectRunner) is
  a separate hardcoded 2h value, now out of sync with the per-tier backend
  timeout — flagged for Phase C, not fixed here (backend-only phase).

- 2026-07-29 — B3c complete. Wired `PlanGuard::authorize('project.create')`
  into `ProjectController::store()` and `import()` — the latter had NO
  project-count check before at all (only a storage check), a real gap
  closed here, same pattern as `chat()` in B3a. While in this file, found
  the exact same hardcoded-constant drift bug a third time: `STORAGE_LIMIT_
  FREE`/`STORAGE_LIMIT_PRO` were duplicated verbatim in both `User.php` and
  `ProjectController.php` with a comment literally saying "must stay in
  sync" — plus a third consumer in `FileController::upload()` via
  `User::isOverStorageLimit()`. Added a new `storage.check` PlanGuard
  action (type='bytes') backed by a new `storage.max_mb` plan_features key
  (seeded: free=512, starter=1024, creator=5120, pro=10240 — same
  "-1 = unlimited" sentinel convention). All three call sites now route
  through PlanGuard, giving storage limit checks an audit trail for the
  first time. `getStorageLimitBytes()` in ProjectController is now a
  throwing stub (confirmed zero remaining callers); `User::
  getTotalStorageLimitInBytes()`/`isOverStorageLimit()` were left as
  functional delegating wrappers instead of stubs, since they're public
  model methods a private controller method isn't — safer to keep them
  correct than to risk an unseen caller. `getUserUsedBytes()` in
  ProjectController now delegates to `User::getUsedStorageBytes()` instead
  of duplicating the same DB query verbatim (found as a second copy of the
  identical query). `storageStats()` (the read-only usage endpoint) now
  returns `unlimited: true` with null limit fields for Pro — frontend
  isn't updated yet to handle that shape (Phase C).

- 2026-07-30 — B3e complete, done ahead of B3d (reordered per the cost
  report's finding that capacity, not model-tier policy, was the live risk).
  Added a box-wide ceiling to `sandbox.start` via a new `SANDBOX_GLOBAL_
  CONCURRENT_LIMIT` env var (default 3), checked in `PlanGuard::
  evaluateConcurrent()` after the per-user check so per-user denials still
  report the more specific reason (`concurrent_limit_exceeded` vs the
  fallback `global_capacity_reached`). IMPORTANT BUG CAUGHT BEFORE SHIP:
  `ACTIONS` was a `private const` array — PHP does not allow function calls
  (`env()`) inside const expressions, which would have been a fatal error
  the moment this class loaded. Converted `ACTIONS` to a `private function
  actions(): array` method instead (rebuilt per call — cheap, and
  `PlanService`'s caching is what matters for perf, not this). Also
  tightened `CleanupSandboxes`'s schedule from `->hourly()` to
  `->everyFifteenMinutes()`, closing the B3b-flagged gap where Free tier's
  nominal 20min idle timeout could actually hold resources up to ~80min
  worst-case. B3d (model tier gating) remains open pending a policy
  decision: should `ai.max_model_tier` restrict BYO-key models like Gemini
  (which cost nothing to serve) the same way it restricts self-hosted
  Ollama models, or only the latter?

- 2026-07-30 — B3d complete — all of Phase B3 (a-e) is now done. Policy
  question above was asked via elicitation but the reply ("continue")
  didn't map to either option; proceeded with the DEFAULT assumption that
  ai.max_model_tier restricts ALL models by tier, BYO keys included — the
  simpler, more standard SaaS convention (model access as a product
  feature, not just a cost-recovery mechanism). Flagged clearly; easy to
  special-case BYO keys later if that assumption turns out wrong — the
  branch point is `resolveModelTier()` in CompletionController.
  Implementation: expanded `available_models.tier_required` from a
  2-value to 4-value enum (raw ALTER, same approach as
  fix_subscription_tier_enum); added `AvailableModelSeeder` with an
  initial catalog mapped by provider-family economics (ollama→free,
  mistral/codestral→starter, gemini/openrouter→creator, openai→pro).
  `resolveModelTier()` checks the catalog first, falls back to the SAME
  family pattern-matching `getProviderConfig()` already uses for
  unlisted models, defaulting genuinely unknown strings to 'pro' (the
  conservative choice — an unrecognized model string shouldn't be a way to
  dodge gating). Wired into all 6 CompletionController AI endpoints.
  Also wired `sharing.enable` into `ProjectController::store()` and
  `update()` — and while touching `update()`, found and fixed a real
  mass-assignment bug: it was doing `$project->update($request->all())`
  with zero validation, and `Project::$fillable` includes `user_id` and
  `storage_path` — meaning any owner could silently overwrite either via
  this endpoint. Replaced with an explicit validated whitelist
  (name/description/language/visibility only); github_token/
  repository_url/branch/source were already excluded from this endpoint's
  intended surface and stay that way. Public-visibility attempts are
  asymmetric by design: `update()` returns an explicit 403 (deliberate,
  single-purpose action), while `store()` silently downgrades to private
  if the plan doesn't allow it (creation shouldn't fail over a secondary
  field) — worth reconciling to one behavior later if the asymmetry proves
  confusing in practice.

- 2026-07-31 — B4 complete, functionally — but deliberately did NOT drop
  the `subscription_tier` column itself, unlike the tracker's original
  wording implied. Found the single most consequential piece of "old
  scattered logic" left, more impactful than the already-neutralized
  `checkRateLimit()` stub: `CheckSubscription` middleware required
  `tier==='pro' && status==='active'` for EVERY route it guards, meaning
  Free/Starter/Creator users got a 402 before ever reaching PlanGuard —
  the entire four-tier system was unreachable for 3 of 4 tiers. Fixed:
  middleware now only enforces real billing for Pro (the only tier with an
  actual subscription lifecycle right now — Starter/Creator have no
  PayPal plan wired up yet, Phase C4), everyone else passes through to
  PlanGuard's actual per-tier limits. Also: backfilled `plan_id` for every
  existing user via a one-time migration (matches by `subscription_tier`,
  falls back to Free for any unmapped legacy value); both `AuthController`
  signup paths and the `PayPalController` webhook now dual-write `plan_id`
  alongside `subscription_tier` going forward. `subscription_tier` itself
  is NOT dropped — 5 read-only display endpoints (AuthController,
  AdminController, UsageController, UserController×2) still read it
  directly for informational responses; low-risk to leave since it stays
  correctly populated via the dual-write, and dropping it now for no
  functional gain isn't worth the risk. `rate_limits` table/model are
  fully unused but also left in place (harmless dead schema, same
  reasoning). Revisit dropping both once this has been live long enough
  to trust — not before.

- 2026-07-31 — B5 complete. New `AdminPlanController` under the existing
  `admin` route middleware group (auth covered entirely at the route
  level, matching AdminController's own convention — no duplicate
  is_admin check inside the controller). Endpoints: `GET/POST /admin/
  plans`, `GET/PUT /admin/plans/{plan}`, `GET/PUT /admin/plans/{plan}/
  features` (bulk upsert), `DELETE /admin/plans/{plan}/features/
  {featureKey}`. `plans.key` is intentionally NOT editable via `update()`
  — PlanGuard, PlanSeeder, and CheckSubscription all match plans by `key`
  elsewhere, so renaming it here would silently break those lookups with
  no error at write time; delete-and-recreate if a key genuinely needs to
  change. `updateFeatures()` soft-warns (doesn't block) if
  `sandbox.max_concurrent` is set above `SANDBOX_GLOBAL_CONCURRENT_LIMIT`
  — B3e's global ceiling still applies regardless, so this is just
  telling the admin their new per-plan number is unreachable in practice,
  not a hard rule enforced against itself. Every write calls
  `PlanService::forgetPlan()` so changes are visible immediately instead
  of waiting out the 60s cache TTL.

- 2026-07-31 — B6 complete — Phase B (B1-B6) is fully done. New
  `PlanReportService` with three canned queries: denial rates by plan+
  action, top denial reasons by plan (what to loosen first), and usage-
  vs-limit stats (how close to the ceiling typical usage runs). "Usage
  percentile" from the original phase description is approximated as avg/
  max %-of-limit rather than a true percentile — MySQL has no native
  PERCENTILE_CONT before 8.0.2, and avg/max already answers the actionable
  question without a window-function query; revisit with real percentiles
  once there's enough traffic volume to make the distinction matter.
  Exposed two ways from one implementation: `php artisan ubiq:plan-report
  --days=30` for a quick CLI table, and `GET /admin/plans/report?days=30`
  for JSON. Registered the `/plans/report` route BEFORE `/plans/{plan}` in
  routes/api.php — implicit route-model-binding would otherwise try (and
  fail) to resolve "report" as a Plan id.

- 2026-08-01 — C1 complete, first frontend work this session (React/TS/
  Vite/Tailwind, confirmed via package.json). New `GET /user/plan-usage`
  endpoint (distinct from the existing `/user/usage`, which is historical
  time-series for charts, not live limit data) — reuses `PlanGuard::
  remaining()` rather than duplicating counter logic. New
  `PlanUsageWidget.tsx` shows AI/sandbox/projects usage, added to
  SettingsPage alongside the existing StorageUsage component.
  IMPORTANT: found and fixed a real bug in `StorageUsage.tsx` — it hardcoded
  `user?.subscription_tier === 'pro'` (the old 2-tier assumption) for
  display text, AND did `storage.limit_mb - storage.used_mb` math that
  would have produced NaN now that B3c's `storageStats()` can return
  `limit_mb: null` for unlimited plans. Fixed to read the `unlimited` flag
  from the API directly instead of deriving tier assumptions client-side.
  Verified with real tooling, not just brace-counting: `npm install` (npm
  registry is on the allowed network list), `npx tsc --noEmit` (zero
  errors), and a full `npm run build` (succeeded) — first time this
  session's frontend edits got actual compiler/build verification rather
  than manual bracket-balance checks.
  NOT fixed here, flagged for C2/C3: the same `isPro`-style hardcoded
  2-tier check appears in 5 more files (SubscriptionGuard.tsx,
  PricingCard.tsx, TerminalPanel.tsx, AdminPage.tsx, DashboardPage.tsx) —
  out of scope for "usage widget," but those are exactly the files C2
  (limit-hit prompts) and C3 (pricing page) will need to touch anyway.

- 2026-08-01 — C2 complete. Handled centrally rather than per-call-site:
  every PlanGuard denial already returns a consistent `reason` field
  (PlanLimitExceededException::toResponseArray + every catch block that
  surfaces it), so detection happens ONCE in api.ts's axios response
  interceptor (403/429 + `reason` present → trigger the modal) instead of
  wrapping every AI/sandbox/project call site individually. New
  `planLimitStore.ts` (zustand, no persist — transient UI trigger) maps
  each reason to friendly copy; `global_capacity_reached`/
  `plan_lookup_failed`/`no_plan_resolved` deliberately don't show an
  upgrade CTA since they're infra/system issues, not real plan limits —
  upgrading wouldn't help. New `PlanLimitModal.tsx` mounted once in
  App.tsx, matching ConfirmDialog's visual style.
  IMPORTANT: `streamChat()`'s raw `fetch()` call bypasses the axios
  interceptor entirely (chat() is PlanGuard-guarded same as every other AI
  endpoint), so it needed its own explicit hook. While fixing that, found
  a real pre-existing bug: the non-ok handler did
  `try { throw new Error(errorData.error) } catch { throw new Error(generic) }`
  — the specific backend error message was thrown INSIDE its own catch
  block and immediately overwritten with a generic one, every single
  time. No caller has ever seen a real backend error message from this
  streaming path. Fixed as part of the same edit.
  Also caught during placement: `PlanLimitModal` uses `useNavigate()`,
  which requires Router context — first attempt mounted it as a sibling
  to `<Router>` rather than inside it, which would have thrown at runtime.
  Caught before shipping by actually re-running `tsc --noEmit` + full
  build after the fix, not just re-reading the diff.

- 2026-08-01 — C3 complete, and grew significantly beyond "add a pricing
  page" once the actual blast radius became clear. New public `GET
  /plans` endpoint (deliberately a separate `PlanController`, not an
  extra method on `AdminPlanController` — that route has no auth at all,
  and mixing it into the Admin* namespace risked a future reader assuming
  every method there is admin-gated).
  MAJOR FINDING: `SubscriptionGuard.tsx` was still enforcing the OLD
  2-tier model at the FRONTEND level — `canAccess` required
  `subscription_tier === 'pro'` to reach `/chat`, `/projects`, or
  `/editor` AT ALL, showing a hardcoded "$9/month, Pro only" wall to
  every Free/Starter/Creator user. This is the exact frontend mirror of
  the CheckSubscription bug fixed in B4 — even after all that backend
  work, non-Pro users still couldn't reach those pages. Neutered the
  gate entirely; PlanGuard (not a page-level block) is now the sole
  source of truth for what each tier can do, surfaced via the C2 modal
  when a real limit is hit.
  That fix created a new gap: a genuinely lapsed Pro user (still blocked
  server-side by CheckSubscription's 402) would now hit a raw unhandled
  error with no friendly UI, since the old frontend gate was incidentally
  catching that case too. Closed by giving CheckSubscription's 402 the
  same `reason` shape (`subscription_expired`) PlanGuard denials use, and
  extending both the axios interceptor AND streamChat()'s separate fetch()
  error handling to catch 402 alongside 403/429.
  New `PricingGrid.tsx` replaces the single hardcoded Pro-only
  `PricingCard.tsx` (left in place, unused — same "harmless dead code"
  pattern as elsewhere this session). Renders all active plans from `GET
  /plans` with curated marketing labels for a subset of plan_features
  (raw DB values stay the source of truth; label phrasing is a frontend
  display concern). Only Pro has a real `paypal_plan_id` right now —
  Starter/Creator render a "Coming Soon" button rather than a fake
  checkout flow, honestly reflecting that Phase C4 hasn't wired their
  billing yet. Also fixed a smaller, adjacent display bug in
  SettingsPage.tsx: the "Current Plan" badge hardcoded `isPro ? 'Pro' :
  'Free'`, which would show "Free" for Starter/Creator users — now shows
  the real `subscription_tier` value.
  Caught during implementation, not after: `api.ts` exports `api` as a
  DEFAULT export, not named — first draft of PricingGrid's import would
  have been a runtime error. Verified with `tsc --noEmit` + full build
  before considering this done, same discipline as C1/C2.

- 2026-08-01 — C4 complete for what's actually buildable without live
  PayPal dashboard access (which Claude doesn't have — creating the real
  Starter/Creator PayPal Products/Plans is a manual step, see below).
  MAJOR FINDING #1: `PayPalController::applySubscriptionState()` hardcoded
  `$newTier = in_array($newStatus,['active','past_due']) ? 'pro' : 'free'`
  — a binary that completely ignored WHICH plan the subscription was
  actually for. Harmless while Pro was the only plan with a
  paypal_plan_id, but would have silently mis-tiered any real Starter/
  Creator subscriber the moment those went live (a Creator subscriber
  would've been written as 'pro'). Same issue in `confirm()`, which
  checked against a single hardcoded `config('services.paypal.plan_id')`.
  Both now resolve the actual Plan by matching `paypal_plan_id` in the DB
  — works for any future paid tier with zero further code changes, just
  an admin PUT (B5) once that plan's real PayPal plan_id exists.
  MAJOR FINDING #2: confirmed via grep that the scheduled downgrade task
  referenced in `cancel()`'s own code comment ("a scheduled task... should
  downgrade once subscription_ends_at has passed") never actually existed
  anywhere. PayPal's cancel API is terminal — no further EXPIRED webhook
  fires after a manual cancellation the way one does for a naturally-
  lapsing subscription — so a canceled user's paid tier/plan_id would
  have stayed put forever. Built the missing
  `ubiq:downgrade-expired-subscriptions` command, scheduled hourly.
  Downgrade-over-limit policy needed NO new code: PlanGuard's
  project.create/storage.check already check LIVE counts against
  whatever plan is currently active at request time — a downgrade
  naturally grandfathers existing resources (nothing deletes them) while
  blocking new creation until back under the new limit. This fell out of
  B3c's design for free.
  NOT built: true paid-tier-to-paid-tier downgrade while staying
  subscribed (e.g. Creator → Starter without lapsing to Free first) needs
  PayPal's subscription "revise" API, a materially different flow from
  cancel+resubscribe — flagged as a known gap, not attempted here.
  Documented all 5 PayPal env vars in .env.example (previously zero of
  them were, despite config/services.php expecting all five).
  MANUAL STEP STILL NEEDED (outside Claude's reach — no PayPal dashboard
  access): create real PayPal Products+Plans for Starter ($5/mo) and
  Creator ($12/mo) via the PayPal Developer Dashboard, then PUT the
  resulting plan IDs onto plans.paypal_plan_id via
  `PUT /admin/plans/{id}` (B5). PricingGrid (C3) already shows a live
  PayPal button the instant paypal_plan_id is set — no further frontend
  or backend work required once those two plan IDs exist.

- 2026-08-02 — C5 complete. This finishes the entire tracker (A1-A5,
  B1-B6, C1-C5). New `AdminPlansPanel.tsx`, added as a third "Plans" tab
  on the existing AdminPage (alongside Overview/Users) rather than a
  separate route — matches the existing tab pattern there. Editable core
  fields (name, price_cents, paypal_plan_id, is_active) plus an inline
  features table (key/value/type, add/remove rows) per plan, calling the
  B5 endpoints directly — this is what makes "manage it over the
  database" literally true day-to-day instead of curl/Postman. Surfaces
  `updateFeatures()`'s soft warnings (e.g. sandbox.max_concurrent
  exceeding the global ceiling) inline rather than silently swallowing
  them. Also embeds the B6 report (denial rates, top denial reasons,
  usage-vs-limit) as a collapsible section in the same panel, reusing
  `GET /admin/plans/report` — one more consumer of that same service,
  no new backend work needed. Verified with `tsc --noEmit` + full build,
  same discipline as every other frontend phase this session — zero
  errors both times.

- 2026-08-02 — Final revisit pass across the whole tracker. Verified
  (not just re-read): migration ordering, zero route conflicts, every
  controller/method referenced in routes actually exists, full brace-
  balance sweep, fresh `tsc --noEmit` + build. All clean. Corrected one
  earlier mis-flag: `TerminalPanel.tsx` was never a hardcoded-tier risk —
  matched `isProcessing`, not a real tier check. Also corrected the
  ProjectRunner idle-warning claim from B3b — the actual file is
  `useSandboxAutoStop.ts`, and it was never a user-facing countdown, just
  a stale docblock comment saying "default 2 hours." Fixed the comment.
  Then closed out the remaining deferred items:
  — Dropped `rate_limits` (migration + removed `RateLimit` model + dead
  `User::rateLimits()` relation) — confirmed zero code references
  anywhere first. Genuinely safe, unlike subscription_tier.
  — Added `ubiq:check-tier-consistency` command as the actual gate for
  eventually dropping `subscription_tier` — run it periodically; zero
  drift for a couple of weeks is the real evidence needed, not a
  deadline-based guess.
  — BYO-key model policy (B3d's original open question) finally settled
  with an actual win-win rather than a binary pick: self-hosted (Ollama)
  models stay tier-gated (the one place this platform has a real cost);
  BYO-key models (Gemini/OpenAI/OpenRouter/Mistral, whenever the user
  supplies their own key) are now allowed on ANY tier via a new
  `hasByoKeyFor()` check in CompletionController — blocking a model the
  user pays for themselves was a pure paywall with no cost
  justification. AI request rate limits still apply regardless of
  provider, so the upgrade incentive shifts to throughput/concurrency
  rather than model choice, not disappears. Required reordering all 6
  guardModelAccess() call sites, since $apiKeys needs to be resolved
  BEFORE the guard now (previously resolved after, harmless when the
  guard didn't need it).

- 2026-08-03 — Production incident: user reported project delete
  returning 500, and Gemini BYO-key generation failing. Investigation
  found FOUR separate issues, none related to the plan system itself:
  (1) `sandbox_runs` table was NEVER migrated, ever — confirmed via grep,
  zero migrations, zero schema.sql mentions — despite being used
  throughout ProjectController (runProject/stopProject/destroy) and
  CleanupSandboxes since before this session started. Broke project
  delete AND sandbox start/stop in production. Same "model exists, table
  was never created" pattern as google_id/cache table/storage columns
  found earlier. Added the missing migration, matching SandboxRun
  model's own docblock schema exactly.
  (2) `site_visits` — same bug, same fix. Was spamming Sentry on every
  unauthenticated page load (recordVisit is fully public).
  (3) `ProjectController::destroy()` never released the active_sandboxes
  counter when deleting a project that had a running sandbox — same gap
  class as B3b, just never caught for this specific path. Fixed.
  (4) Gemini BYO-key failures: `gemini-2.5-flash` was pulled early by
  Google for some accounts ahead of its official Oct 16 2026 shutdown —
  confirmed against Google's own developer forum. Root cause wasn't
  actually in CompletionController (which just passes through whatever
  model string it's given) — it was AiController::getModels(), a
  COMPLETELY SEPARATE, previously-untouched hardcoded model list
  ($cloudModels) feeding the frontend's ModelSelector dropdown,
  duplicating (and diverging from) available_models. Also found
  grok-beta listed there despite CompletionController's
  getProviderConfig() never supporting xAI at all — that dropdown option
  never worked, full stop. Consolidated: AiController::getModels() now
  reads from available_models directly (deriving `provider` display
  label the same way resolveModelTier() derives tier), removed the dead
  unrouted chat()/getProviderConfig() duplicate entirely. Updated
  available_models: gemini-1.5-* (fully shut down) → gemini-2.5-pro/
  gemini-2.5-flash-lite/gemini-3.5-flash; disabled (is_active=false) the
  four Ollama entries since Ollama still isn't installed on the server —
  they were guaranteed-to-fail dropdown options, same failure mode as
  grok-beta. Flip active via the B5 admin UI the moment Ollama is
  actually running, no deploy needed.
  CAUGHT DURING RECHECK, BEFORE SHIPPING: the seeder's
  `array_merge($model, ['is_active' => true, ...])` had the merge order
  backwards — the hardcoded true silently overrode every per-model
  override, including the four just-added Ollama is_active=false values.
  Fixed the merge order and re-verified before packaging.
  NOT fixed, flagged only: ModelSelector.tsx's isKeyMissing() keymap has
  no entry for 'OpenAI' or 'Ollama' — those providers never show the
  proactive "Setup Key" lock icon, only fail at generation time. Minor
  pre-existing UX gap, not introduced by this fix, lower priority than
  the four issues above.

- 2026-08-06 — Phase D opened. D0a/D0b complete: `ProjectEditorPage.tsx`'s
  right panel used `rightPanelContent === 'chat' ? <Chat/> : <Runner/>` — a
  ternary that mounts only the active side and fully unmounts the other,
  destroying `ProjectRunner`'s live state (`realLogs`, `isPollingActive`,
  `previewUrl`) and killing its polling `useEffect`/`setInterval` every time
  the user switched to Chat and back. Same pattern on `showTerminal &&
  <TerminalPanel/>` for the bottom terminal, wiping command history/output
  on every hide. Both fixed by keeping the component always mounted while
  its parent panel is open/visible and toggling only CSS (`hidden` class /
  `h-0` collapse) instead of the JSX conditional. Side effect worth noting:
  `ProjectRunner`'s one-time `userAPI.getStats()` mount effect now also
  fires whenever the Chat tab is opened first (since both mount together),
  not just when the Sandbox tab is opened — harmless extra request, not a
  functional issue.

- 2026-08-06 — D1 complete. Added `savedContentRef` — set whenever content
  is fetched (`loadFileContent`) or successfully saved (`handleSave`) — as
  the baseline to detect unsaved manual edits (`fileContent !==
  savedContentRef.current`), alongside the pre-existing `proposedContent !==
  null` check for unaccepted AI diffs. Generalized `confirmDiscardModal`
  from `{ isOpen, nextFile }` (wired only for the AI-diff path through
  `handleFileSelect`) to `{ isOpen, message, onConfirm }` so one dialog now
  guards three call sites: `handleFileSelect` (clicking a different file),
  `closeTab` (X button on the active tab), and — deliberately NOT guarded —
  `submitDelete`'s own `closeTab(node.fileId, true)` call, forced through
  since the file is already deleted server-side by that point and a
  discard-changes prompt for a file that no longer exists would be
  nonsensical. Both `handleFileSelect` and `closeTab` gained a `force`
  param so the dialog's own "Discard Changes" retry doesn't re-trigger
  itself (infinite-loop guard, not just a style choice — without it the
  dirty check is still true on the recursive call since nothing's been
  saved yet). Verified with `tsc --noEmit` — zero errors. Out of scope for
  this task (tracked separately if wanted): browser-level `beforeunload`
  warning on tab close/refresh, and a visual "unsaved" dot on the tab
  itself — this fix only covers in-app navigation, which was the reported
  bug. D2 next (stale-response race on rapid file switching).

- 2026-08-06 — D2 complete. Added `latestRequestedFileIdRef`, stamped with
  `file.fileId` synchronously at the top of `loadFileContent` — i.e. before
  the `await fileAPI.get(...)` — so it always reflects whichever file was
  *most recently clicked*, regardless of fetch ordering. Both the success
  and error branches check this ref against the fileId the response
  belongs to and bail out silently if they no longer match (a newer file
  was opened while this request was in flight); the `finally` block's
  `setTimeout(() => setShowEditor(true), 50)` — which exists to force a
  Monaco remount — gets the same double-check, once before scheduling the
  timeout and again inside it when it actually fires, since the 50ms delay
  is itself long enough for a third file-click to land in between. Net
  effect: an in-flight request for a file you've since navigated away from
  can no longer overwrite `fileContent`/`savedContentRef` or force the
  editor's loading-flicker state, no matter how fast you click through
  files. Verified with `tsc --noEmit` — zero errors. D3 next (Monaco
  inline-completion provider leak on every file switch).

- 2026-08-06 — D3 complete. Root cause: `<Editor key={editor-${activeFile.
  fileId}}>` forces a full Monaco editor remount on every file switch, so
  `handleEditorMount` — which called `monaco.languages.
  registerInlineCompletionItemProvider(...)` unconditionally — fired again
  each time. That registration is global to the Monaco *module*, not
  scoped to one editor instance, and its returned disposable was never
  stored, so nothing ever called `.dispose()` on the previous one. A
  session that opens N files ends up with N live providers all firing
  `aiAPI.completion` on every keystroke in whichever file is currently
  open — compounding latency, duplicate suggestions, and BYO-key API cost
  the longer someone works. Fixed by adding
  `completionProviderDisposableRef`: `handleEditorMount` now only calls
  `registerInlineCompletionItemProvider` if that ref is still null, so
  registration happens exactly once for the page's whole lifetime
  regardless of how many files get opened afterward. Since the provider is
  now long-lived rather than re-created per file, it could no longer rely
  on closing over the `aiMode` value from whenever it happened to be
  registered — added `aiModeRef` (kept current via a `useEffect` on
  `[aiMode]`) so the one persistent provider always reads live AI-mode
  state instead of freezing whatever mode was active on first mount. Added
  a page-unmount cleanup effect that disposes the provider when navigating
  away from the editor entirely (e.g. to a different project), so it
  doesn't keep running against a Monaco instance whose host component no
  longer exists. `editor.addCommand`/`editor.addAction` calls in the same
  function were left untouched — those are scoped to the editor *instance*
  and Monaco already disposes them correctly on remount, confirmed not a
  leak. Verified with `tsc --noEmit` — zero errors. D4 next (concurrent
  Ctrl+S save race).

- 2026-08-06 — D4 complete. Two distinct races lived in `handleSave`. First:
  the Save *button* is disabled while `isSaving` is true, but Monaco's
  Ctrl+S command calls `handleSaveRef.current()` directly and was never
  gated by that same state — mashing Ctrl+S could fire two overlapping
  `fileAPI.update` calls, and if the network reordered their responses,
  whichever arrived last would win in `setFileContent` regardless of send
  order. Fixed with `isSavingRef` — a synchronous ref-based re-entrancy
  guard (needed because `isSaving` state isn't synchronously readable
  within the same tick a rapid second Ctrl+S would land in). Second, more
  interesting one found while fixing the first: `handleSave` is `async`
  and closes over `activeFile` at call time, but nothing stopped the user
  from switching to a *different* file while a save was still in flight —
  when that save's response eventually arrived, it unconditionally called
  `setFileContent`/`savedContentRef.current =` with the OLD file's content,
  silently overwriting whatever the newly-active file had already loaded.
  Fixed by reusing D2's `latestRequestedFileIdRef` (already the source of
  truth for "which file is actually on screen") as a guard: a save's
  response now only touches live editor state if that ref still matches
  the file being saved (`savingFileId`, snapshotted at call start) — a save
  for a file you've since navigated away from still persists correctly to
  the server (via `setFiles`, keyed by `savingFileId` not `activeFile`) but
  no longer clobbers the screen. Verified with `tsc --noEmit` — zero
  errors. Remaining queue is D8 (security flag, informational-only — no
  code change planned unless requested) then D5/D6/D7 (pure UX, lowest
  priority).

- 2026-08-06 — Backend cross-check on D0a–D4, no backend bugs found, one
  important **documentation-only** finding on D3:
  `CompletionController::complete()` (the endpoint behind `aiAPI.completion`,
  used by the Monaco inline-completion provider) routes through
  `PlanGuard->authorize($user, 'ai.request')`, which per its own doc-comment
  "ALWAYS writes one row to plan_action_logs (allowed or not)" and counts
  toward the user's hourly/daily `ai_requests` limit shown in
  `PlanUsageWidget.tsx` — regardless of tier or BYO key. This means the pre-
  fix D3 leak (one live completion provider per file ever opened in a
  session, each firing its own debounced request per keystroke) wasn't just
  wasted compute — every user session with N files open was consuming
  roughly N× their real AI-request rate-limit allowance, which could:
  (a) trigger premature 429 "Rate limit exceeded" responses on Free/Starter
  tiers well before their actual usage justified it, and (b) inflate any
  historical `plan_action_logs` analysis (the B6-style usage-percentile/
  denial-rate reporting) for sessions logged before this fix shipped — worth
  the caveat if that data is ever revisited. No backend code change is
  needed: PlanGuard logged and rate-limited exactly what it received; it
  just received far more requests than real usage warranted. The D3
  frontend fix is the complete fix for this. Also checked D4: `FileController
  ::update()` (the save endpoint) has no PlanGuard gate and no optimistic-
  locking/version check at all — a plain last-write-wins `$file->save()` —
  but since the D4 frontend guard now prevents a second save from ever being
  *sent* while one is in flight, the backend never receives overlapping
  writes to reconcile for a single session; nothing to add. (Multi-tab/
  multi-device concurrent editing of the *same* file is a separate, broader
  feature never in scope here.) D1/D2 confirmed backend-clean too:
  `FileController::show()` (used by `loadFileContent`) has no PlanGuard gate
  either. D0a/D0b never touched the network layer at all.

- 2026-08-06 — D5 complete. Replaced all three native `alert()` calls
  ("Connection URL updated!", "Please open a file.", "Select some code
  first.") with a small self-contained toast: a `toast` state + `showToast()`
  helper local to this file, auto-dismissing after 3s via a tracked
  `toastTimeoutRef` (cleared on unmount and re-triggered on each new call so
  rapid successive toasts don't stack/overlap oddly), rendered as a single
  fixed-position `div` near the bottom of the JSX tree. Deliberately kept
  file-local rather than promoted to a shared component/context — no other
  page in this codebase uses a toast pattern yet, and this is a single-file,
  low-risk UX fix; worth promoting once a second consumer actually needs it,
  not speculatively. Caught a pre-existing, unrelated dead-class bug while
  wiring the toast's entrance animation: `animate-slide-up` (used originally
  on the terminal panel before D0b's rewrite, and still used today on the
  provider-picker dropdown at the `animate-slide-down` call site) isn't
  actually defined anywhere — this project's Tailwind v4 config lives in
  `src/index.css`'s `@theme` block, which only defines `--animate-fade-in`.
  Both `slide-up`/`slide-down` silently no-op; Tailwind doesn't error on an
  undefined utility, it just emits nothing. Used the real `animate-fade-in`
  utility for the new toast instead. Left the pre-existing `animate-slide-
  down` dead class on the provider dropdown untouched — out of scope for
  D5, flagging here in case it's worth a follow-up (either define the
  keyframe in `@theme` or drop the dead class name). Verified with `tsc
  --noEmit` — zero errors. D6 next (closeTab tab-selection UX).

- 2026-08-06 — D6 complete. `closeTab` previously always ran
  `loadFileContent(newTabs[newTabs.length - 1])` when closing the active
  tab — closing *any* tab, anywhere in the strip, jumped straight to
  whichever file happened to be open last, not the one next to where you
  were looking. Now captures `closingIndex` (position of the closed tab in
  the pre-removal list) and activates `newTabs[Math.max(closingIndex - 1,
  0)]` — the tab immediately to its left, matching the convention used by
  most editors, falling back to the new first tab if you closed the
  leftmost one (nothing to its left to fall back to). The guard this sits
  inside (`if (activeFile?.fileId === fileId)`) is unchanged, so closing a
  *background* tab still just filters the list and leaves the active file
  untouched — this fix only changes what happens when the tab you close is
  the one you're currently looking at. Verified with `tsc --noEmit` — zero
  errors. D7 next (panel widths not persisted across reloads).

- 2026-08-06 — D7 complete. `sidebarWidth`/`chatWidth` were plain `useState(256)`/
  `useState(400)` with zero persistence, unlike the tab list and active file
  (`ubiq_tabs_${projectId}`, `ubiq_active_${projectId}`), which already
  survived reloads. Deliberately used *global* keys (`ubiq_sidebar_width`,
  `ubiq_chat_width`), not per-project ones — this is a layout preference
  about how the person likes to work, not project data, so it should carry
  across every project the same way editor font size or theme would, not
  reset each time you open a different project. Both initial states now
  read from localStorage via a lazy `useState(() => ...)` initializer,
  bounds-checked against the same min/max the resize handler itself
  enforces (150–600 for sidebar, 300–800 for chat) so a stale or hand-edited
  localStorage value can't produce a broken/invisible panel. Persistence
  writes happen once, in `stopResizing` (mouseup), not on every `resize()`
  tick during the drag — added `sidebarWidthRef`/`chatWidthRef`, kept in
  sync via their own tiny effects, specifically so `stopResizing` could read
  the latest width without being added to its own dependency array (which
  would otherwise tear down and re-add the window mousemove/mouseup
  listeners on every pixel of drag movement, not just once per drag).
  Verified with `tsc --noEmit` — zero errors.

  Phase D checklist is now complete except **D8**, which was scoped from
  the start as a security *flag* rather than a fix — plaintext AI
  keys/Ollama URL in `localStorage`, no known active exploit path in this
  codebase, no code change planned unless explicitly requested. Leaving it
  open on the checklist as a standing awareness item rather than closing it
  out with no actual change.

- 2026-08-07 — D8 upgraded from "flag" to "fix" per request: BYOK provider
  secrets now stored server-side, encrypted at rest, never round-tripped
  back to the browser. What follows is everything touched, since this
  ended up crossing 8 frontend files plus the backend, not just
  `ProjectEditorPage.tsx`.

  **Scoping decision, made before writing any code:** only google/openai/
  openrouter/mistral — the actual bearer-token secrets — moved server-side.
  Ollama URLs (local/remote) did NOT, on purpose. Tracing `aiService.ts`'s
  `chatLocal`/`chatCloud` split showed the Laravel backend proxies even
  "local" Ollama calls (`/api/ollama/chat`) to avoid mixed-content HTTPS→
  HTTP blocking in the browser — meaning the backend needs to know *which*
  Ollama instance to call on every single request, and that answer is
  inherently per-request, per-user-choice (someone might run local Ollama
  one session and point at a remote box the next), not a fixed
  account-level fact the way an API key is. There's no "the server-side
  Ollama URL" to resolve the way there's now a "the server-side Google
  key" — it has to keep coming from the client. Also: a connection target
  isn't a bearer-token secret in the first place; encrypting it server-side
  wouldn't reduce its exposure since it still transits per-request either
  way. GitHub PATs (`SourceControlPanel.tsx`, stored in the very same
  `ubiq_api_keys` blob) are a related-but-separate finding, deliberately
  NOT touched here — same storage vulnerability, different secret
  category, wasn't part of D8's original scope. Flagging, not silently
  folding in.

  **Backend** — new migration `2026_08_07_000001_create_user_ai_keys_table`
  creates `user_ai_keys` (user_id, provider, `value` — encrypted at rest via
  the model cast below, last_used_at, unique on [user_id, provider]).
  `App\Models\UserAiKey`: `protected $casts = ['value' => 'encrypted']` is
  what actually does the AES-256-CBC encrypt/decrypt (Laravel's Crypt
  facade, keyed by APP_KEY) — transparent on read/write, never touch the
  raw column directly. Added `$hidden = ['value']` on the model too, as a
  second guardrail against some future endpoint accidentally
  `return`-ing the model directly and serializing the decrypted value.
  `User::aiKeys()` hasMany relation added for convenience. New
  `AiKeyController` (`index`/`update`/`destroy`) is the only place a raw
  key is ever written from now on — `index()`/`update()` both return a
  masked preview only (`mask()`: last 4 characters visible, dot-count
  capped at 20 so a very long key doesn't produce an absurd string of
  bullets), never the real value; `destroy()` is a genuine DELETE, not a
  soft-delete, so revoking a key leaves nothing behind server-side either.
  Routes added under the same authenticated group as `/user/preferences`.

  `CompletionController` — added `mergeServerKeys($user, $clientKeys)`:
  builds the `$apiKeys` array used by `hasByoKeyFor`/`getProviderConfig`
  from `UserAiKey` rows instead of the request body; still takes
  `ollama_url` from whatever the client sent (see scoping decision above),
  but google/openai/openrouter/mistral from the client are now silently
  ignored, not an error — an old cached frontend build still sending them
  just doesn't break. Added `touchKeyUsage($user, $config)`, bumping
  `last_used_at` for whichever stored key actually served the request, so
  a user can tell from Settings whether a key they suspect is compromised
  is still active. Rewired across **all 6 AI endpoints** in this
  controller (`generate`, `chat`, `complete`, `review`, `debug`,
  `explain`) — each now calls `mergeServerKeys()` in place of the old
  `$request->input('api_keys', [])`, and `touchKeyUsage()` right after
  `getProviderConfig()`. No `vendor/`/Composer available in this sandbox
  (packagist.org isn't on the allowed-domains list) so no full Laravel
  boot test was possible — installed a real PHP 8.3 CLI via apt instead
  and ran `php -l` against every touched file; all clean. Recommend a
  real `php artisan migrate` + manual smoke test of one BYOK provider
  before this reaches production.

  **Frontend, write-sites** (where keys are actually entered) —
  `SettingsPage.tsx` and `SettingsDialog.tsx` (two separate settings UIs
  that both did this) rebuilt around `aiKeysAPI` (`list`/`update`/
  `remove`, added to `services/api.ts`): `configuredKeys` state holds only
  the masked preview fetched from the server, `keyInputs` holds draft text
  the user is currently typing — kept in two separate state slots
  specifically so there's no path, accidental or otherwise, for a real
  secret to get echoed back into a text field after being saved. Both
  dropped the `grok` field entirely rather than "migrating" it — it was
  never wired to any backend provider support (`CompletionController` has
  no xAI/Grok branch), a pre-existing decoy field that did nothing even
  before this fix. Also surfaced, not fixed: there's no field anywhere in
  either settings UI for an OpenAI key, even though the backend has always
  supported one (`apiKeys['openai']` in `getProviderConfig`) — a
  pre-existing product gap, not something to add as a side effect of a
  security patch.

  **Frontend, read-sites** (where keys were being attached to requests) —
  `ModelSelector.tsx` needed a real migration, not just deletion: it uses
  key presence to decide whether to show a model as locked. Replaced its
  raw-value `apiKeys` state with `configuredProviders` (a `Set<string>`
  of provider names, fetched from the same masked endpoint) and simplified
  `isKeyMissing` to a presence check; dropped the `'xAI': 'grok'` map entry
  for the same reason `grok` was dropped from Settings. `aiService.ts`
  (`chatCloud`) and `ProjectEditorPage.tsx`'s Monaco inline-completion
  provider both had dead-weight localStorage reads removed outright — the
  backend endpoints they call now resolve secrets server-side regardless
  of what's sent, so assembling them client-side was pure waste; also
  fixed a stale comment in `aiService.ts` that still described the old
  behavior. Checked `ChatInterface.tsx` and `AiGeneratorModal.tsx`
  carefully and confirmed **no change needed** in either — both only ever
  handled Ollama URLs (never assembled google/openai/openrouter/mistral in
  the first place), consistent with the scoping decision above.

  Verified with `npx tsc --noEmit` across the whole frontend — zero errors
  — and `php -l` across every touched backend file — all clean. Full
  repo-wide grep for `ubiq_api_keys` afterward confirms only
  `SourceControlPanel.tsx` still references it (GitHub PAT, deliberately
  out of scope, flagged above).

  Phase D is now fully closed — D0a through D8, nothing left open.

- 2026-08-07 — Post-D8 sweep: re-checked for anything D8 might have made
  *inaccurate* elsewhere rather than broken. Backend: confirmed
  `CompletionController` is the only backend file that ever touched
  `api_keys` (repo-wide grep across `app/Http/Controllers` and
  `app/Services`), and re-verified `hasByoKeyFor`/`guardModelAccess`
  against the new merged-key shape — `isset($apiKeys['ollama_url'])` at the
  Ollama-baseUrl-override site treats an explicit `null` (now always
  present as a key, per `mergeServerKeys`) the same as a missing key in
  PHP, so behavior there is unchanged from before D8.

  Frontend: found real user-facing copy that D8 made **false** rather than
  just stale code. `GuidePage.tsx`'s "Setup Cloud AI" section said "Your
  keys are stored in your browser's LocalStorage... We never store them" —
  the literal opposite of the new architecture — fixed to describe
  server-side encrypted storage. Same section also linked out to get an
  xAI/Grok key with nowhere to enter one (matches the dead-field removal
  from Settings) — link removed. More consequential: `LandingPage.tsx` had
  a public feature bullet ("Keys Stored Locally in Browser") and — worth
  flagging on its own — an FAQ entry explicitly answering "Is my API Key
  safe?" with "your API keys are stored in your browser's LocalStorage and
  are never saved to our database," which is now a false public claim
  about how user credentials are handled, not just outdated internal
  documentation. Both fixed to accurately describe encryption at rest and
  that keys are never sent back to the browser after saving.

  Deliberately NOT fixed, flagged instead (pre-existing, unrelated to D8):
  `LandingPage.tsx`'s "Connect OpenAI, Anthropic, Google, or Grok directly"
  lists two providers (Anthropic, Grok) the backend has never actually
  supported, in either architecture — a marketing/reality mismatch that
  predates this fix and isn't something D8 introduced or is responsible
  for correcting.

  Verified with `npx tsc --noEmit` — zero errors — after both copy fixes.

---

## Phase E — Settings Page Enhancement

Requested: mobile tab layout fix, a fuller Account tab (avatar/name/plan/
email, log out all devices, delete account, active sessions), a new
Privacy tab, a fuller Billing tab (all plan limits + an upgrade path), and
a general "what else is missing" pass. Everything below was checked
against the actual codebase (both `SettingsPage.tsx` and the backend)
before being scoped — nothing here is guessed. Ordered by: isolated quick
wins first, then a foundational bug fix everything else in Billing depends
on, then the account-security features (new backend surface, real risk),
then the net-new Privacy tab last.

- [x] **E1 — Mobile tab navigation.** The tab list container is
      `flex flex-col` unconditionally (`w-full md:w-64 flex flex-col gap-2`)
      — it's *already* vertical on mobile today, which is the reported
      problem (a tall stack of full-width buttons pushes all tab content
      below the fold). Fix: `flex-row overflow-x-auto` on mobile (a
      horizontally-scrollable pill/tab bar, each button sized to its
      content, not full-width), reverting to the current vertical sidebar
      at `md:` and above. Frontend-only, no backend, lowest risk in this
      phase — good first task.

- [x] **E2 — Billing & Plan tab**, split into three because (b) and (c)
      depend on (a) being correct first:

  - [x] **E2a — Fix subscription-tier-blind status logic — turned out to be
        a CRITICAL latent backend bug, not just a frontend display issue.**
        Original scope: `isTrialing`/`isActive`/`isPastDue` in
        `SettingsPage.tsx` all gated on `user?.subscription_tier ===
        'pro'` specifically. Real root cause found while fixing it:
        `users.subscription_tier` was a MySQL `ENUM('free','pro')` —
        genuinely incapable of storing `'starter'`/`'creator'` — while
        `PayPalController::applySubscriptionState()` already tries to
        write `$targetPlan->key` (which can be exactly those two values)
        into it. Hadn't surfaced yet only because no plan currently has a
        real `paypal_plan_id` configured, so the resolution logic there
        always falls back to `'free'` before the write happens — the
        moment a real Starter/Creator PayPal plan ID goes live, a
        successful payment would hit this enum constraint on the very
        next save, either throwing outright or silently truncating,
        either way leaving a paying customer without the tier they paid
        for. Fixed with a new migration (same raw-ALTER pattern as the
        earlier `available_models.tier_required` expansion) widening the
        enum to all 4 values — no `PayPalController` code change needed,
        it was already correct, just blocked by the narrower column.
        Frontend fix: renamed `isPro` → `isSubscribed` (the old name would
        itself become a footgun once it correctly covers Starter/Creator
        too) and generalized it to check membership in `['starter',
        'creator','pro']`. Also fixed two hardcoded-`"$9.00/month"` copy
        spots (trial notice, active-subscription card) — leftover from
        the single-tier-Pro era, wrong for every current tier including
        Pro itself (which is $22, not $9) — now pulled from the real
        `/plans` endpoint (same one `PricingGrid` already uses) matched
        against the user's actual tier. Fixed a third tier-blind spot:
        the canceled-subscription notice said "Pro access until…"
        unconditionally. **Checked, confirmed NOT buggy:** `PricingGrid.
        tsx` has its own similarly-named `isPro` also checking `===
        'pro'` — but that one's correctly scoped, since `paypalPlan`
        there always resolves to whichever single plan currently has a
        real `paypal_plan_id` (only Pro today; Starter/Creator
        deliberately show "Coming Soon," per an existing comment
        referencing a not-yet-built Phase C4) — it really is asking
        "does the user already have *this specific* plan," not making
        the same tier-blind mistake. Left untouched. Verified with `tsc
        --noEmit` (frontend) and `php -l` (migration) — both clean.
  - [x] **E2b — Show every plan limit, not just the ones already tracked
        as usage.** `PlanUsageWidget`/`StorageUsage` already cover AI
        requests (hour+day), sandbox concurrency, projects, and storage —
        the actual consumable/usage-vs-limit numbers. Completely absent
        from any Settings view today: sandbox CPU/RAM/idle-timeout, max
        model tier, and sharing-enabled — the *static capability* specs
        of the plan, which `GET /user/plan-usage` doesn't return at all
        right now (checked the controller directly). Extended that
        endpoint with a new `limits` object (`sandbox_cpu`,
        `sandbox_memory_mb`, `sandbox_idle_timeout_minutes`,
        `max_model_tier`, `sharing_enabled`) — a straight passthrough of
        `$planService->limitFor()` keyed exactly to `plan_features.
        feature_key` from `PlanSeeder`, so it can't silently drift from
        the seeder later. `PlanUsageWidget` renders these as a "Your plan
        includes" panel, deliberately NOT styled as `UsageBar`s — there's
        nothing "used" about a CPU allocation, it's a fact about the plan,
        not a consumable — plus a one-line reminder that BYOK models
        aren't limited by the max-model-tier cap shown (that only applies
        to self-hosted Ollama). Made `limits` optional on the frontend
        type and gated the whole panel on its presence, so an older
        cached response or a backend that hasn't deployed this yet just
        omits the panel rather than crashing. Verified with `tsc --noEmit`
        and `php -l` — both clean.
  - [x] **E2b sub-part — grid layout fix + AI request reset countdowns**
        (reported after E2b shipped, tracked as a sub-part rather than a
        new letter since it's the same Billing-tab surface). Two issues:
        (1) **Grid arrangement bug.** The status-cards grid was
        `grid-cols-2` with 3 direct children (Plan card, `StorageUsage`,
        a wrapper around `PlanUsageWidget`) — CSS grid auto-placement
        filled them left-to-right/top-to-bottom: Plan card → row1/col1,
        Storage → row1/col2, then `PlanUsageWidget` wrapped to row2/col1,
        leaving row2/col2 completely empty and the right column much
        shorter than the left — exactly the lopsided look reported.
        Fixed by grouping explicitly into two column `<div>`s (left:
        Plan card + `PlanUsageWidget` stacked via `space-y-4`; right:
        `StorageUsage` alone) instead of relying on auto-placement across
        a flat list of 3 items in a 2-column grid.
        (2) **Missing reset countdowns for AI requests/hour and /day**,
        requested to match Claude's rate-limit UI style ("resets in Xh
        Ym"). Added `hour_resets_at`/`day_resets_at` to
        `PlanGuard::remainingRate()` — absolute ISO8601 UTC instants
        (`Carbon::now()->startOfHour()->addHour()` /
        `->startOfDay()->addDay()`), computed server-side rather than
        having the frontend guess "midnight" or "top of the hour" in the
        browser's own timezone, which would silently disagree with the
        actual boundary `PlanGuard` enforces (`Carbon::now()` in the app's
        configured timezone) whenever those two timezones differ — same
        "most accurate" standard as the E3b session-geolocation decision.
        New frontend `ResetCountdown` component parses that instant with
        `new Date()` and diffs against the browser's own clock — correct
        regardless of either side's timezone, since both ends of the
        subtraction are the same absolute instant — re-rendering once a
        minute (seconds-precision isn't meaningful for an hour/day-scale
        limit). Shown under the hourly bar and next to the daily count;
        omitted entirely when a tier is unlimited, since there's no reset
        to count down to on those plans. Verified with `tsc --noEmit` and
        `php -l` — both clean; confirmed `PlanUsageWidget.tsx` is the only
        frontend consumer of this endpoint's response shape, so nothing
        else needed updating for the new fields.
  - [x] **E2b sub-part 2 — layout still wrong, storage merge, refresh
        button, day progress bar** (reported after sub-part 1 shipped;
        the two-column fix in sub-part 1 solved the auto-placement bug
        but wasn't the layout actually wanted). Five changes, all in
        `PlanUsageWidget.tsx`/`SettingsPage.tsx`, no backend change needed:
        (1) **Single column, not two.** Dropped the `md:grid-cols-2` split
        from sub-part 1 entirely — status area is now one stacked column
        (`space-y-4`), per explicit feedback that two columns wasn't
        wanted at all.
        (2) **Storage merged into Plan Usage.** Removed the separate
        `<StorageUsage/>` card from `SettingsPage.tsx` and added a Storage
        row directly inside `PlanUsageWidget`, sourced from `data.storage`
        — which this component was already fetching as part of the same
        `/user/plan-usage` response the whole time, just never rendering.
        No new API call. This left `StorageUsage.tsx` with zero consumers
        anywhere in the app — a stale comment in the old code claimed it
        "already has its own DashboardPage consumer," checked via a
        repo-wide grep while making this change and that was never
        actually true. Flagged as now-dead code; left in place since
        deleting files wasn't asked for.
        (3) **"Your Plan Includes" is now a visually distinct section**
        (explicit divider + spacing) appearing after Plan Usage, rather
        than reading as just one more row in the same flowing list.
        (4) **AI requests/hour and /day added to that includes list** as
        static numbers (`data.ai.hour_limit`/`day_limit`, already in
        state — no new field needed), alongside the existing sandbox
        CPU/RAM/idle-timeout/model-tier/sharing specs. Deliberately
        redundant with the live usage numbers shown above in Plan Usage —
        one section is "what your plan includes" (static reference), the
        other is "how much you've used" (live), and both are useful.
        (5) **Daily AI-requests row now has a progress bar**, matching the
        hourly row — was text-only before.
        (6) **Manual refresh button** in the Plan Usage header — pulled
        the mount-time fetch out into a reusable `fetchUsage()` (still
        called from a `useEffect` on mount, same as before), wired a
        `RefreshCw` button to call it again on click with a spin
        animation while in flight. Recalls the exact same
        `GET /user/plan-usage` PlanGuard already computes fresh on every
        request — no separate "refresh" endpoint needed. Verified with
        `tsc --noEmit` and a full `npm run build` (not just `--noEmit`,
        to also catch anything Rollup's stricter bundling analysis would
        flag) — both clean; the one warning `npm run build` surfaces
        (`AiApiConfig` not exported by `aiService.ts`) is the
        already-flagged, pre-existing, harmless one from before this
        session, confirmed unchanged.
  - [x] **E2c — Upgrade path for non-top-tier active subscribers.**
        Previously `!isSubscribed && !isCanceled` hid the upgrade grid
        completely for ANY active paid subscriber — a Starter or Creator
        subscriber had no way to see or start an upgrade to a higher tier
        from this page at all, only "Manage Subscription" (refresh/
        cancel). Added an optional `minSortOrder` prop to `PricingGrid`
        (defaults to unset, so every pre-existing caller keeps its
        original unfiltered behavior) — filters the rendered plans to
        `sort_order > minSortOrder` just before the render loop, leaving
        the component's own fetched `plans` state untouched in case
        anything else in it ever needs the full list. `SettingsPage.tsx`
        now shows the grid when either unsubscribed (full grid, unchanged)
        or subscribed-but-not-on-the-top-tier (filtered to
        `currentPlan.sort_order`), hidden only when canceled (unchanged)
        or already on the top tier — computed from the actual `plans`
        data's max `sort_order` rather than hardcoding `'pro'` as "the
        top tier," so a 5th tier added later wouldn't need a matching
        code change here. Verified `paypalPlan`/`isPro` resolution inside
        `PricingGrid` (used for wiring the one real PayPal-checkout
        button) stays correct under filtering: both read from the
        component's full unfiltered `plans` list, not the filtered
        render list, and Pro — the only plan with a real `paypal_plan_id`
        today — is mathematically guaranteed to appear in the filtered
        set whenever the grid is shown to a non-top-tier subscriber,
        since it's always the highest `sort_order`. Verified with
        `tsc --noEmit` and a full `npm run build` — both clean, same
        pre-existing unrelated warning as before, nothing new.

- [x] **E3 — Account tab**, ordered easy → hard, deliberately saving the
      destructive one for last:

  - [x] **E3a — Show the real avatar; clarify "full name."** `User.avatar`
        already existed as a column and was populated for Google OAuth
        signups, but Settings only ever rendered a colored circle with
        the first letter of `username`, never `user.avatar`, even when a
        real profile picture was sitting right there in the API response.
        Fixed: renders `user.avatar` when present (with an `onError`
        fallback in case the URL ever 404s — hides the broken image
        rather than leaving a broken-image icon), falls back to the
        initial circle otherwise. `full_name` question already decided
        earlier in this phase (see "Decisions made 2026-08-08" above):
        `username` stays the display name, no new column. Verified with
        `tsc --noEmit` and a full `npm run build` — both clean.
  - [x] **E3c — Log Out All Devices.** Added `AuthController::
        logoutAllDevices()` (`$user->tokens()->delete()`, revokes every
        Sanctum token, not just the caller's own — no "except this
        device" variant, since that would be a quietly different
        behavior than what the button says) behind a new route
        (`POST /auth/logout-all`) and a confirmation dialog on the
        frontend. If the server call itself fails (network blip, etc.),
        the client-side logout (clear auth store, navigate to `/login`)
        still proceeds regardless — leaving someone stuck signed in on
        the device that just tried to log them out everywhere would be
        worse than a logout that maybe didn't reach every other device.
        Verified with `tsc --noEmit`, a full `npm run build`, and
        `php -l` on both backend files — all clean.
  - [x] **E3b — Active Sessions (device, location, created, updated).**
        Biggest lift in this phase, as expected. New migration
        (`2026_08_09_000001_add_session_metadata_to_personal_access_tokens`)
        adds `user_agent`/`ip_address`/`city`/`region`/`country` to
        Sanctum's stock `personal_access_tokens` table, all nullable —
        every column here is best-effort by design, a lookup failure or a
        pre-migration token should just show "Unknown," never break
        anything. Added `AuthController::createTokenWithMetadata()` and
        routed all 4 existing `createToken()` call sites (register,
        login, refresh, OAuth exchange) through it, so every login path
        captures this consistently instead of risking one path silently
        missing it if done ad-hoc at each site. New
        `App\Services\IpGeolocationService`: calls `ip-api.com`'s free
        tier (no key needed, ~45 req/min limit — fine here since this
        runs once per login, not per request), 2s timeout, skips the
        lookup entirely for local/private IPs, and returns nulls on
        *any* failure (timeout, non-200, malformed response) rather than
        throwing — a geolocation hiccup must never block login itself.
        **Per the earlier "most accurate" decision** (see "Decisions made
        2026-08-08" above) this does real city/region/country lookup
        rather than settling for device+IP only. **Known limitation,
        stated plainly:** the actual HTTP call to `ip-api.com` could not
        be executed from the sandbox this was built in — that domain
        isn't on its allowed outbound list — so this is written and
        reasoned through carefully (verified the response-shape handling
        logic, the private-IP detection, the timeout/failure paths) but
        has NOT been smoke-tested against a real request. Needs an actual
        test against a real IP once deployed before fully trusting it.
        New endpoints: `GET /user/sessions` (lists every token for the
        caller, marks which one `is_current`, parses a device/browser
        label from the raw stored user-agent on the fly rather than
        pre-parsing and storing it — verified `parseDeviceLabel()` by
        actually *running* it against realistic Chrome/Windows, Safari/
        Mac, Safari/iPhone, and Chrome/Android user-agent strings, not
        just syntax-checking the `match(true)` comma-arm logic) and
        `DELETE /user/sessions/{id}` (revokes one session — scoped via
        `$request->user()->tokens()->where('id', $id)`, not a bare
        `find()`, specifically so this can't become an IDOR letting
        someone revoke another user's session by guessing a numeric id).
        Frontend: new `ActiveSessionsPanel.tsx` component (device,
        location or raw IP fallback, created/last-active timestamps, a
        "This device" label with no revoke button on the current
        session — revoking your own current session from inside a
        settings list would just log you out confusingly mid-page; "Log
        Out All Devices" already covers that case explicitly), plus its
        own manual refresh button matching the one added to
        `PlanUsageWidget` in the E2b sub-parts. Verified with
        `tsc --noEmit`, a full `npm run build`, and `php -l` on every
        touched backend file — all clean, same pre-existing unrelated
        Rollup warning as before, nothing new.
  - [x] **E3d — Delete Account.** Highest-risk item in the whole phase —
        built and tested last, once the rest of the tab was solid, as
        planned. Implemented exactly the 4-step order laid out below:
        (1) `AuthController::deleteAccount()` cancels any active PayPal
        subscription via `PayPalService::cancelSubscription()` — if that
        call fails, deletion is **aborted** with a 502 asking the user to
        retry or contact support, specifically so a recurring charge can
        never outlive the account; (2) loops the user's project ids and
        runs `docker rm -f ubiq_project_{id}` for each, since DB cascades
        don't touch live containers; (3) explicitly deletes
        `$user->tokens()` before deleting the user row — Sanctum's
        `personal_access_tokens` is a polymorphic table with no real FK,
        so it would NOT have been caught by cascade deletes otherwise —
        then deletes the user row itself inside a `DB::transaction()`,
        which cascades through every other user-owned table (verified
        against every migration's FK definitions during the E3d
        planning note); (4) typed confirmation — literal `DELETE` or the
        account's own email, checked both server-side (`deleteAccount()`)
        and client-side (`DeleteAccountPanel.tsx` disables the button
        until it matches, so there's no "looked right but the server
        rejected it" gap). New route: `DELETE /user/account`, sitting
        outside the `subscribed` middleware group alongside
        `/user/sessions` and `/auth/logout` — account deletion shouldn't
        require an active subscription to use. Frontend: new
        `DeleteAccountPanel.tsx`, collapsed by default behind a "Delete
        My Account" button so the danger zone doesn't sit open on page
        load, plus a native `confirm()` as a second guard before the
        actual request fires. On success, clears the local auth store and
        navigates to `/`. **Known limitation, stated plainly:** the
        PayPal-cancellation branch of this flow could not be exercised
        against a real PayPal subscription from the sandbox this was
        built in (no PayPal credentials/network access there) — the code
        is written and reasoned through (mirrors the existing, already-
        working `PayPalController::cancel()` pattern exactly), but needs
        a real smoke test against an active sandbox/live subscription
        once deployed. Verified with `tsc --noEmit`, a full
        `npm run build`, and a brace/paren balance check on every touched
        backend file — all clean.

- [x] **E4 — New Privacy tab.** Checked what actually exists first,
      specifically to avoid shipping another decoy field (the `grok`
      lesson from Phase D) — **this app has no email/marketing
      notification system at all, and nothing tracks analytics inside the
      authenticated editor** (the one `analytics` hit in the whole
      frontend is an unrelated try/catch comment on the public landing
      page). So "email preferences" and "analytics opt-out" toggles would
      control nothing real today — not proposing either. Built exactly
      the 4 grounded items from the audit, nothing more:
        - **Export My Data** — `GET /user/export`
          (`AuthController::exportData()`) returns a single JSON
          attachment: account info, every project with its files
          (including content), and full chat session/message history.
          Built directly off Eloquent relations (`$user->projects()`,
          `$user->chatSessions()`) rather than assembled ad hoc, so it
          stays correct if those relations change. Frontend
          (`PrivacyPanel.tsx`) fetches it as a blob and triggers a
          browser download, reading the filename back out of the
          `Content-Disposition` header the backend sets.
        - **Default project visibility** — new `default_project_visibility`
          column on `users` (migration
          `2026_08_09_000002_add_account_privacy_settings_to_users.php`),
          settable via `PUT /user/default-visibility`.
          `ProjectController::store()` now falls back to it instead of a
          hardcoded `'private'` when a create request doesn't pass an
          explicit `visibility` — the existing `sharing.enable` plan gate
          right below it is untouched, so a Starter-tier user can still
          only get a private project even if their stored default says
          public.
        - **Clear AI Chat History** — `POST /user/chat-history/clear`
          deletes every row in `$user->chatSessions()`; `chat_messages`
          cascades via its existing `session_id` FK, so no separate
          message cleanup was needed.
        - **Link to Delete Account** — `PrivacyPanel.tsx` ends with a
          "Go to Account" button that switches `SettingsPage`'s
          `activeTab` to `'general'` rather than duplicating
          `DeleteAccountPanel` in two tabs.
        - Confirmed still **not** in v1, unchanged from the original
          audit: new-device login email alerts, marketing email opt-out,
          analytics opt-out — none of the underlying systems exist yet.
        All 3 new endpoints sit outside the `subscribed` middleware
        group — these are data-rights/preferences, not paid features.
        Verified with `tsc --noEmit` and a full `npm run build` — clean.

- [x] **E5 — Other gaps found during this audit** (the "what else is
      missing" ask). Both flagged items resolved and shipped; 2FA
      confirmed still out of scope:
        - **Password-change flow — done.** New `password_set_at`
          (nullable timestamp) column on `users`, set at registration and
          re-stamped whenever a password is (re)set — deliberately left
          out of `User::$fillable` so it's never settable from raw
          request input, only programmatically. `User::has_password`
          accessor is `password_set_at !== null`. Existing accounts were
          backfilled in the same migration: email/password signups
          (no `google_id`) get `password_set_at = created_at`;
          Google-only accounts are left `null`, matching the definition
          of "no password the user actually knows." Single endpoint,
          `PUT /user/password` (`AuthController::changePassword()`),
          serves both modes off that one flag — Google-only users get
          **"Set a Password"** (no `current_password` required, since
          there isn't one to check — this *adds* email/password login
          without touching Google), everyone else gets **"Change
          Password"** (`current_password` required and verified via
          `Hash::check()`), exactly the 2026-08-08 decision. Frontend:
          new `PasswordPanel.tsx`, label and required fields driven by
          `user.has_password`.
        - **Connected-accounts indicator — done.** New
          `ConnectedAccountsPanel.tsx` in the Account tab shows two rows,
          Email & Password (green "Connected" whenever `has_password` is
          true — including a Google-only account that later set one) and
          Google (green "Connected" whenever `google_connected` is true).
          The raw `google_id` itself is never sent to the frontend — only
          the boolean `google_connected`, computed server-side in
          `AuthController::formatUserResponse()`.
        - **Two-factor authentication** — still out of scope for this
          phase, unchanged from the original note; a genuinely bigger
          feature than anything else listed here.

- 2026-08-09 — Post-Phase-E gap audit (no new phase, just verification):
  walked every route/controller/frontend-service/component path added in
  the E3d/E4/E5 session for breaks. Everything wired correctly except one
  real bug: `PrivacyPanel.tsx`'s "Export My Data" reads
  `res.headers['content-disposition']` to get the server-generated
  filename from `AuthController::exportData()`, but
  `backend/config/cors.php` had `'exposed_headers' => []` — browsers strip
  any response header not on that list for cross-origin requests (frontend
  and backend are different origins here), so the header was always empty
  and every export silently used the generic client-side fallback filename
  instead. Not a crash, just a silently-broken filename. Fixed by adding
  `'Content-Disposition'` to `exposed_headers`. Also fixed a stale comment
  in `SettingsPage.tsx` still saying "4 tabs" after Privacy became the
  5th. No other gaps found — `database/schema.sql` is a pre-existing stale
  snapshot from before Phase A (migrations are the real source of truth),
  left untouched as out of scope for this audit.

- 2026-08-09 — Bookkeeping only, no code change: checked the whole file
  for anything still open after the E3d/E4/E5 session above and found
  exactly one — **E2**'s own parent checkbox was still `[ ]` even though
  all 5 of its sub-items (E2a, E2b, E2b sub-part, E2b sub-part 2, E2c)
  have read `[x]` since 2026-08-08. Nothing left to build; just the
  checkbox was never flipped. Marked `[x]`. Also double-checked the one
  other loose thread in this file — the B3d model-tier policy question
  raised on 2026-07-30 — and confirmed it was already answered in the
  entry immediately below it that same day. With that, every phase in
  this tracker (A through E) is complete and there are no remaining
  open items.

- 2026-08-09 — E3d, E4, E5 complete — Phase E done. Also fixed the
  production-breaking regression this session started from: the E3b
  commit (`a22c44d`) refactored token creation into
  `createTokenWithMetadata(User $user, Request $request)` and updated 3
  of 4 call sites, but missed `handleGoogleCallback()`, whose signature
  had no `$request` parameter at all — every Google sign-in was throwing
  `Undefined variable $request`, caught by the method's own
  `catch (\Exception $e)`, and silently redirecting to
  `/login?error=Google login failed`. Fixed by adding `Request $request`
  to the method signature (Laravel injects it automatically); no other
  changes needed. New migration
  `2026_08_09_000002_add_account_privacy_settings_to_users.php` adds
  `password_set_at` and `default_project_visibility` to `users`. 5 new
  routes, all outside the `subscribed` middleware group (account
  security/data-rights, not paid features): `PUT /user/password`,
  `DELETE /user/account`, `GET /user/export`,
  `PUT /user/default-visibility`, `POST /user/chat-history/clear`. 4 new
  frontend components (`PasswordPanel`, `ConnectedAccountsPanel`,
  `DeleteAccountPanel`, `PrivacyPanel`) plus a new "Privacy" tab in
  `SettingsPage.tsx`. Verified with `tsc --noEmit`, a full
  `npm run build`, and a brace/paren balance check on every touched
  backend file — all clean. Known gap carried forward: the PayPal-
  cancellation branch inside `deleteAccount()` needs a real smoke test
  against an actual subscription once deployed (see E3d note above) —
  same sandbox-network limitation as E3b's `ip-api.com` call.

- 2026-08-08 — E1 complete. `SettingsPage.tsx`'s tab container was
  `flex flex-col gap-2` unconditionally — already vertical on mobile,
  which was the actual reported problem (a tall stack of full-width
  buttons pushing tab content below the fold). Now `flex-row
  overflow-x-auto` below `md:`, reverting to the original fixed-width
  vertical sidebar unchanged at `md:` and up. Used a negative-margin bleed
  trick (`-mx-6 px-6`, canceled via `md:mx-0 md:px-0`) so the scrollable
  pill row can be dragged flush to the screen edges on mobile, matching
  the page's own `p-6` outer padding exactly rather than leaving dead
  space on either side. `TabButton` itself changed from unconditional
  `w-full` to `md:w-full` + `shrink-0 whitespace-nowrap`, since `w-full`
  inside a `flex-row` parent would have made each pill try to fill the
  entire row rather than sitting side-by-side. Verified with `tsc
  --noEmit` — zero errors.

Decisions made 2026-08-08 (previously open questions):
- **E3a, full_name:** `username` stays the display name. No new column,
  no registration-form change — proportionate for a coding platform,
  avoids a migration for marginal benefit.
- **E3b, session location accuracy:** going with the more accurate option
  — a real IP → city/region/country lookup (`ip-api.com`, free tier, no
  API key) called server-side once at login/token-creation time, not
  per-page-load. Skip the lookup entirely for local/private IPs
  (127.0.0.1, LAN ranges) during dev — nothing meaningful to resolve
  there. Must fail gracefully (short timeout + catch) so a slow or dead
  third-party service can never block login itself; store the IP either
  way and leave location fields null on lookup failure. Caveat: this
  specific HTTP call couldn't be executed from the sandbox this was built
  in (`ip-api.com` isn't on that environment's allowed-domains list) — the
  code is written and reasoned through, but the actual live call needs a
  real smoke test once deployed.
- **E5, password change for Google-only users:** relabel rather than
  force a false choice, matching how GitHub/Google-linked products handle
  this. If `google_id` is set and no separate password was ever
  deliberately chosen, show **"Set a Password"** (adds email/password as
  a second login method, doesn't touch Google login). Everyone else gets
  the normal **"Change Password."** Cheap to key off since `google_id`
  already exists on the model.

- 2026-08-12 — F1e: preview links still 500ing after the F1d
  route-path/status fixes landed (commit `f654125`). Root cause was a
  second, independent bug in the same `location = /api/v1/internal/
  preview-resolve` block: the manual `fastcgi_param SCRIPT_FILENAME` /
  `REQUEST_METHOD` / `QUERY_STRING` overrides were placed *before*
  `include fastcgi_params;`, not after. nginx's stock `fastcgi_params`
  sets `REQUEST_URI $request_uri;`, and `$request_uri` is the **outer
  client request's own URI** even inside an `auth_request` subrequest —
  not this location's own path. Since nginx uses last-directive-wins
  for repeated `fastcgi_param` names, the `include` silently clobbered
  `REQUEST_URI` back to whatever the visitor actually requested (`/`,
  `/favicon.ico`, ...), so Laravel routed on *that* instead of ever
  reaching `PreviewResolveController`: `/` matched `routes/web.php`'s
  `Route::get('/', fn() => view('welcome'))` (200, no `X-Target-*`
  headers → nginx's `proxy_pass http://$target_host:$target_port;`
  became `http://:` → `"invalid port in upstream ':'"`); anything else
  had no matching route → genuine Laravel 404 → `auth_request`
  converts any non-2xx/401/403 subrequest status to a flat 500 before
  `error_page` runs → `"auth request unexpected status: 404"`.
  Confirmed by curling `/api/v1/internal/preview-resolve` directly
  through the `api.ubiq-editor.space` server block with a real preview
  token — correct `X-Target-Host`/`X-Target-Port` came back every
  time, proving the controller/routing/migration side was never the
  problem, only what `REQUEST_URI` looked like inside the subrequest.
  **Fix:** reordered so `include fastcgi_params;` runs first, then
  explicit `fastcgi_param REQUEST_URI`, `DOCUMENT_URI`, and
  `SCRIPT_NAME` overrides after it so nothing downstream can reset
  them back to the visitor's URL.

- 2026-08-12 — F1f: after F1e's `nginx.conf` fix was committed and
  pushed (and `git pull`/`nginx -s reload` both run on the server), the
  exact same two errors kept appearing, byte-for-byte identical to
  before the fix. Traced to `ubiq_nginx`'s bind mount of `nginx.conf`
  being a **single-file** bind (`./nginx.conf:/etc/nginx/conf.d/
  default.conf` in `docker-compose.yml`), which Docker attaches to the
  specific inode present at container-creation time — not to the path.
  `git pull`/`git checkout` don't edit a file in place, they write a
  new file and rename it over the old path; that rename swaps which
  inode the directory entry points to, but the container's mount
  namespace stayed pinned to the old, now-orphaned inode. Confirmed via
  `docker exec ubiq_nginx md5sum /etc/nginx/conf.d/default.conf` not
  matching `md5sum nginx.conf` on the host, and the file sizes/mtimes
  inside vs. outside the container disagreeing even right after a
  `pull` + `nginx -s reload` (reload just re-read the same stale
  mounted file — restart alone would have hit the same wall, since
  restart keeps the same container and the same stale mount). Directory
  bind mounts (`./backend:/var/www/html` for `ubiq_api`) don't have
  this problem, only single-file ones. **Fix:** no code change — the
  container has to actually be recreated, not just reloaded/restarted,
  for a single-file bind mount to pick up a `git pull`'d file:
  `docker compose up -d --force-recreate nginx`. Worth remembering for
  any future edit to `nginx.conf` specifically (not an issue for
  `backend/`'s directory mount).

  **Exact fix sequence that actually resolved the live preview-link
  500s (for reference — both steps were required, neither alone was
  enough):**
  1. `nginx.conf` — reorder `include fastcgi_params;` before the
     manual `fastcgi_param` overrides in the
     `location = /api/v1/internal/preview-resolve` block, and add
     explicit `REQUEST_URI`/`DOCUMENT_URI`/`SCRIPT_NAME` overrides
     after the include (F1e's fix). Committed and pushed as
     `f654125` — this repo's `nginx.conf` on `main` already reflects
     it, no further code change needed here.
  2. On the server, after `git pull` brought `f654125` down:
     `docker exec ubiq_nginx nginx -t` (validate) then
     `docker compose up -d --force-recreate nginx` (**not**
     `nginx -s reload` and **not** `docker restart ubiq_nginx`,
     both of which keep the same stale-inode bind mount from F1f).
  3. Verified via `docker exec ubiq_nginx md5sum
     /etc/nginx/conf.d/default.conf` matching `md5sum nginx.conf` on
     the host, then confirmed live against a real
     `preview-{token}.ubiq-editor.space` URL in-browser.
  Should either bug regress after a future `nginx.conf` edit, check
  in this order: (a) is the edit actually in `git log -1 -- nginx.conf`
  on the server, (b) does `docker exec ubiq_nginx md5sum
  /etc/nginx/conf.d/default.conf` match the host file, (c) only then
  look at the `auth_request`/`fastcgi_param` logic itself again.

- 2026-08-12 — F1f (frontend, same PLAN letter reused — this is the
  `ProjectRunner.tsx` half of the same symptom, not a new bug):
  with F1e/F1f (nginx) both live, preview links load correctly, but
  the Sandbox Server panel's log terminal + "Open Preview in New Tab"
  view was gone, replaced silently by the live app rendered straight
  in the panel (e.g. a project's own login screen appearing where logs
  used to be). Root cause: `ProjectRunner.tsx` has two overlapping
  blocks in its view area — the log terminal (`z-10`, shows while
  `isRunning || isPollingActive || previewUrl`) and a "SUCCESS IFRAME"
  block (`z-20`, shows when `previewUrl && !isMixedContent &&
  !isRunning && !error`) that auto-embeds the running sandbox.
  `isMixedContent` is `https page + http:// previewUrl` — back when
  preview links were plain `http://` (pre-F1d), this was always true,
  so the iframe block never rendered and the log terminal (with its
  own "Open Preview in New Tab" banner, gated on `isMixedContent`) was
  the only thing visible — this is the "as earlier" behavior being
  asked for here. Now that preview links are `https://`,
  `isMixedContent` is always false, flipping which block wins: the
  iframe now renders unconditionally and, being `z-20` over the log
  terminal's `z-10`, silently covers it on every run. This exact
  mechanism was already flagged as a known consequence in F1d's note
  above ("isMixedContent check correctly switched to its https-iframe
  branch") — at the time assumed to need no frontend fix once
  routing/cert landed, but the actual product intent turned out to be
  logs-first (this panel is a build/run console, not an embedded
  browser), so the iframe auto-embed itself needed to stop, not just
  "work." **Fix:** the "Open Preview in New Tab" banner inside the log
  terminal block is no longer gated on `isMixedContent` — it now shows
  any time `previewUrl && !isRunning`, matching the pre-F1d behavior
  unconditionally instead of only for the http case. The SUCCESS
  IFRAME block is disabled (`false && ...`, left in place rather than
  deleted) so it can never again cover the log panel; embedding could
  come back later as an explicit opt-in if wanted, but isn't the
  default.

- 2026-08-12 — F1g: Vite >=5.4.15/6.x's DNS-rebinding protection
  (GHSA-vg6x-rcgg-rjx6) rejects any request whose `Host` header isn't
  localhost/127.0.0.1 or explicitly in `server.allowedHosts` — every
  `preview-{token}.ubiq-editor.space` request hit "Blocked request.
  This host ... is not allowed." straight from Vite's own dev server.
  **First fix** (`eeeb0fee`): added
  `export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='.ubiq-editor.space,
  ubiq-editor.space'` (Vite's own documented env-var escape hatch for
  platforms that own their preview domain — no per-project
  vite.config.js patching needed) inside `defaultStartCommands()`'s
  react/vue and angular branches.
  **Bug in that fix:** only worked for projects using the *default*
  start command. `generateStartupScript()`'s "Start server" section
  branches on `!empty($config['start'])` — any project with its own
  `start` command (from `ubiq.json`) takes that branch and never calls
  `defaultStartCommands()` at all, so the export never ran for those
  projects. Symptom looked inconsistent ("works for this project, not
  that one") but tracked exactly to which branch each project's
  startup script took, not project age or Vite version.
  **Fix:** moved `$lines[] = self::VITE_ALLOWED_HOSTS_EXPORT;` to
  right before the `if (!empty($config['start']))` split in
  `generateStartupScript()`, so it's set once, unconditionally, ahead
  of both branches. Removed the now-redundant per-branch lines inside
  `defaultStartCommands()`. No-op for non-Vite frameworks.
  If this regresses again: open the failing project's `startup.sh` in
  the file browser and confirm the `export __VITE_ADDITIONAL_SERVER_
  ALLOWED_HOSTS...` line is present near the top, before whichever
  start command follows — if it's missing, the deploy didn't land
  (check `docker compose restart api`, since `optimize:clear` doesn't
  reset opcache and `backend/` is volume-mounted straight into the
  container); if it's present and still blocked, check what Vite
  version actually resolved for that project (env-var support landed
  in a specific Vite point release, slightly after the allowedHosts
  check itself — a project pinned in that narrow gap won't honor it).

  **Follow-up, same session, deeper bug than either fix above:** even
  with the export landing correctly (confirmed present in a live
  project's `startup.sh`), a fresh preview link still hit "Blocked
  request... not allowed." The env var itself does nothing on its
  own — `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` isn't a name Vite
  knows about; something has to actually read it into
  `server.allowedHosts`. Checked all three `vite.config.js`/`.ts`
  templates in `BoilerplateManager.php` (react, vue, angular) — none
  of them did. They hardcoded `host`/`port` and never touched
  `allowedHosts` at all, so every single scaffolded project has been
  missing this regardless of which `generateStartupScript()` branch
  it took — the two fixes above got the export itself correct and
  consistent, but nothing was ever plugged into the other end.
  **Fix:** all three templates now read
  `process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`, split on `,`,
  and pass the result into `server.allowedHosts`. Only fixes **new**
  scaffolds going forward — `"DO NOT REGENERATE: ... vite.config.js"`
  is baked into the AI-generation prompts specifically so existing
  projects' configs are never silently rewritten, so every
  already-scaffolded project needs this patched into its own
  `vite.config.js` by hand once. If a specific project's preview
  still 400s after this: open its `vite.config.js` in the file
  browser and confirm the `allowedHosts` line is actually there —
  if it's not, that project predates this fix and needs the manual
  one-line patch, not another look at nginx or the export itself.

- 2026-08-12 — F1h: added the "Sandboxes" left-nav page. This wasn't
  in the original `UBIQ_ENHANCEMENT_ROADMAP.md` — it's a direct
  product ask ("user could run sandboxes... add new menu item... show
  Sandbox list... aware what sandboxes running, stopped, health,
  vitals... stop/remove") — but it's purely a read + stop layer over
  `SandboxRun` tracking that F0–F1d already built, so no new
  sandbox-lifecycle logic was needed, just a new way to see and act on
  what already exists.

  **Why a new `SandboxController` instead of extending
  `ProjectController`:** every existing sandbox endpoint
  (`run`/`stop`/`heartbeat`) is inherently scoped to one project at a
  time (`{project}` in the route). The new page needed the opposite —
  "every sandbox this user has, across every project, in one list" —
  which doesn't fit that shape without bolting an unrelated
  cross-project query onto an already-2800-line controller. Kept
  `stop()`'s actual container-removal logic byte-for-byte equivalent
  to `stopProject()`'s (force-remove, verify removal before stamping
  `stopped_at`, always release the `active_sandboxes` counter) rather
  than inventing a second version — see that method's own comments for
  why each step exists. The only real difference: this `stop()` is
  addressed by `SandboxRun` id, not "the project's latest open run",
  since a cross-project list operates on individual rows.

  **Reconciling DB vs. real Docker state for the list:** a `SandboxRun`
  with `stopped_at IS NULL` normally means "running", but
  `reapStaleSandboxes()` only self-heals a dead row the next time that
  project's `run` endpoint is hit — a user who never clicks Run again
  would otherwise see a permanently-"running" card for a container
  that's actually gone. `SandboxController::index()` calls
  `docker inspect` per open row on every request and reports
  `crashed` instead of `running` when Docker disagrees, so the list is
  honest without needing to actually run the reap-and-mutate logic
  itself (that stays exactly where it already lived, triggered by the
  next real `run` click, not by viewing this page).

  **Vitals:** CPU/Memory/Network come from `docker stats --no-stream`,
  called only for rows already confirmed `running` (skipped for
  stopped/crashed, where there's nothing to sample). Cheap enough to
  run synchronously per request here for the same reason
  `reapStaleSandboxes()` considered its own per-user Docker calls
  cheap: global sandbox concurrency is capped around 3
  (`SANDBOX_GLOBAL_CONCURRENT_LIMIT`), so this is at most a handful of
  `docker` invocations, not an unbounded fan-out.

  **Frontend:** deliberately reused `ProjectsPage.tsx`'s exact card-grid
  shell (header, search input, empty state, card corners/hover/spacing)
  rather than designing a new pattern, per the ask to "follow same
  UI/UX as projects list." Polls `GET /sandboxes` every 10s while the
  page is open (matches the existing `useSandboxAutoStop.ts` heartbeat
  cadence order-of-magnitude) so vitals and crash detection stay live
  without needing a websocket for what's fundamentally a dashboard, not
  a real-time console. A client-side 1s tick re-renders the "Up Xm Ys"
  counter between polls so it doesn't visibly stall for 10 seconds at a
  time.

  **Not done in this pass, worth a follow-up if this page gets used a
  lot:** no bulk "stop all" action, and the history list is capped at
  the last 15 stopped runs with no pagination — both were deliberately
  left out to keep this a thin read layer rather than growing new
  product surface area beyond what was asked for.

- 2026-08-12 — F1h follow-up: per-sandbox detail page. Direct product
  ask ("user could see history of it, and also its crashed it could
  see why its crashed") — clicking a card on the Sandboxes list page
  now opens `/sandboxes/{id}` instead of jumping straight to the
  project; the folder icon/project title inside a card still shortcut
  to the project directly (now with `stopPropagation` so they don't
  also fire the card's own navigate).

  **Backend:** new `SandboxController::show()` / `GET
  /sandboxes/{sandboxRun}` — same per-row `dockerHealth()`/
  `dockerStats()`/`formatSandbox()` the list already used, plus two
  things a list row has no room for:
    - **Raw log** — read from `{workspace}/startup.log`, but only if
      this run is currently that *project's* latest one.
      `runProject()` truncates that same path fresh on every new run
      (one file per project, not per run), so anything older has
      already been overwritten by whatever ran after it. Surfaced
      honestly as `log_available: false` + a `log_note` explaining why,
      rather than either erroring or silently showing the wrong run's
      content.
    - **Crash summary** — best-effort parsed reason, not just the raw
      dump. If Docker still has the container (`docker_status !==
      'missing'`): `docker inspect`'s `ExitCode`/`OOMKilled`/`Error`/
      `FinishedAt` drive a short one-line reason (OOM, a Docker-level
      error, or a bare exit code pointing at the log). If the
      container's already gone entirely (already `docker rm`'d — no
      inspect data left to have an opinion from): falls back to the
      same Node-crash-banner heuristic `ProjectController::
      getBuildLog()` already established (`/Node\.js v\d+\.\d+\.\d+\s*$/`
      as the last log line only happens when something killed the
      process unexpectedly), then a plain "already removed, nothing
      further to show" as the last resort. Never fabricates a reason
      it doesn't have evidence for.

  **Frontend:** new `SandboxDetailPage.tsx`, styled to match
  `ProjectInfoPage.tsx`'s existing detail-page conventions (back link,
  header layout, `Layout` wrapper) rather than inventing a new pattern.
  Polls every 5s (tighter than the list's 10s, since this is the page
  you're actually staring at while debugging a crash) and auto-scrolls
  the log view to the bottom as it grows, same behavior as the
  editor's own Live Server Logs panel.

  **Known limitation, same one flagged on F1h itself:** history
  browsing works (any stopped run in the list now opens its own detail
  page too, not just running/crashed ones), but only the *current* run
  per project ever has a raw log — older runs in history will
  correctly show as unavailable rather than wrong. If full per-run log
  history matters going forward, that needs a schema change (persist
  log content or a storage key at stop-time) — flagged here rather
  than attempted, since it's a meaningfully bigger scope than what was
  asked for this pass.
