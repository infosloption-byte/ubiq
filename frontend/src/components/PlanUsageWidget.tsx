import { useState, useEffect, useCallback } from 'react';
import { userAPI } from '../services/api';
import { Cpu, Boxes, FolderKanban, Sparkles, HardDrive, RefreshCw } from 'lucide-react';

interface RateUsage {
    hour_limit: number;
    hour_remaining: number | null; // null = unlimited (see PlanGuard::remainingRate)
    hour_resets_at: string;        // ISO8601 UTC instant — see PlanGuard::remainingRate
    day_limit: number;
    day_remaining: number | null;
    day_resets_at: string;
}

interface ConcurrentUsage {
    limit: number;
    remaining: number | null; // null = unlimited
}

interface PlanUsageData {
    plan: { key: string; name: string };
    ai: RateUsage | null;      // null = plan resolution failed, not "unlimited"
    sandbox: ConcurrentUsage | null;
    storage: { used_mb: number; limit_mb: number | null; unlimited: boolean; percent: number };
    projects: { count: number; limit: number | null; unlimited: boolean };
    // E2b fix (PLAN_SYSTEM_TASKS.md Phase E): static plan *capability*
    // specs — not consumable usage, so no used/limit pairing, just "what
    // your plan includes." Optional because older cached responses (or a
    // backend that hasn't deployed this yet) won't have it — handled with
    // a fallback render below rather than assuming it's always present.
    limits?: {
        sandbox_cpu: string | null;
        sandbox_memory_mb: number | null;
        sandbox_idle_timeout_minutes: number | null;
        max_model_tier: string | null;
        sharing_enabled: boolean | null;
    };
}

function UsageBar({ used, total, unlimited }: { used: number; total: number; unlimited: boolean }) {
    if (unlimited) {
        return <div className="text-[10px] text-slate-500 mt-1">Unlimited on your plan</div>;
    }
    const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    const isNearing = pct > 80;
    const isFull = pct >= 100;
    return (
        <div className="relative w-full h-1.5 bg-white/5 rounded-full border border-white/5 overflow-hidden mt-1.5">
            <div
                className={`h-full transition-all duration-500 ease-out rounded-full ${
                    isFull ? 'bg-red-500' : isNearing ? 'bg-orange-500' : 'bg-indigo-500'
                }`}
                style={{ width: `${Math.max(pct, 2)}%` }}
            />
        </div>
    );
}

/**
 * E2b sub-part (PLAN_SYSTEM_TASKS.md Phase E) — "resets in Xh Ym", matching
 * the Claude-style rate-limit reset display that was asked for. `resetsAt`
 * is an absolute ISO8601 UTC instant from PlanGuard::remainingRate — parsing
 * it with `new Date()` and diffing against the browser's own clock is
 * correct regardless of which timezone either side is in, since both ends
 * of the subtraction are the same absolute instant. Re-renders once a
 * minute (not every second — a rate-limit reset doesn't need
 * seconds-precision, and a 1s interval would just burn cycles for no
 * visible benefit at this granularity).
 */
function ResetCountdown({ resetsAt }: { resetsAt: string }) {
    const [label, setLabel] = useState('');

    useEffect(() => {
        const update = () => {
            const msLeft = new Date(resetsAt).getTime() - Date.now();
            if (msLeft <= 0) { setLabel('resets shortly'); return; }
            const totalMinutes = Math.ceil(msLeft / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            setLabel(hours > 0 ? `resets in ${hours}h ${minutes}m` : `resets in ${minutes}m`);
        };
        update();
        const interval = setInterval(update, 60000);
        return () => clearInterval(interval);
    }, [resetsAt]);

    return <span className="text-slate-600">{label}</span>;
}

/**
 * C1 — Consolidated usage widget: AI requests (hourly + daily), sandbox
 * concurrency, storage, and project count, all read live from PlanGuard/
 * the same /user/plan-usage response. E2b sub-part 2 (PLAN_SYSTEM_TASKS.md
 * Phase E): storage merged in as its own row here rather than staying a
 * separate <StorageUsage/> card next to this one — per feedback, storage
 * IS plan usage, it shouldn't visually read as something separate. The
 * data for it (`data.storage`) was already being fetched by this same
 * component's own request the whole time, just never rendered — no new
 * API call needed. Note: the comment this replaced claimed StorageUsage
 * "already has its own DashboardPage consumer" — checked via a repo-wide
 * grep while making this change, that's not actually true; StorageUsage.tsx
 * has no consumers anywhere now that SettingsPage no longer renders it
 * directly (see SettingsPage.tsx's own note) — flagged as dead code, left
 * in place rather than deleted since removing files wasn't asked for.
 */
export default function PlanUsageWidget() {
    const [data, setData] = useState<PlanUsageData | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Sub-part 2: pulled out of the mount effect so the refresh button
    // below can call the exact same fetch — no separate "refresh" endpoint
    // needed, this is the same GET /user/plan-usage PlanGuard already
    // computes fresh on every call.
    const fetchUsage = useCallback((isManualRefresh: boolean) => {
        if (isManualRefresh) setRefreshing(true);
        return userAPI.getPlanUsage()
            .then(res => setData(res.data))
            .catch(() => {})
            .finally(() => {
                setLoading(false);
                if (isManualRefresh) setRefreshing(false);
            });
    }, []);

    useEffect(() => { fetchUsage(false); }, [fetchUsage]);

    if (loading) {
        return (
            <div className="space-y-3 animate-pulse">
                <div className="h-5 w-32 bg-white/5 rounded" />
                <div className="h-10 w-full bg-white/5 rounded-lg" />
                <div className="h-10 w-full bg-white/5 rounded-lg" />
            </div>
        );
    }

    if (!data) return null;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white uppercase tracking-tight">Plan Usage</h4>
                <div className="flex items-center gap-2">
                    {/* Sub-part 2: manual refresh — recalls the same
                        /user/plan-usage endpoint on demand so someone can
                        see an up-to-the-second number right after using an
                        AI request or starting a sandbox, without waiting
                        for a full page reload. */}
                    <button
                        onClick={() => fetchUsage(true)}
                        disabled={refreshing}
                        title="Refresh usage"
                        className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <span className="text-[10px] font-medium tracking-widest uppercase text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">
                        {data.plan.name}
                    </span>
                </div>
            </div>

            {/* AI requests */}
            {data.ai && (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-slate-300">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                            AI requests (this hour)
                        </div>
                        <span className="text-xs font-mono text-white">
                            {data.ai.hour_remaining === null
                                ? 'Unlimited'
                                : `${data.ai.hour_limit - data.ai.hour_remaining} / ${data.ai.hour_limit}`}
                        </span>
                    </div>
                    <UsageBar
                        used={data.ai.hour_remaining === null ? 0 : data.ai.hour_limit - data.ai.hour_remaining}
                        total={data.ai.hour_limit}
                        unlimited={data.ai.hour_remaining === null}
                    />
                    {/* E2b sub-part: reset countdowns, requested to match
                        Claude's rate-limit UI. Omitted when unlimited —
                        there's no reset to count down to on those plans. */}
                    {data.ai.hour_remaining !== null && (
                        <div className="text-[10px] mt-1"><ResetCountdown resetsAt={data.ai.hour_resets_at} /></div>
                    )}
                    <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                        <span>Today</span>
                        <span className="font-mono">
                            {data.ai.day_remaining === null
                                ? 'Unlimited'
                                : `${data.ai.day_limit - data.ai.day_remaining} / ${data.ai.day_limit}`}
                        </span>
                    </div>
                    {/* Sub-part 2: this row was text-only before — added the
                        same UsageBar the hourly row above already has, for
                        visual consistency between the two. */}
                    <UsageBar
                        used={data.ai.day_remaining === null ? 0 : data.ai.day_limit - data.ai.day_remaining}
                        total={data.ai.day_limit}
                        unlimited={data.ai.day_remaining === null}
                    />
                    {data.ai.day_remaining !== null && (
                        <div className="text-[10px] text-right mt-1"><ResetCountdown resetsAt={data.ai.day_resets_at} /></div>
                    )}
                </div>
            )}

            {/* Sandbox concurrency */}
            {data.sandbox && (
                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-slate-300">
                            <Cpu className="w-3.5 h-3.5 text-teal-400" />
                            Active sandboxes
                        </div>
                        <span className="text-xs font-mono text-white">
                            {data.sandbox.remaining === null
                                ? 'Unlimited'
                                : `${data.sandbox.limit - data.sandbox.remaining} / ${data.sandbox.limit}`}
                        </span>
                    </div>
                    <UsageBar
                        used={data.sandbox.remaining === null ? 0 : data.sandbox.limit - data.sandbox.remaining}
                        total={data.sandbox.limit}
                        unlimited={data.sandbox.remaining === null}
                    />
                </div>
            )}

            {/* Storage — sub-part 2: was a separate <StorageUsage/> card
                next to this widget in SettingsPage; per feedback, storage
                IS plan usage and reads better as one more row here. The
                data (data.storage) was already part of this same
                /user/plan-usage response the whole time. */}
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                        <HardDrive className="w-3.5 h-3.5 text-purple-400" />
                        Cloud storage
                    </div>
                    <span className="text-xs font-mono text-white">
                        {data.storage.unlimited
                            ? 'Unlimited'
                            : `${data.storage.used_mb.toFixed(1)} MB / ${data.storage.limit_mb! >= 1024 ? `${(data.storage.limit_mb! / 1024).toFixed(0)} GB` : `${data.storage.limit_mb} MB`}`}
                    </span>
                </div>
                <UsageBar
                    used={data.storage.used_mb}
                    total={data.storage.limit_mb ?? 0}
                    unlimited={data.storage.unlimited}
                />
            </div>

            {/* Projects */}
            <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-slate-300">
                        <FolderKanban className="w-3.5 h-3.5 text-amber-400" />
                        Projects
                    </div>
                    <span className="text-xs font-mono text-white">
                        {data.projects.unlimited ? 'Unlimited' : `${data.projects.count} / ${data.projects.limit}`}
                    </span>
                </div>
                <UsageBar
                    used={data.projects.count}
                    total={data.projects.limit ?? 0}
                    unlimited={data.projects.unlimited}
                />
            </div>

            {/* Sub-part 2: explicit divider + heading spacing so this reads
                as its own section AFTER Plan Usage, not just one more row
                in the same list — per feedback. */}
            {data.limits && (
                <>
                    <div className="pt-2 border-t border-white/10" />
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Your plan includes</div>
                        <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
                            {/* Sub-part 2: hour/day AI request limits added to this
                                spec list too — data.ai already has these (hour_limit/
                                day_limit), no new backend field needed. Complements,
                                doesn't replace, the live usage numbers shown above:
                                this list is a static "what your plan includes"
                                reference, that one is "how much you've used so far." */}
                            {data.ai && (
                                <>
                                    <span className="text-slate-500">AI requests / hour</span>
                                    <span className="text-slate-300 font-mono text-right">
                                        {data.ai.hour_remaining === null ? 'Unlimited' : data.ai.hour_limit}
                                    </span>

                                    <span className="text-slate-500">AI requests / day</span>
                                    <span className="text-slate-300 font-mono text-right">
                                        {data.ai.day_remaining === null ? 'Unlimited' : data.ai.day_limit}
                                    </span>
                                </>
                            )}

                            <span className="text-slate-500">Sandbox CPU</span>
                            <span className="text-slate-300 font-mono text-right">{data.limits.sandbox_cpu ?? '—'} vCPU</span>

                            <span className="text-slate-500">Sandbox RAM</span>
                            <span className="text-slate-300 font-mono text-right">{data.limits.sandbox_memory_mb ?? '—'} MB</span>

                            <span className="text-slate-500">Sandbox idle timeout</span>
                            <span className="text-slate-300 font-mono text-right">{data.limits.sandbox_idle_timeout_minutes ?? '—'} min</span>

                            <span className="text-slate-500">Max self-hosted model</span>
                            <span className="text-slate-300 font-mono text-right capitalize">{data.limits.max_model_tier ?? '—'}</span>

                            <span className="text-slate-500">Project sharing</span>
                            <span className={`font-mono text-right ${data.limits.sharing_enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                                {data.limits.sharing_enabled ? 'Enabled' : 'Not on this plan'}
                            </span>
                        </div>
                        {/* BYOK models (your own Gemini/OpenAI/OpenRouter/Mistral key) are
                            never limited by "max self-hosted model" above — that cap only
                            applies to self-hosted Ollama models. See CompletionController's
                            hasByoKeyFor()/tier_compare logic. */}
                        <div className="text-[10px] text-slate-600 mt-2">Bring-your-own-key models aren't limited by the tier above.</div>
                    </div>
                </>
            )}

            {!data.ai && !data.sandbox && (
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <Boxes className="w-3.5 h-3.5" />
                    Usage details are temporarily unavailable.
                </div>
            )}
        </div>
    );
}
