# Plan / Tier System — Implementation Tracker

Update this file in the same commit as the work it describes. Mark `[x]` when
done, add the commit hash next to it, and add short notes if a task changed
scope from what was originally planned.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

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
- [ ] D8 — **[security flag, informational]** AI provider keys and the
      remote Ollama URL are stored in plaintext `localStorage`
      (`ubiq_api_keys`, `ubiq_ollama_url`) and read directly into request
      payloads. No known active exploit path in this codebase (no injected
      third-party scripts), but flagging since it's XSS-exposed by
      definition. No code change planned unless requested.
- [x] D5 — Blocking `alert()` used for "Connection URL updated!", "Please
      open a file," "Select some code first." — jarring UX, not a toast.
- [x] D6 — `closeTab` always reactivates the *last* tab in the list rather
      than the tab adjacent to the one just closed.
- [x] D7 — `sidebarWidth`/`chatWidth` aren't persisted to localStorage the
      way open tabs are — resets on every reload.

---

## Notes / decisions log

(Add dated entries here when a design decision changes mid-build — e.g. a
feature_key gets renamed, a limit default changes, a phase gets reordered.)

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
