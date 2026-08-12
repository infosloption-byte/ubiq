# Ubiq Editor — Enhancement Roadmap
*Prepared August 9, 2026. Companion to the competitive analysis; this is the "now what do we actually build" document.*

## How this roadmap was built

Not by matching competitor feature lists. Each item below was tested against one question:
**"If this stays missing, which real customer walks away, and why — versus, does having it just make us look more like Replit?"**

Anything that only exists to mirror a competitor got cut — that's blind copying, which you specifically asked to avoid. Anything that closes a gap a real customer would actually hit got kept, whether or not a competitor has it. And everything is checked against what's *already built* in the codebase — several of these are smaller lifts than they'd look from the outside, because the groundwork already exists (noted per item).

Three buckets:
- **Retention-critical** — missing this loses customers who'd otherwise pay, regardless of how good the differentiators are.
- **Differentiation** — the "nobody else offers this" bets, per your steer.
- **Later / earn it** — real, but only worth building once the first two buckets are proven with actual users.

Point 6 from the earlier report (no BaaS clone, no mobile app, no full autonomous agent) stays excluded throughout, as agreed.

---

## P0 — Fix now, ahead of everything below: concurrent sandbox slots leak on every re-run

*(Found 2026-08-09 while discussing why Pro users hit "sandbox limit reached" after re-running the same project only twice. This isn't a roadmap item — it's a live bug actively costing Pro conversions/retention right now, so it belongs ahead of the build order below, not inside it.)*

**Root cause, traced end to end:**
1. The Run button (`ProjectRunner.tsx: handleRun()`) calls `runProject()` directly — nothing stops the previous run first. Editing code and clicking Run again (the ordinary development loop) never triggers a Stop.
2. Every run creates a **brand-new** `SandboxRun` row (`claimPortAndReserve()` → `SandboxRun::create()`) rather than reusing or closing the previous one for that project.
3. The sandbox container name is `ubiq_project_{$project->id}` — **identical across every run of a project, with no run ID in it.** The automatic cleanup (`reapStaleSandboxes()`) decides whether an old row's slot can be freed by running `docker inspect` on that name — but since the *new* run's container shares the exact same name and is genuinely alive, the check always reports "still running" for the *old* row too. It has no way to tell the two apart.
4. Net effect: **every re-run of the same project without an explicit manual Stop permanently leaks one concurrent slot.** On Pro (limit 2): run once → 1 slot silently and permanently stuck, run again → both slots consumed, third run → hard denied with no natural recovery, since `'concurrent'`-type counters have no time window to reset on (unlike the hourly/daily AI-request counters) — it doesn't come back "next month," it stays stuck until someone manually stops it or an admin fixes the row directly.

**Why the fix is not "raise the limit" or "switch to a per-day/hour run-count cap":** a total-run-count model would be worse for the actual workflow here — active development means running the same project many times in one session, and a "5 runs/hour" ceiling gets hit by normal iteration, not abuse. Concurrent-slot limiting is the right model for a dev sandbox; it just needs to work as designed.

**The fix:**
1. **Primary fix:** in `runProject()`, before calling `authorize()`, explicitly close out any existing open `SandboxRun` for *this same project* — reusing the same close-out logic `stopProject()` already has — so re-running a project always self-releases its own previous slot first, atomically, instead of depending on the fragile name-based reap check to notice later (which, per the root cause above, it structurally can't).
2. **Defense in depth:** include the run ID in the container name (not just the project ID), so `reapStaleSandboxes()` can correctly distinguish an old run's container from a new one in genuine edge cases (crash, browser closed mid-session) instead of relying on this one call site always behaving correctly.

This restores the limit to actually meaning what it was designed to mean — Pro genuinely gets 2 concurrent sandboxes, and iterating on one project never silently costs a slot it can't get back.

---

## Bucket 1 — Retention-critical (do these first)

These aren't differentiators. They're the floor. A developer who builds something in Ubiq and then can't ship it, or hits a wall a $12/month competitor doesn't have, leaves — and doesn't come back to try the differentiators later.

### F1 — Full-stack sandbox parity + a truly portable export
*(Rewritten 2026-08-09 — corrects a mistake in the original F1/F2 split, see note below.)*

**Correction, stated plainly:** the original F1/F2 split proposed permanent, always-on public hosting plus a shared production database with storage quotas — that's Ubiq becoming a hosting company, which directly contradicts point 6 that was already agreed on. That framing didn't match the platform's actual purpose: the sandbox exists so a person can *verify* code runs, then take the exact same setup anywhere they want — not so Ubiq becomes the place it runs forever. This section replaces that with a plan built around the sandbox itself, not around Ubiq hosting anyone's production traffic.

**The real gap, found while checking whether "download and self-deploy" already works as intended:** it doesn't, quite. `runProject()` currently picks a generic base image at runtime from in-memory PHP config (`node:22-alpine`, `php:8.3-cli-alpine`, etc.) and builds a `docker run` command on the fly — that logic lives entirely on the platform side and is never written anywhere into the project itself. The existing `download()` endpoint (already built, zips the workspace directory) only ever ships source files — no Dockerfile, no compose file, nothing capturing *how* it was actually run. So today, "take what you tested to your own server" means reverse-engineering the setup from memory, not literally taking what ran. That's worth fixing independent of anything else below.

**Also confirmed while checking feasibility:** boilerplates today (`BoilerplateManager`) are single-runtime, single-framework only — react, vue, laravel, node, nextjs, angular — there's no multi-service or "frontend + backend + DB together" concept anywhere yet. Full-stack sandboxing is genuinely new capability, not a small extension — worth sizing honestly rather than downplaying.

**F1a — Externalize the real Dockerfile into the project**
- Generate an actual `Dockerfile` from the same framework-detection logic that currently only exists as an in-memory PHP array, and write it into the project's own workspace directory (alongside the source, the way `ubiq.json` already gets written by `BoilerplateManager`) instead of keeping it as a `docker run` string that only ever lives on the platform side.
- The existing `download()` zip then ships this automatically, with no changes to the download logic itself — closing the "is this really what I tested?" gap directly.

**F1b — Multi-service sandboxes (`docker-compose`, not just `docker run`)**
- Move project execution from a single `docker run` per project to a generated `docker-compose.yml` — starts as a drop-in equivalent for today's single-container case, but opens the door to a `db` service alongside the app service(s) for full-stack (frontend + backend + DB together) testing, which is exactly the "try backend and frontend with a connected database" case you want to test next.
- **Capacity accounting stays simple on purpose:** treat one `docker-compose` stack (however many services it contains) as **one slot against the existing `SANDBOX_GLOBAL_CONCURRENT_LIMIT`**, the same as a single container counts as one today. This avoids inventing new capacity math for a resource-constrained box — a full-stack sandbox costs the same "one slot" a single-container sandbox already does.

**F1c — A database inside the sandbox, not a production database service**
- The `db` service from F1b gets a project-scoped Docker volume, so data survives a stop/start of *that project's* sandbox the same way its source files already do — but the container itself only runs while the sandbox is active, never as a standing service. No shared multi-tenant instance, no storage-quota system, no new operational class to run — it's bounded by the same per-project storage constraints that already apply to a project's files.
- This directly replaces the original F2 (schema-per-project on a shared MySQL instance) — that was solving "give a hosted app a permanent database," which isn't the actual need. This solves "let me test my frontend, backend, and DB together before I take it somewhere," which is.
- `F1a` means this ships in the export too: the generated `docker-compose.yml` includes the `db` service definition, so self-deploying elsewhere reproduces the exact same multi-container setup that was tested.

**F1d — Ephemeral preview links**
Per your call to keep this: a way to share a live link *while a sandbox session is running*, without any permanent hosting commitment.
- Every running sandbox already has a `SandboxRun` row with its allocated port, `started_at`/`heartbeat_at`/`stopped_at` — a preview link is a signed token derived from that row, resolving to `preview-{token}.ubiq-editor.space` proxied to the sandbox's already-allocated port. No new lifecycle to invent: the link stops resolving the moment the existing reaping logic marks that `SandboxRun` stopped.
- Subdomain rather than a path prefix (e.g. `/preview/{token}/`) deliberately — a path prefix breaks root-relative asset paths and client-side router assumptions in a lot of frontend frameworks unless the app is specifically configured with a base path, and previews should behave exactly like the real thing without asking the user to configure anything for it.
- This does need a one-time wildcard cert (`*.ubiq-editor.space` via certbot DNS-01) — a genuinely small, one-time infra cost, justified specifically by making previews behave correctly, not by standing up permanent per-project hosting.
- Explicitly ephemeral by design: no deploy history, no rollback, no uptime story — if someone wants that, that's what F1a-c's honest export is for, on their own infrastructure.

**F1h — Sandboxes list page (added 2026-08-12, direct product ask, not from the original F1 scoping)**
- A new "Sandboxes" item in the left nav, separate from Projects, showing every sandbox the user has ever run — across *all* their projects — in one place: what's currently running, what's stopped, what's crashed, plus per-sandbox health (Docker's own `HEALTHCHECK` status where the image defines one) and live vitals (CPU%, memory, network I/O via `docker stats`).
- Why this belongs here and isn't just "reuse the per-project Sandbox Server panel": that panel is inherently scoped to one project's sandbox at a time (opened from inside a project's editor). The gap this closes is having *no* cross-project view at all — someone running sandboxes across three different projects had no single place to see "what do I currently have running anywhere," short of opening each project one by one.
- Built entirely on the existing `SandboxRun` audit table (no schema change) — this is a read layer plus a scoped `stop` action, not new sandbox-lifecycle logic. Reuses the exact stop sequence `stopProject()` already established (force-remove, verify, stamp, release the plan counter) rather than introducing a second way to tear down a container.
- UI/UX intentionally mirrors the existing Projects list (same card grid, search, empty state) rather than a new layout, so it reads as "the sibling list to Projects" instead of a bolted-on dashboard.

**Sequencing:** F1a (small, immediately closes the "is this really portable" gap, no dependency on anything else) → F1b (the real work — multi-service sandboxes) → F1c (the DB service, meaningless without F1b) → F1d (preview links, can happen in parallel with F1b/c since it only depends on the existing `SandboxRun` tracking, not on multi-service support) → F1h (list/visibility page, can happen any time after `SandboxRun` tracking exists — no dependency on F1b/c/d beyond that).

### F3 — GitHub OAuth instead of pasted personal access tokens
**The risk, sharper than originally scoped:** checked the actual storage, and it's worse than "pastes a token into a field" — `SourceControlPanel.tsx` currently stores the GitHub PAT **in plaintext in browser `localStorage`** (key `ubiq_api_keys`), not even server-side. That's readable by any XSS payload or malicious browser extension, doesn't sync across devices (so users likely re-paste it repeatedly, which normalizes exactly the wrong habit), and sits in stark contrast to the BYOK AI keys, which already get real server-side encrypted storage (`UserAiKey`, `'value' => 'encrypted'`). This is a real, fixable inconsistency, not a hypothetical trust concern.

**F3a — Register the OAuth App and add the redirect/callback routes**
- Mirrors the Google OAuth flow that already exists and works (`AuthController::handleGoogleCallback`) — same shape, second provider: `GET /auth/github/redirect` → GitHub consent screen → `GET /auth/github/callback` → token exchange.

**F3b — Store the token server-side using the pattern already proven in production**
- Either a new `provider = 'github'` row on the existing `UserAiKey`-style encrypted table, or a small dedicated `user_github_tokens` table if GitHub's refresh-token/scope handling doesn't fit that generic shape cleanly — either way, same `'encrypted'` Eloquent cast already trusted for AI keys, applied to a second credential type instead of a new storage mechanism being invented.

**F3c — Cut over the actual call sites**
- `SourceControlPanel.tsx`'s read from `localStorage.getItem('ubiq_api_keys')` and `ProjectController::importFromGithub()`'s `github_token` request param both need to switch to reading the server-stored token instead — the token should never round-trip to the browser at all once this ships.

**F3d — Migration for existing users**
- On first Source Control action after this ships, detect a legacy `localStorage` token, prompt a one-time re-auth via the new OAuth flow, then clear the old `localStorage` value client-side so it doesn't linger unused.

**F3e — Stretch: repo picker**
- A proper OAuth token with the right scopes makes a "pick from your repos" list a natural addition instead of requiring users to paste a repo URL by hand — not required for F3's core fix, but a nice, cheap byproduct once the token is real.

---

## Bucket 2 — Differentiation (the bets nobody else is making)

These are where "lean into what nobody else offers" actually pays off — not because they're novel for novelty's sake, but because each one addresses a specific, well-documented pain point from the competitive research, one that Ubiq's architecture is *already* positioned to solve better than the competition, almost by accident.

### G1 — Usage transparency dashboard
**Why this, specifically:** the single most repeated complaint across every Replit/Bolt/Lovable review pulled for the competitive analysis was billing opacity — credits burning unpredictably, no visibility into why. <cite index="4-1">"the same $100 pool can stretch very differently from one project to the next"</cite> is a direct quote from a Replit review, and it's not an isolated one. Ubiq already made the harder architectural choice (flat tiers + hard request caps instead of metered credits) — this just makes that choice *visible*, which is where the actual trust payoff is.

**What's already there to build on (checked the schemas directly):** `usage_counters` already tracks exactly what a dashboard needs — per-`counter_key` (`ai_requests`, `active_sandboxes`, etc.) counts against `hour`/`day`/`concurrent` windows, indexed for fast lookup. `plan_action_logs` already records every PlanGuard check with `allowed`, `reason`, and `metadata` on every single request. This is a reporting layer over data that's already being written on every action — there's no new instrumentation to build, only a UI and a couple of read endpoints.

**G1a — Backend aggregation endpoint**
- `GET /user/usage-summary`: for the authenticated user, current-window counts vs. caps per `counter_key`, plus the last N `plan_action_logs` denials. Pull the cap values through `PlanGuard`'s own lookup rather than duplicating the limit numbers anywhere else, so the dashboard can never drift out of sync with what's actually being enforced.

**G1b — Frontend dashboard panel**
- New "Usage" view (Settings, or its own nav item) — one bar/ring per `counter_key`, hour and day windows shown separately, and a plain-language line whenever the user is currently at or has recently hit a cap. Map the existing `reason` values (`concurrent_limit_exceeded`, `plan_lookup_failed`, etc.) to real sentences instead of showing the raw enum string.

**G1c — Surface the same reason at the point of failure, not just in the dashboard**
- When a PlanGuard check denies an action, show that same human-readable reason right where the denial happened (the chat input, the "start sandbox" button) — the dashboard becomes a reference someone can check anytime, not the only place this information ever appears.

**G1d — Stretch: seed for admin analytics (Bucket 3)**
- The same aggregation, run instance-wide instead of per-user, is most of what the admin analytics item in Bucket 3 needs — worth building G1a in a way that generalizes cleanly rather than as a strictly per-user query, so that later item is mostly a new view over the same data instead of a second aggregation layer.

**Effort:** low. Genuinely one of the best effort-to-trust ratios on this whole list — the hard part (collecting the data reliably) already shipped in Phase A/B.

### G2 — Multi-file diff review screen + user-controlled autonomy
*(Expanded 2026-08-09 after auditing the existing chat/apply/diff flow — see notes below. This replaces the original one-paragraph G2 sketch with a real spec.)*

**Where this actually stands today (verified in code, not assumed):**
- The existing single-file flow is genuinely safe: chat's **Apply** button (`ChatInterface.tsx` → `onApplyCode`) only calls `handleApplyCode()` → `setProposedContent()` — nothing is written to disk. The yellow "DIFF VIEW / Accept / Reject" banner reads from that same state. Only clicking **Accept** (`handleAcceptDiff()`) calls `handleSave()`, the one function that persists. Reject discards it. This is correct, already-shipped, human-in-the-loop behavior — G2 is not "add a review step," it's "make the review step scale past one file."
- **A second, currently-dormant code path already does the risky thing this whole roadmap is trying to avoid:** `CompletionController::generate()` (`POST /ai/generate`) asks the AI for a JSON map of `{filepath: content}` across as many files as it wants, and writes every single one straight to disk (`file_put_contents`) and the DB, with zero diff, zero confirmation. Its frontend wrapper (`aiAPI.generateProject`) has **no callers anywhere in the app** — new projects only get the plain framework boilerplate (`ProjectController::store()`), never AI content, so this path is inert in production today. But the logic is real and mostly reusable: it already resolves the AI's multi-file JSON output, sanitizes paths, and protects scaffold files from being overwritten (`getProtectedPaths()`, keyed per framework).
- **The plan is to redirect that existing multi-file generation logic through a new review screen instead of `file_put_contents()`, rather than building multi-file generation from scratch.** The hard part (getting clean structured multi-file output from the model, protecting scaffold files) is already solved; what's missing is the UI layer between "AI produced N files" and "those N files are on disk."

**G2a — Multi-file diff review screen (the core UI)**
- A batch review view, opened whenever an AI response (from chat *or* the rewired `generate()`/future multi-file chat responses) touches more than one file — modeled on a PR review, not a single Accept/Reject button:
  - A file list on one side: each changed file with a one-line +added/−removed stat, and a badge for **New / Modified / Deleted**.
  - Clicking a file opens its diff in the existing Monaco `DiffEditor` (already used for the single-file case — reused, not rebuilt).
  - **Per-file** Accept/Reject, plus **Accept All** / **Reject All** at the top for the common case of "this all looks right."
  - Files the AI wants to touch that are on the protected-scaffold list are visually flagged and blocked from silent overwrite regardless of autonomy setting (see G2c) — protection that already exists in `generate()`'s backend logic just needs to be surfaced in this UI rather than silently skipped.
- Nothing is written to disk until the user (or their autonomy setting, see G2c) confirms — same guarantee the single-file flow already gives, just extended to N files reviewed as one coherent change instead of N separate ones.

**G2b — Rewire `generate()` (and multi-file chat responses) into that screen**
- Change `CompletionController::generate()`'s final step from "write every file immediately" to "return the proposed file set to the frontend"; the frontend opens G2a's review screen with that set instead of silently refreshing the file tree.
- Extend the chat endpoint (`chat()`) so that when the model's response naturally implies changes across multiple files (not just one code block for the currently-open file), it can return a structured multi-file payload too — routed through the same G2a screen — instead of only ever offering one Apply button for whatever file happens to be open.
- Net effect: one review surface for both "generate a feature from scratch" and "chat asked for a change that touched 3 files," instead of two different (and one currently unsafe) code paths.

**G2c — User-controlled autonomy setting**
Directly per your ask — mirrors how Claude Code lets you choose your own risk tolerance instead of the platform deciding for you:
- A per-project (with a global default in Settings) toggle with three modes:
  1. **Always review** (default) — every AI-proposed change, single- or multi-file, opens G2a and waits for explicit Accept/Reject. This is the only mode available on Free/Starter, matching the "control by default" positioning from the competitive analysis.
  2. **Auto-apply, files I haven't protected** — the AI's changes write immediately *except* for files the user has explicitly marked as sensitive (e.g. `.env`, migrations, `package.json`) or that are on the framework's protected-scaffold list — those always stop for review regardless of this setting. This is the realistic middle ground for someone iterating fast who still wants a guardrail on the files that actually matter.
  3. **Fully autonomous** — everything auto-applies, no review screen at all. Gated to Creator/Pro (this is the mode with real risk, so it's reasonable to tie it to the tiers where users are more likely to know what they're doing and to be paying for the convenience).
- Store the setting on `UserPreference` (already has `editor_settings` as a JSON column — extend it rather than a new table) with a per-project override, so a user can run "always review" globally but flip one throwaway prototype project to fully autonomous.
- Whatever mode is active, log every AI-initiated file write to `plan_action_logs` (already exists from Phase A/B) with before/after content references — so even in fully-autonomous mode, there's an audit trail and a way to see exactly what changed and revert it, not just faith that it went well.

**G2d — UX polish, once G2a–c are functionally solid**
- A visible AI activity indicator while a multi-file response is being generated (the "Reading: App.jsx" context indicator already exists for single-file chat — extend that pattern to show "Planning changes across 4 files" during multi-file generation, so it doesn't look frozen).
- One-click revert for an already-accepted AI change (using the before/after references logged in G2c) — a safety net for "always review" users who approved something and changed their mind, and a critical safety net for anyone using autonomous mode.
- A short natural-language summary above the file list in G2a ("Added task priority field across 3 files, updated the form and the list view") generated from the same response, so reviewing doesn't require opening every diff to understand the shape of the change before deciding whether to look closer.

**Sequencing note:** G2a (the review screen) has to exist before G2c (autonomy modes) means anything — "always review" is the only mode that's meaningful without it, so build the screen first, prove it on the already-safe chat path, *then* rewire `generate()` into it (G2b) and add the autonomy toggle (G2c) once there's a trustworthy destination for autonomous writes to land in.

### G3 — Self-hosted / on-prem tier
**Why this is a real lever and not a copy:** literally none of Cluster A (Replit, Bolt, Lovable, v0) can offer this — they're built as multi-tenant SaaS from the ground up. It's the one column in the whole competitive table where Ubiq's architecture (already running as Docker-on-your-own-EC2) has a structural head start instead of a gap to close. Security/compliance-conscious teams — the same audience the earlier research flagged as wanting <cite index="40-1">"audit logs, permissions, SSO, and compliance templates"</cite> — are a real, underserved segment specifically *because* every fast-growing competitor is SaaS-only.

**What's already there to build on:** the repo already ships `docker-compose.yml`, `setup.sh`/`setup.ps1`/`setup.bat`, and a working `nginx.conf` template — this is already most of a working local install path (used today for dev), not a from-scratch effort. G3 is about hardening and packaging that path for a paying, external operator, not inventing it.

**G3a — Harden the existing compose setup for production use, not just dev**
- The current `docker-compose.yml` already has real security thought in it (the socket-proxy sidecar restricting Docker API access is a good sign of that) — audit it end to end for anything that's fine for a trusted single-operator dev box but not for an arbitrary customer's production environment (default passwords, open ports, missing resource limits) before calling it self-hostable.

**G3b — Config surface for what's currently hardcoded to *your* infra**
- `nginx.conf`'s `server_name ubiq-editor.space` and the CORS `allowed_origins` in `backend/config/cors.php` are hardcoded to your domain, and the wildcard-subdomain preview setup from F1d assumes your own DNS/certbot — a self-hoster running on their own domain needs all of this to become a first-run setup step (interactive script or a clearly documented `.env` pass) rather than something they have to find and hand-edit in PHP/nginx config files.

**G3c — Licensing/activation**
- A lightweight license-key check against a small licensing endpoint on your own infra (a signed token, checked periodically) — enough to keep self-hosted from becoming an unpaid-forever fork of the SaaS product, without building a heavyweight DRM system for what's likely to start as a small number of customers.

**G3d — Support/SLA definition**
- Self-hosted customers reasonably expect a different support relationship than a free-tier SaaS user — this needs an actual decision (response-time SLA, support channel, what "supported version" means as the SaaS product keeps shipping) before it's sellable, not just before it's installable. This is the one sub-item here that's a business decision more than an engineering task, and it's worth having an answer before the first self-hosted sales conversation, not after.

**Sequencing note:** this whole item is a sales-and-docs-heavy motion, not primarily an engineering one — put it after F1–F3 and G1–G2 are proven with real paying SaaS users, not before. Selling infrastructure control to a compliance-conscious buyer works a lot better with a track record behind it.

---

## Bucket 3 — Later / earn it

Real, but sequence these after Buckets 1–2 land, once there's actual usage data to justify them rather than guessing.

**Real-time collaborative editing.** Checked `PlanSeeder` directly: `sandbox.max_concurrent` is `1` on Free/Starter/Creator and `2` on Pro — that's concurrent *sandboxes for one user* (e.g. two browser tabs, or a frontend + backend sandbox open together), not shared seats for a team. There is no multi-seat/team concept anywhere in the `Plan` model today. Building CRDT-based collab (Yjs + a sync server, presence UI, conflict handling) is real, multi-week work — solving it before there's a plan that monetizes it means shipping a team feature with no team plan to sell it into. Revisit once a team tier exists; at that point this becomes the headline feature of that tier, not a bolt-on.

**SSO (SAML/OIDC).** Only matters once there's an enterprise/team tier to sell it into — pairs naturally with G3 (self-hosted), since the same buyer asking for self-hosting is the one asking for SSO. Bundle the two efforts when the time comes rather than building SSO in isolation first for a buyer segment that doesn't exist as a plan yet.

**Admin analytics UI.** Builds directly on G1a's aggregation (see G1d) once that's live — the same `usage_counters`/`plan_action_logs` data, queried instance-wide instead of per-user, surfaced as denial rate by tier, usage percentiles, and which `counter_key`s are actually the binding constraint across the user base. Useful for you, not customer-facing, so it's real but appropriately behind everything customer-facing above it.

---

## Suggested build order

0. **P0** (the concurrent-sandbox-leak fix above) — ahead of everything else; this is actively costing Pro conversions today, not a future improvement.
1. **F3a–d** (GitHub OAuth) — smallest, cleanest, reuses the Google OAuth + `UserAiKey` encryption patterns that already exist and already work. Also the one item with an active, verified security gap (plaintext localStorage token) rather than just a missing feature — reasonable to bump ahead purely on that basis.
2. **G1a–c** (usage dashboard) — smallest effort-to-trust-payoff ratio on the list, no new instrumentation needed, ships while F1 is being built.
3. **F1a** (externalize the real Dockerfile into the project) — small, and immediately makes `download()` honest about what it ships, independent of anything else.
4. **F1b** (multi-service `docker-compose` sandboxes) — the real work; everything else in F1 depends on this existing.
5. **F1c** (DB service inside the sandbox) — the specific "frontend + backend + database together" capability, built directly on F1b.
6. **F1d** (ephemeral preview links) — can run in parallel with F1b/c rather than strictly after, since it only depends on the already-existing `SandboxRun` tracking, not on multi-service support.
7. **G2a** (multi-file diff review screen, proven on the already-safe chat path) → **G2b** (rewire `generate()` into it, retiring its unreviewed direct-write behavior) → **G2c** (autonomy modes) → **G2d** (polish) — the real differentiator, sequenced after the retention-critical items so it's not competing for engineering time against things actively costing customers today, and internally sequenced so autonomy modes only ship once there's a trustworthy review screen for "always review" to mean something.
8. **G3a–d** (self-hosted tier) — once 1–7 are live and there's a track record to sell against; G3d (support/SLA) needs an answer before the first sales conversation, not just before the first install.
9. **Bucket 3** (collab, SSO, admin analytics) — revisit once there's a team/enterprise tier to justify them; admin analytics can move earlier opportunistically since it's mostly free once G1a exists.

The two things most worth explicitly *not* front-loading: custom domains and full production hosting (deliberately dropped from F1 entirely, not just deferred — see the correction note at the top of F1) and SSO/collab (Bucket 3), which is naturally gated by a team plan that doesn't exist yet.
