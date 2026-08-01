import { useState, useEffect } from 'react';
import { userAPI } from '../services/api';
import { HardDrive, AlertTriangle } from 'lucide-react';

interface StorageData {
    used_bytes: number;
    used_mb: number;
    limit_bytes: number | null;
    limit_mb: number | null;
    unlimited: boolean;
    percent: number;
}

export default function StorageUsage() {
    const [storage, setStorage] = useState<StorageData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        userAPI.getStorageStats()
            .then(res => setStorage(res.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-5 w-40 bg-white/5 rounded" />
                <div className="h-3 w-full bg-white/5 rounded-full" />
            </div>
        );
    }

    if (!storage) return null;

    // Was `user?.subscription_tier === 'pro'` — hardcoded to a 2-tier
    // assumption that no longer matches the 4-tier system, and drove
    // display text rather than the actual unlimited flag from the API.
    // Decoupled from tier name entirely now: the widget only needs to know
    // whether THIS resource is capped, which the API already tells it.
    const isUnlimited   = storage.unlimited;
    const percentage    = isUnlimited ? 0 : storage.percent;
    const isNearingLimit = !isUnlimited && percentage > 80;
    const isFull        = !isUnlimited && percentage >= 100;

    // Human-readable used / limit labels
    const usedLabel  = storage.used_mb < 1024
        ? `${storage.used_mb.toFixed(1)} MB`
        : `${(storage.used_mb / 1024).toFixed(2)} GB`;

    const limitLabel = isUnlimited
        ? 'Unlimited'
        : (storage.limit_mb! >= 1024
            ? `${(storage.limit_mb! / 1024).toFixed(0)} GB`
            : `${storage.limit_mb} MB`);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${isNearingLimit ? 'bg-orange-500/10 text-orange-500' : 'bg-indigo-500/10 text-indigo-400'}`}>
                        <HardDrive className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-white uppercase tracking-tight">Cloud Storage</h4>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-sm font-mono font-bold text-white">{usedLabel}</span>
                    <span className="text-xs text-slate-500"> / {limitLabel}</span>
                </div>
            </div>

            {/* Progress Bar — skipped entirely for unlimited plans, a
                percentage bar makes no sense with no ceiling. */}
            {!isUnlimited && (
                <div className="relative w-full h-3 bg-white/5 rounded-full border border-white/5 overflow-hidden">
                    <div
                        className={`h-full transition-all duration-700 ease-out rounded-full ${
                            isFull ? 'bg-red-500' : isNearingLimit ? 'bg-orange-500' : 'bg-indigo-500'
                        }`}
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                    />
                </div>
            )}

            <div className="flex items-center justify-between text-[10px] text-slate-600">
                {isUnlimited ? (
                    <span>No storage limit on your plan</span>
                ) : (
                    <>
                        <span>{percentage.toFixed(1)}% used</span>
                        <span>
                            {storage.limit_mb! >= 1024
                                ? `${((storage.limit_mb! - storage.used_mb) / 1024).toFixed(2)} GB`
                                : `${(storage.limit_mb! - storage.used_mb).toFixed(0)} MB`
                            } remaining
                        </span>
                    </>
                )}
            </div>

            {/* Warnings */}
            {isNearingLimit && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs leading-relaxed ${
                    isFull
                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                    : 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                }`}>
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                        <span className="font-bold">{isFull ? 'Storage Full!' : 'Running Low!'}</span>
                        <p className="opacity-80 mt-0.5">
                            {isFull
                                ? "You've reached your plan's storage limit. Delete unused projects or upgrade to continue."
                                : "You're running low on storage — consider upgrading your plan."
                            }
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}