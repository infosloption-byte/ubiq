import { useState, useEffect } from 'react';
import { userAPI } from '../services/api';
import { HardDrive, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface StorageData {
    used_bytes: number;
    used_mb: number;
    limit_bytes: number;
    limit_mb: number;
    percent: number;
}

export default function StorageUsage() {
    const { user } = useAuthStore();
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

    const isPro         = user?.subscription_tier === 'pro';
    const percentage    = storage.percent;
    const isNearingLimit = percentage > 80;
    const isFull        = percentage >= 100;

    // Human-readable used / limit labels
    const usedLabel  = storage.used_mb < 1024
        ? `${storage.used_mb.toFixed(1)} MB`
        : `${(storage.used_mb / 1024).toFixed(2)} GB`;

    const limitLabel = storage.limit_mb >= 1024
        ? `${(storage.limit_mb / 1024).toFixed(0)} GB`
        : `${storage.limit_mb} MB`;

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${isNearingLimit ? 'bg-orange-500/10 text-orange-500' : 'bg-indigo-500/10 text-indigo-400'}`}>
                        <HardDrive className="w-4 h-4" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-white uppercase tracking-tight">Cloud Storage</h4>
                        <p className="text-[10px] text-slate-500 font-medium tracking-widest uppercase">
                            {isPro ? 'Pro Allocation' : 'Free Plan'}
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-sm font-mono font-bold text-white">{usedLabel}</span>
                    <span className="text-xs text-slate-500"> / {limitLabel}</span>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="relative w-full h-3 bg-white/5 rounded-full border border-white/5 overflow-hidden">
                <div
                    className={`h-full transition-all duration-700 ease-out rounded-full ${
                        isFull ? 'bg-red-500' : isNearingLimit ? 'bg-orange-500' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${Math.max(percentage, 2)}%` }}
                />
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-600">
                <span>{percentage.toFixed(1)}% used</span>
                <span>
                    {storage.limit_mb >= 1024
                        ? `${((storage.limit_mb - storage.used_mb) / 1024).toFixed(2)} GB`
                        : `${(storage.limit_mb - storage.used_mb).toFixed(0)} MB`
                    } remaining
                </span>
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
                            {isPro
                                ? "You've reached your Pro limit. Delete unused projects to continue."
                                : "Upgrade to Pro to unlock 5 GB and keep building."
                            }
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}