import React from 'react';
import { useAuthStore } from '../stores/authStore';
import { HardDrive, AlertTriangle } from 'lucide-react';

export default function StorageUsage() {
    const { user } = useAuthStore();

    // 1. Determine Limit (Base 5GB, Pro 20GB)
    const isPro = user?.subscription_status === 'active';
    const limitGB = isPro ? 20 : 5;
    
    // 2. Calculate Usage (Backend should return storage_used in bytes)
    // Fallback to 0 if not provided yet by backend
    const usedBytes = user?.storage_used || 0; 
    const usedGB = usedBytes / (1024 * 1024 * 1024);
    
    // 3. Calculate Percentage for Progress Bar
    const percentage = Math.min(100, (usedGB / limitGB) * 100);
    const isNearingLimit = percentage > 80;
    const isFull = percentage >= 100;

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
                            {isPro ? 'Pro Allocation' : 'Standard Trial'}
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <span className="text-sm font-mono font-bold text-white">{usedGB.toFixed(2)} GB</span>
                    <span className="text-xs text-slate-500"> / {limitGB} GB</span>
                </div>
            </div>

            {/* Progress Bar Container */}
            <div className="relative w-full h-3 bg-white/5 rounded-full border border-white/5 overflow-hidden">
                <div 
                    className={`h-full transition-all duration-700 ease-out rounded-full ${
                        isFull ? 'bg-red-500' : isNearingLimit ? 'bg-orange-500' : 'bg-indigo-500'
                    }`}
                    style={{ width: `${Math.max(percentage, 2)}%` }} // Min 2% so bar is visible
                />
            </div>

            {/* Warnings and CTAs */}
            {isNearingLimit && (
                <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs leading-relaxed animate-pulse-slow ${
                    isFull 
                    ? 'bg-red-500/10 border-red-500/20 text-red-400' 
                    : 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                }`}>
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <div>
                        <span className="font-bold">{isFull ? 'Storage Full!' : 'Running Low!'}</span>
                        <p className="opacity-80">
                            {isPro 
                                ? "You've reached your Pro limit. Please delete unused files to continue."
                                : "Upgrade to Pro to unlock 20GB and keep building."
                            }
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}