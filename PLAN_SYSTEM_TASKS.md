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
