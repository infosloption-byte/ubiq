import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI, subscriptionApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Check, Sparkles, RefreshCw, UserCheck } from 'lucide-react';

const ACTIVE_STATUSES = ['active', 'past_due'];

const PAYPAL_SDK_URL = `https://www.paypal.com/sdk/js?client-id=${
    import.meta.env.VITE_PAYPAL_CLIENT_ID
}&vault=true&intent=subscription`;

/**
 * Loads the PayPal JS SDK exactly once, even if multiple components mount it.
 * The client-id has to be baked into the script URL itself (PayPal's design,
 * unlike Paddle's separate Initialize() call), so we can't use a static
 * <script> tag in index.html — it's injected here where Vite env vars exist.
 */
function loadPayPalSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
        if ((window as any).paypal) {
            resolve();
            return;
        }
        const existing = document.querySelector(`script[src="${PAYPAL_SDK_URL}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve());
            return;
        }
        const script = document.createElement('script');
        script.src = PAYPAL_SDK_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
        document.head.appendChild(script);
    });
}

export default function PricingCard() {
    const [loading, setLoading]           = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [sdkReady, setSdkReady]         = useState(false);
    const navigate = useNavigate();
    const { user, setUser } = useAuthStore();

    const buttonsContainerRef = useRef<HTMLDivElement>(null);
    const buttonsRenderedRef  = useRef(false);

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

    // Load the PayPal SDK once on mount.
    useEffect(() => {
        loadPayPalSdk()
            .then(() => setSdkReady(true))
            .catch((err) => console.error('❌ [PricingCard] PayPal SDK failed to load:', err));
    }, []);

    // Render the PayPal Buttons widget once the SDK is ready. (We still show
    // the button even for Pro users on this simple card — SettingsPage is
    // where cancellation lives; this card mainly serves the free→pro path.)
    useEffect(() => {
        if (!sdkReady || initializing || buttonsRenderedRef.current) return;
        if (!buttonsContainerRef.current) return;

        const paypal = (window as any).paypal;
        if (!paypal) return;

        buttonsRenderedRef.current = true;

        paypal.Buttons({
            style: { shape: 'rect', color: 'blue', layout: 'vertical', label: 'subscribe' },

            createSubscription: (_data: any, actions: any) => {
                return actions.subscription.create({
                    plan_id: import.meta.env.VITE_PAYPAL_PLAN_ID,
                });
            },

            onApprove: async (data: any) => {
                setLoading(true);
                try {
                    // Verify + persist server-side against PayPal's own API —
                    // don't trust the frontend's approval alone.
                    const response = await subscriptionApi.confirmSubscription(data.subscriptionID);
                    if (response.data?.user) {
                        setUser(response.data.user);
                    }
                    alert("Pro Plan Activated Successfully!");
                    navigate("/dashboard");
                } catch (err) {
                    console.error("❌ [PricingCard] Confirmation failed:", err);
                    alert("Payment approved, but we couldn't confirm it on our end yet. Please refresh in a moment — if it still shows Free, contact support.");
                } finally {
                    setLoading(false);
                }
            },

            onError: (err: any) => {
                console.error("❌ [PricingCard] PayPal Buttons error:", err);
                alert("Something went wrong starting checkout. Please try again.");
            },
        }).render(buttonsContainerRef.current);
    }, [sdkReady, initializing, navigate, setUser]);

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
                    {["Unlimited AI Suggestions", "20GB Cloud Storage", "Full EC2 Instance Access"].map((f, i) => (
                        <div key={i} className="flex items-center gap-3 text-sm text-slate-300">
                            <Check className="w-4 h-4 text-indigo-400" /> {f}
                        </div>
                    ))}
                </div>

                {loading && (
                    <div className="flex items-center justify-center gap-2 mb-4 text-slate-300 text-sm">
                        <RefreshCw className="animate-spin w-4 h-4" /> Confirming subscription...
                    </div>
                )}

                {/* PayPal renders its Subscribe button into this container */}
                <div ref={buttonsContainerRef} className={loading ? 'opacity-40 pointer-events-none' : ''} />
            </div>
        </div>
    );
}