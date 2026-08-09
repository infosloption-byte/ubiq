import { useState } from 'react';
import { authAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { KeyRound, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

/**
 * E5 (PLAN_SYSTEM_TASKS.md Phase E) — "Change Password" / "Set a Password".
 * Same form, two modes, decided by `user.has_password`:
 *   - true  -> normal password change, current password required.
 *   - false -> Google-only account with no real password yet. Adds
 *     email/password as a second login method without touching Google
 *     login. Matches the 2026-08-08 decision: relabel rather than force a
 *     false choice, like GitHub/Google-linked products do.
 */
export default function PasswordPanel() {
    const { user, setUser } = useAuthStore();
    const isChange = !!user?.has_password;

    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPasswords, setShowPasswords] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const reset = () => {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (newPassword.length < 8) {
            setError('New password must be at least 8 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('New passwords do not match.');
            return;
        }

        setSaving(true);
        try {
            const res = await authAPI.changePassword({
                ...(isChange ? { current_password: currentPassword } : {}),
                new_password: newPassword,
                new_password_confirmation: confirmPassword,
            });
            setSuccess(res.data?.message || 'Password saved.');
            if (user) setUser({ ...user, has_password: true });
            reset();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to save password.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-6 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center gap-2 mb-1">
                <KeyRound className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-bold text-white">{isChange ? 'Change Password' : 'Set a Password'}</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
                {isChange
                    ? 'Update the password you use to sign in.'
                    : "You signed up with Google and don't have a password yet. Set one to also sign in with your email."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
                {isChange && (
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Current Password</label>
                        <input
                            type={showPasswords ? 'text' : 'password'}
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50"
                            autoComplete="current-password"
                        />
                    </div>
                )}
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">New Password</label>
                    <input
                        type={showPasswords ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50"
                        autoComplete="new-password"
                        minLength={8}
                    />
                </div>
                <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Confirm New Password</label>
                    <input
                        type={showPasswords ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50"
                        autoComplete="new-password"
                        minLength={8}
                    />
                </div>

                <button
                    type="button"
                    onClick={() => setShowPasswords((s) => !s)}
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                    {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showPasswords ? 'Hide' : 'Show'} passwords
                </button>

                {error && <p className="text-xs text-red-400">{error}</p>}
                {success && (
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {success}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={saving || !newPassword || !confirmPassword || (isChange && !currentPassword)}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    {isChange ? 'Update Password' : 'Set Password'}
                </button>
            </form>
        </div>
    );
}
