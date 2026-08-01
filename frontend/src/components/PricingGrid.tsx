import { useState, useEffect, useCallback, useRef } from 'react';
import api, { authAPI, subscriptionApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Check, Sparkles, RefreshCw, UserCheck, Clock } from 'lucide-react';

interface PlanFeature {
    feature_key: string;
    feature_value: string;
    value_type: 'int' | 'bool' | 'string';
}

interface Plan {
    id: number;
    key: string;
    name: string;
    price_cents: number;
    currency: string;
    billing_interval: string;
    paypal_plan_id: string | null;
    sort_order: number;
    features: PlanFeature[];
}

const ACTIVE_STATUSES = ['active', 'past_due'];

const PAYPAL_SDK_URL = `https://www.paypal.com/sdk/js?client-id=${
    import.meta.env.VITE_PAYPAL_CLIENT_ID
}&vault=true&intent=subscription`;

function loadPayPalSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
        if ((window as any).paypal) { resolve(); return; }
        const existing = document.querySelector(`script[src="${PAYPAL_SDK_URL}"]`);
        if (existing) { existing.addEventListener('load', () => resolve()); return; }
        const script = document.createElement('script');
        script.src = PAYPAL_SDK_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load PayPal SDK'));
        document.head.appendChild(script);
    });
}

/**
 * C3 — Curated marketing labels for a subset of plan_features. Raw DB
 * values stay the single source of truth; this is purely a display
 * concern (which keys to show, and how to phrase them), same separation
 * as any product's pricing page copy vs. its billing system's raw limits.
 * Booleans return null to hide the bullet entirely when the value is
 * false, rather than showing "Sharing: No" as a bullet.
 */
function castValue(f: PlanFeature): any {
    if (f.value_type === 'int') return parseInt(f.feature_value, 10);
    if (f.value_type === 'bool') return f.feature_value === 'true' || f.feature_value === '1';
    return f.feature_value;
}

const FEATURE_LABEL: Record<string, (value: any) => string | null> = {
    'sandbox.max_concurrent': (v) => `${v} concurrent sandbox${v === 1 ? '' : 'es'}`,
    'ai.requests_per_hour':   (v) => v === -1 ? 'Unlimited AI requests' : `${v.toLocaleString()} AI requests / hour`,
    'storage.max_mb':         (v) => v === -1 ? 'Unlimited storage' : (v >= 1024 ? `${(v / 1024).toFixed(0)} GB storage` : `${v} MB storage`),
    'projects.max_count':     (v) => v === -1 ? 'Unlimited projects' : `${v} projects`,
    'sharing.enabled':        (v) => v ? 'Public project sharing' : null,
};
const FEATURE_ORDER = ['sandbox.max_concurrent', 'ai.requests_per_hour', 'storage.max_mb', 'projects.max_count', 'sharing.enabled'];

function planBullets(plan: Plan): string[] {
    const byKey = new Map(plan.features.map(f => [f.feature_key, castValue(f)]));
    return FEATURE_ORDER
        .map(key => {
            const labelFn = FEATURE_LABEL[key];
            const value = byKey.get(key);
            return (labelFn && value !== undefined) ? labelFn(value) : null;
        })
        .filter((s): s is string => s !== null);
}

function formatPrice(cents: number): string {
    return cents === 0 ? 'Free' : `$${(cents / 100).toFixed(0)}`;
}

export default function PricingGrid() {
    const [plans, setPlans] = useState<Plan[]>([]);
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [sdkReady, setSdkReady] = useState(false);
    const { user, setUser } = useAuthStore();

    const buttonsContainerRef = useRef<HTMLDivElement>(null);
    const buttonsRenderedRef  = useRef(false);

    useEffect(() => {
        api.get('/plans')
            .then(res => setPlans(res.data.plans))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const syncUser = useCallback(async () => {
        try {
            const response = await authAPI.me();
            const userData = response.data?.user || response.data;
            if (userData) setUser(userData);
        } catch (err) {
            console.error('❌ [PricingGrid] Sync error:', err);
        }
    }, [setUser]);

    useEffect(() => {
        loadPayPalSdk().then(() => setSdkReady(true)).catch((err) => console.error('❌ [PricingGrid] PayPal SDK failed to load:', err));
    }, []);

    // Only one plan can have a live PayPal button today — whichever plan
    // has a paypal_plan_id set (currently just Pro; Starter/Creator show a
    // "Coming Soon" state instead of a fake checkout flow, per Phase C4
    // not being built yet).
    const paypalPlan = plans.find(p => p.paypal_plan_id);
    const isPro = user && ACTIVE_STATUSES.includes(user.subscription_status) && user.subscription_tier === 'pro';

    useEffect(() => {
        if (!sdkReady || loading || buttonsRenderedRef.current || !paypalPlan || isPro) return;
        if (!buttonsContainerRef.current) return;
        const paypal = (window as any).paypal;
        if (!paypal) return;

        buttonsRenderedRef.current = true;
        paypal.Buttons({
            style: { shape: 'rect', color: 'blue', layout: 'vertical', label: 'subscribe' },
            createSubscription: (_data: any, actions: any) => actions.subscription.create({ plan_id: paypalPlan.paypal_plan_id }),
            onApprove: async (data: any) => {
                setConfirming(true);
                try {
                    const response = await subscriptionApi.confirmSubscription(data.subscriptionID);
                    if (response.data?.user) setUser(response.data.user);
                    alert(`${paypalPlan.name} plan activated successfully!`);
                } catch (err) {
                    console.error('❌ [PricingGrid] Confirmation failed:', err);
                    alert("Payment approved, but we couldn't confirm it on our end yet. Please refresh in a moment — if it still shows your old plan, contact support.");
                } finally {
                    setConfirming(false);
                }
            },
            onError: (err: any) => {
                console.error('❌ [PricingGrid] PayPal Buttons error:', err);
                alert('Something went wrong starting checkout. Please try again.');
            },
        }).render(buttonsContainerRef.current);
    }, [sdkReady, loading, paypalPlan, isPro, setUser]);

    useEffect(() => { syncUser(); }, [syncUser]);

    if (loading) {
        return (
            <div className="p-8 bg-[#0F111A] border border-white/10 rounded-3xl flex flex-col justify-center items-center h-60 gap-4">
                <RefreshCw className="w-8 h-8 animate-spin text-indigo-500" />
                <p className="text-slate-400 text-xs font-mono">LOADING PLANS...</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map((plan) => {
                const isCurrent = user?.subscription_tier === plan.key || (plan.key === 'free' && !user?.subscription_tier);
                const hasCheckout = !!plan.paypal_plan_id;
                const bullets = planBullets(plan);

                return (
                    <div
                        key={plan.key}
                        className={`p-6 bg-[#0F111A] border rounded-3xl backdrop-blur-md relative overflow-hidden flex flex-col transition-all duration-500 shadow-2xl ${
                            isCurrent ? 'border-indigo-500/60' : 'border-white/10 hover:border-indigo-500/30'
                        }`}
                    >
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{plan.name}</span>
                            {isCurrent && (
                                <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/10">
                                    <UserCheck className="w-3 h-3" /> Current
                                </span>
                            )}
                        </div>

                        <div className="flex items-baseline gap-1 mb-5">
                            <span className="text-3xl font-bold text-white">{formatPrice(plan.price_cents)}</span>
                            {plan.price_cents > 0 && <span className="text-slate-400 text-xs">/ {plan.billing_interval}</span>}
                        </div>

                        <div className="space-y-2.5 mb-6 flex-1">
                            {bullets.map((b, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                    <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" /> {b}
                                </div>
                            ))}
                        </div>

                        {/* CTA area */}
                        {isCurrent ? (
                            <div className="text-center text-[11px] text-slate-500 py-2">Your current plan</div>
                        ) : plan.key === 'free' ? (
                            <div className="text-center text-[11px] text-slate-500 py-2">No signup needed</div>
                        ) : hasCheckout ? (
                            <>
                                {confirming && (
                                    <div className="flex items-center justify-center gap-2 mb-2 text-slate-300 text-xs">
                                        <RefreshCw className="animate-spin w-3.5 h-3.5" /> Confirming...
                                    </div>
                                )}
                                <div ref={buttonsContainerRef} className={confirming ? 'opacity-40 pointer-events-none' : ''} />
                            </>
                        ) : (
                            <button disabled className="w-full py-2.5 bg-white/5 text-slate-500 border border-white/5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 cursor-not-allowed">
                                <Clock className="w-3.5 h-3.5" /> Coming Soon
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
