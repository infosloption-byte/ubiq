import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import PricingCard from '../components/PricingCard';
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

  const canAccess = user?.is_admin || (user?.subscription_tier === 'pro' && !BLOCKED_STATUSES.includes(user?.subscription_status ?? 'free'));

  // ✅ This covers ALL cases cleanly:
  // trialing + pro  → ✅ access (on trial, not yet charged)
  // active   + pro  → ✅ access (paying subscriber)
  // past_due + pro  → ✅ access (payment failed but grace period)
  // canceled + pro  → ❌ blocked (was pro, now canceled)
  // free     + free → ❌ blocked (never subscribed)

  const handleRefreshStatus = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const response = await api.get('/auth/me');
      setUser(response.data.user);
    } catch (error) {
      console.error("Failed to refresh status", error);
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
    return (
      <div className="fixed inset-0 z-[100] bg-[#0B0F1A]/95 backdrop-blur-xl flex items-center justify-center p-6 overflow-y-auto">
        <div className="max-w-4xl w-full flex flex-col items-center py-12">

          <div className="text-center mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-bold uppercase tracking-widest mb-4">
              <ShieldAlert className="w-3 h-3" /> Subscription Required
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white mb-3">
              Unlock the Full <span className="text-indigo-500">Experience</span>
            </h1>
            <p className="text-slate-400 max-w-md mx-auto">
              Start your 1-day free trial, then $9/month. Cancel anytime.
            </p>
          </div>

          <div className="w-full max-w-md transform transition-all hover:scale-[1.01]">
            <PricingCard />
          </div>

          <div className="mt-10 flex flex-col items-center gap-5 w-full max-w-xs">
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

            <div className="flex flex-col gap-3 w-full">
              <button
                onClick={() => navigate('/settings', { state: { activeTab: 'billing' } })}
                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl font-semibold transition-all flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Manage Billing
              </button>
              <button
                onClick={() => navigate('/dashboard')}
                className="text-slate-500 hover:text-slate-300 text-xs font-medium transition"
              >
                Back to Dashboard
              </button>
              <button
                onClick={handleLogout}
                className="text-slate-600 hover:text-red-400 text-xs font-medium transition"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};