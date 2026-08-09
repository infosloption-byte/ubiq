import { useAuthStore } from '../stores/authStore';
import { Link2, CheckCircle2, Mail } from 'lucide-react';

/**
 * E5 (PLAN_SYSTEM_TASKS.md Phase E) — "No connected accounts indicator."
 * Nothing in Settings previously showed whether an account was linked to
 * Google or was a plain email/password account. Small, read-only panel —
 * email/password is "connected" whenever `has_password` is true (which
 * includes accounts that started as Google-only and later used
 * PasswordPanel to add one), Google is connected whenever `google_id` is
 * set server-side (exposed here only as the boolean `google_connected`,
 * never the raw id).
 */
export default function ConnectedAccountsPanel() {
    const { user } = useAuthStore();

    const methods = [
        {
            key: 'email',
            label: 'Email & Password',
            detail: user?.email,
            icon: Mail,
            connected: !!user?.has_password,
        },
        {
            key: 'google',
            label: 'Google',
            detail: user?.google_connected ? 'Connected' : 'Not connected',
            icon: Link2,
            connected: !!user?.google_connected,
        },
    ];

    return (
        <div className="p-6 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 mb-1">
                <Link2 className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-bold text-white">Login Methods</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">How you can sign in to this account.</p>

            <div className="space-y-2">
                {methods.map(({ key, label, detail, icon: Icon, connected }) => (
                    <div
                        key={key}
                        className="p-3 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between gap-3"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <Icon className="w-4 h-4 text-slate-500 shrink-0" />
                            <div className="min-w-0">
                                <div className="text-sm text-slate-200 font-medium">{label}</div>
                                <div className="text-[11px] text-slate-500 truncate">{detail}</div>
                            </div>
                        </div>
                        {connected ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded shrink-0">
                                <CheckCircle2 className="w-3 h-3" /> Connected
                            </span>
                        ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-white/5 px-2 py-1 rounded shrink-0">
                                Not connected
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
