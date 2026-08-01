import { create } from 'zustand';

/**
 * C2 — Every PlanGuard denial (see backend PlanLimitExceededException)
 * returns a consistent shape with a `reason` field. That means this can be
 * detected and handled ONE place — the axios interceptor in api.ts — rather
 * than wrapping every single AI/sandbox/project call site individually.
 *
 * showUpgrade distinguishes real plan limits (worth an upgrade CTA) from
 * system/infra issues (global_capacity_reached is a box-wide ceiling —
 * upgrading a user's OWN plan wouldn't help them get a sandbox slot faster,
 * so no upgrade prompt there; plan_lookup_failed etc. are backend errors,
 * not limits, so also no upgrade prompt).
 */
const REASON_COPY: Record<string, { title: string; message: string; showUpgrade: boolean }> = {
    concurrent_limit_exceeded: {
        title: 'Sandbox limit reached',
        message: "You've reached the maximum number of sandboxes running at once on your plan. Stop a running sandbox, or upgrade for more concurrent sandboxes.",
        showUpgrade: true,
    },
    global_capacity_reached: {
        title: 'Server at capacity',
        message: "Our sandbox servers are at capacity right now — this isn't about your plan. Please try again in a few minutes.",
        showUpgrade: false,
    },
    hourly_limit_exceeded: {
        title: 'Hourly AI limit reached',
        message: "You've used all your AI requests for this hour. It resets at the top of the hour — or upgrade for a higher limit.",
        showUpgrade: true,
    },
    daily_limit_exceeded: {
        title: 'Daily AI limit reached',
        message: "You've used all your AI requests for today. It resets at midnight — or upgrade for a higher limit.",
        showUpgrade: true,
    },
    count_limit_exceeded: {
        title: 'Project limit reached',
        message: "You've reached your plan's project limit. Delete an unused project, or upgrade for more.",
        showUpgrade: true,
    },
    storage_limit_exceeded: {
        title: 'Storage limit reached',
        message: "You've used all your available storage. Delete some files, or upgrade for more space.",
        showUpgrade: true,
    },
    feature_not_enabled_for_plan: {
        title: 'Feature not available on your plan',
        message: "This feature isn't included in your current plan. Upgrade to unlock it.",
        showUpgrade: true,
    },
    model_tier_not_permitted: {
        title: 'Model not available on your plan',
        message: 'This AI model requires a higher plan tier — even with your own API key. Upgrade to unlock it.',
        showUpgrade: true,
    },
    plan_lookup_failed: {
        title: 'Something went wrong',
        message: "We couldn't verify your plan limits just now. Please try again in a moment.",
        showUpgrade: false,
    },
    no_plan_resolved: {
        title: 'Something went wrong',
        message: "We couldn't find an active plan on your account. Please contact support if this continues.",
        showUpgrade: false,
    },
    subscription_expired: {
        title: 'Subscription expired',
        message: 'Your Pro subscription has expired. Renew to keep your Pro features.',
        showUpgrade: true,
    },
};

export interface PlanLimitInfo {
    title: string;
    message: string;
    showUpgrade: boolean;
    limit?: string | number | null;
    usage?: string | number | null;
}

interface PlanLimitState {
    isOpen: boolean;
    info: PlanLimitInfo | null;
    show: (reason: string, extra?: { limit?: any; usage?: any; fallbackMessage?: string }) => void;
    close: () => void;
}

export const usePlanLimitStore = create<PlanLimitState>((set) => ({
    isOpen: false,
    info: null,
    show: (reason, extra) => {
        const copy = REASON_COPY[reason] ?? {
            title: 'Action not available',
            message: extra?.fallbackMessage || 'This action is not available right now.',
            showUpgrade: false,
        };
        set({
            isOpen: true,
            info: { ...copy, limit: extra?.limit, usage: extra?.usage },
        });
    },
    close: () => set({ isOpen: false }),
}));
