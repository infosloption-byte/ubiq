import { useState, useEffect } from 'react';
import { userAPI } from '../services/api';
import { Cpu, Boxes, FolderKanban, Sparkles } from 'lucide-react';

interface RateUsage {
    hour_limit: number;
    hour_remaining: number | null; // null = unlimited (see PlanGuard::remainingRate)
    day_limit: number;
    day_remaining: number | null;
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
 * C1 — Consolidated usage widget: AI requests (hourly + daily), sandbox
 * concurrency, and project count, all read live from PlanGuard via the
 * new GET /user/plan-usage endpoint. Deliberately separate from
 * StorageUsage (which already has its own DashboardPage consumer via
 * /user/storage) rather than merging everything into one mega-component —
 * this one is for the fuller Settings-page picture.
 */
export default function PlanUsageWidget() {
    const [data, setData] = useState<PlanUsageData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        userAPI.getPlanUsage()
            .then(res => setData(res.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

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
                <span className="text-[10px] font-medium tracking-widest uppercase text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">
                    {data.plan.name}
                </span>
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
                    <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                        <span>Today</span>
                        <span className="font-mono">
                            {data.ai.day_remaining === null
                                ? 'Unlimited'
                                : `${data.ai.day_limit - data.ai.day_remaining} / ${data.ai.day_limit}`}
                        </span>
                    </div>
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

            {!data.ai && !data.sandbox && (
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <Boxes className="w-3.5 h-3.5" />
                    Usage details are temporarily unavailable.
                </div>
            )}
        </div>
    );
}
