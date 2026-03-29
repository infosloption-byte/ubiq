import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Check, Sparkles, RefreshCw, UserCheck } from 'lucide-react';

declare const Paddle: any;

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS  = 120000;
const WEBHOOK_DELAY_MS = 4000;

const ACTIVE_STATUSES = ['active', 'past_due', 'trialing'];

export default function PricingCard() {
    const [loading, setLoading]           = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [pollStatus, setPollStatus]     = useState<string | null>(null);
    const navigate = useNavigate();
    const { user, setUser } = useAuthStore();

    const pollingRef  = useRef<ReturnType<typeof setInterval> | null>(null);
    const timeoutRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
    const didSucceed  = useRef(false);

    useEffect(() => { return () => stopPolling(); }, []);

    const stopPolling = () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        pollingRef.current = null;
        timeoutRef.current = null;
    };

    const loadUserData = useCallback(async (): Promise<boolean> => {
        try {
            const response = await authAPI.me();
            const userData = response.data?.user || response.data;
            if (userData) {
                setUser(userData);
                return ACTIVE_STATUSES.includes(userData.subscription_status) && userData.subscription_tier === 'pro';
            }
        } catch (err) {
            console.error("❌ [PricingCard] Sync error:", err);
        }
        return false;
    }, [setUser]);

    useEffect(() => {
        loadUserData().finally(() => setInitializing(false));
    }, [loadUserData]);

    const startPollingForActivation = useCallback(async () => {
        if (didSucceed.current) return;
        setLoading(true);
        setPollStatus("Waiting for payment confirmation...");

        await new Promise(r => setTimeout(r, WEBHOOK_DELAY_MS));

        pollingRef.current = setInterval(async () => {
            setPollStatus("Verifying subscription...");

            const isActive = await loadUserData();

            if (isActive && !didSucceed.current) {
                didSucceed.current = true;
                stopPolling();
                setLoading(false);
                setPollStatus(null);
                alert("Pro Plan Activated Successfully! Your trial starts now.");
                navigate("/dashboard");
            }
        }, POLL_INTERVAL_MS);

        timeoutRef.current = setTimeout(() => {
            if (!didSucceed.current) {
                stopPolling();
                setLoading(false);
                setPollStatus(null);
                alert("Payment received! Status is still syncing — please refresh in a moment.");
            }
        }, POLL_TIMEOUT_MS);
    }, [loadUserData]);

    // Keep ref current so Paddle event callback always calls latest version
    const startPollingRef = useRef(startPollingForActivation);
    useEffect(() => { startPollingRef.current = startPollingForActivation; }, [startPollingForActivation]);

    useEffect(() => {
        if (typeof Paddle === 'undefined') return;
        Paddle.Environment.set('sandbox');
        Paddle.Initialize({
            token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
            eventCallback: (event: any) => {
                console.log("🔔 [Paddle Event]:", event?.name);

                // FIX #3: Only start polling when checkout actually completes.
                // Previously startPollingForActivation() was also called directly
                // in handleSubscribe() — before the user had even seen the overlay —
                // so we were burning 4s + poll intervals on every button click.
                if (["checkout.completed", "checkout.finished", "transaction.completed"].includes(event?.name)) {
                    startPollingRef.current();
                }
            }
        });
    }, []);

    const handleSubscribe = () => {
        if (!user?.email || loading) return;
        didSucceed.current = false;

        Paddle.Checkout.open({
            settings:   { displayMode: "overlay", theme: "dark", locale: "en" },
            items:      [{ priceId: import.meta.env.VITE_PADDLE_PRICE_ID, quantity: 1 }],
            customer:   { email: user.email },
            customData: { user_id: user.id.toString() },
        });

        // FIX #3: Polling is now ONLY triggered from the eventCallback above.
        // Removed the direct startPollingForActivation() call that was here.
    };

    if (initializing) {
        return (
            <div className="p-8 bg-[#0F111A] border border-white/10 rounded-3xl flex flex-col justify-center items-center h-80 gap-4">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-slate-400 text-xs font-mono">LOADING ACCOUNT...</p>
            </div>
        );
    }

    return (
        <div className="p-8 bg-[#0F111A] border border-white/10 rounded-3xl backdrop-blur-md relative overflow-hidden group hover:border-indigo-500/50 transition-all duration-500 shadow-2xl">
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-indigo-400" />
                        <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Premium</span>
                    </div>
                    {user?.email && (
                        <div className="text-[10px] text-slate-400 bg-white/5 px-2 py-1 rounded-md border border-white/5 flex items-center gap-1">
                            <UserCheck className="w-3 h-3 text-emerald-400" />
                            {user.email.split('@')[0]}
                        </div>
                    )}
                </div>

                <h2 className="text-3xl font-black text-white mb-2">Pro Plan</h2>
                <div className="flex items-baseline gap-1 mb-6">
                    <span className="text-4xl font-bold text-white">$9.00</span>
                    <span className="text-slate-400 text-sm">/ month</span>
                </div>

                <div className="space-y-4 mb-8">
                    {["1-Day Free Trial", "Unlimited AI Suggestions", "20GB Cloud Storage", "Full EC2 Instance Access"].map((f, i) => (
                        <div key={i} className="flex items-center gap-3 text-sm text-slate-300">
                            <Check className="w-4 h-4 text-indigo-400" /> {f}
                        </div>
                    ))}
                </div>

                <button
                    onClick={handleSubscribe}
                    disabled={loading || !user?.email}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20"
                >
                    {loading ? (
                        <><RefreshCw className="animate-spin w-5 h-5" /><span>{pollStatus ?? "Syncing..."}</span></>
                    ) : 'Start Free Trial'}
                </button>
            </div>
        </div>
    );
}