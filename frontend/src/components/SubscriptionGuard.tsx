import React from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * C3 — This used to require subscription_tier === 'pro' to access ANY
 * route it wrapped (/chat, /projects, /editor), showing a hardcoded
 * "$9/month, Pro only" wall to every Free/Starter/Creator user. That's
 * the exact frontend mirror of the bug fixed in B4's CheckSubscription
 * middleware: PlanGuard (not a page-level gate) is now the source of
 * truth for what each tier can actually do — a Free user should be able
 * to OPEN the chat page and see their real 15/hr limit play out via
 * PlanGuard + the C2 modal, not be blocked from the page entirely before
 * ever finding out what their plan includes.
 *
 * Kept as a component (rather than deleted outright) in case a real
 * "your account has no usable access at all" state needs a home later —
 * e.g. a fully suspended account — but that's a different, much rarer
 * condition than "not on the top tier," which is what this guarded before.
 */
export const SubscriptionGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuthStore();

    // Any authenticated user passes through — PlanGuard enforces the
    // actual per-tier limits server-side, surfaced via the C2 modal when
    // they're hit. This is intentionally NOT tier-based anymore.
    if (!user) {
        return <>{children}</>;
    }

    return <>{children}</>;
};