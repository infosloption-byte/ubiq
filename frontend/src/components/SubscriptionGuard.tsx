import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import PricingCard from '../components/PricingCard';
import Layout from '../components/Layout';   // ADD THIS
import api from '../services/api';
import { Sparkles, ShieldAlert, RefreshCw } from 'lucide-react';

export const SubscriptionGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, setUser } = useAuthStore();
    const navigate = useNavigate();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshError, setRefreshError] = useState<string | null>(null);

    // ── Access logic ───────────────────────────────────────────────────────────
    // tier === 'pro' is the single source of truth — set by webhook listener.
    // We check status as a secondary guard to block expired/canceled accounts.
    const BLOCKED_STATUSES = ['canceled', 'paused', 'free'];

    // ✅ This covers ALL cases cleanly:
    // trialing + pro  → ✅ access (on trial, not yet charged)
    // active   + pro  → ✅ access (paying subscriber)
    // past_due + pro  → ✅ access (payment failed but grace period)
    // canceled + pro  → ❌ blocked (was pro, now canceled)
    // free     + free → ❌ blocked (never subscribed)
    
    const canAccess = user?.is_admin || (user?.subscription_tier === 'pro' && !BLOCKED_STATUSES.includes(user?.subscription_status ?? 'free'));


    const handleRefreshStatus = async () => {
        setIsRefreshing(true);
        setRefreshError(null);
        try {
            const response = await api.get('/auth/me');
            setUser(response.data.user);
        } catch (error) {
            setRefreshError("Could not verify your subscription. Check your connection and try again.");
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleLogout = () => {
        localStorage.clear();
        navigate('/login');
    };

    if (!canAccess) {
        // WRAP IN LAYOUT so sidebar is always visible
        return (
            <Layout>
                <div className="h-full overflow-y-auto flex flex-col items-center justify-center p-6">
                    <div className="max-w-md w-full py-10 flex flex-col items-center">

                        <div className="text-center mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold uppercase tracking-widest mb-4">
                                <ShieldAlert className="w-3 h-3" /> Subscription Required
                            </div>
                            <h1 className="text-3xl font-black text-white mb-3">
                                Unlock the Full <span className="text-indigo-500">Experience</span>
                            </h1>
                            <p className="text-slate-400 text-sm">
                                Start your 1-day free trial, then $9/month. Cancel anytime.
                            </p>
                        </div>

                        <div className="w-full transform transition-all hover:scale-[1.01]">
                            <PricingCard />
                        </div>

                        <div className="mt-8 flex flex-col items-center gap-4 w-full">
                            <button
                                onClick={handleRefreshStatus}
                                disabled={isRefreshing}
                                className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50"
                            >
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                {isRefreshing ? 'Verifying status...' : 'Already subscribed? Refresh'}
                            </button>

                            {refreshError && (
                                <p className="text-xs text-red-400 text-center max-w-[240px] leading-relaxed">{refreshError}</p>
                            )}

                            <div className="flex flex-col gap-2 w-full">
                                <button
                                    onClick={() => navigate('/settings', { state: { activeTab: 'billing' } })}
                                    className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 text-sm"
                                >
                                    <Sparkles className="w-4 h-4" /> Manage Billing
                                </button>
                                <button
                                    onClick={() => navigate('/dashboard')}
                                    className="text-slate-500 hover:text-slate-300 text-xs font-medium transition text-center"
                                >
                                    Back to Dashboard
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="text-slate-600 hover:text-red-400 text-xs font-medium transition text-center"
                                >
                                    Sign out
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </Layout>
        );
    }

    return <>{children}</>;
};