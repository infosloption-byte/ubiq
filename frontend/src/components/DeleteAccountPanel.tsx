import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

/**
 * E3d (PLAN_SYSTEM_TASKS.md Phase E) — "Delete Account." Highest-risk item
 * in the whole phase, so the UI is deliberately unhurried: the danger zone
 * starts collapsed, expanding it requires an explicit click, and the
 * delete button itself stays disabled until the typed confirmation
 * exactly matches "DELETE" or the account's own email — mirroring exactly
 * what AuthController::deleteAccount() checks server-side, so there's no
 * confusing "it looked right but the server rejected it" gap.
 *
 * On success: clears local auth state and sends the user to the landing
 * page. There is no undo — the backend has already canceled any PayPal
 * subscription, torn down sandbox containers, and cascade-deleted every
 * row this account owned.
 */
export default function DeleteAccountPanel() {
    const { user, logout } = useAuthStore();
    const navigate = useNavigate();

    const [expanded, setExpanded] = useState(false);
    const [confirmation, setConfirmation] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState('');

    const isValid =
        confirmation.trim().toUpperCase() === 'DELETE' ||
        confirmation.trim().toLowerCase() === (user?.email || '').toLowerCase();

    const handleDelete = async () => {
        if (!isValid) return;
        if (!window.confirm('This permanently deletes your account, projects, and files. This cannot be undone. Continue?')) {
            return;
        }

        setDeleting(true);
        setError('');
        try {
            await authAPI.deleteAccount(confirmation.trim());
            logout();
            navigate('/');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to delete account.');
            setDeleting(false);
        }
    };

    return (
        <div className="p-6 bg-red-500/5 rounded-xl border border-red-500/20">
            <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h3 className="text-sm font-bold text-red-300">Delete Account</h3>
            </div>
            <p className="text-xs text-slate-400 mb-4">
                Permanently deletes your account, every project and file, your AI chat history, and cancels any active
                subscription. This cannot be undone.
            </p>

            {!expanded ? (
                <button
                    onClick={() => setExpanded(true)}
                    className="flex items-center gap-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-slate-300 hover:text-red-300 px-4 py-2 rounded-lg text-sm font-bold transition-all"
                >
                    <Trash2 className="w-4 h-4" />
                    Delete My Account
                </button>
            ) : (
                <div className="space-y-3 max-w-sm">
                    <label className="block text-xs font-medium text-slate-400">
                        Type <span className="text-red-300 font-bold">DELETE</span> or your account email (
                        <span className="text-slate-300">{user?.email}</span>) to confirm
                    </label>
                    <input
                        type="text"
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                        placeholder="DELETE"
                        className="w-full bg-black/20 border border-red-500/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500/50"
                        autoComplete="off"
                    />

                    {error && <p className="text-xs text-red-400">{error}</p>}

                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleDelete}
                            disabled={!isValid || deleting}
                            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-40"
                        >
                            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                            Permanently Delete Account
                        </button>
                        <button
                            onClick={() => { setExpanded(false); setConfirmation(''); setError(''); }}
                            disabled={deleting}
                            className="text-xs text-slate-500 hover:text-slate-300 px-3 py-2 transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
