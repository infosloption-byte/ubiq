import { useState } from 'react';
import { privacyApi } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { Download, Loader2, Eye, MessageSquareX, ShieldCheck, CheckCircle2 } from 'lucide-react';

/**
 * E4 (PLAN_SYSTEM_TASKS.md Phase E) — New Privacy tab. Deliberately scoped
 * to only what actually exists and does something real (see the 2026-08-08
 * audit note in PLAN_SYSTEM_TASKS.md): this app has no email/marketing
 * system and tracks no analytics inside the authenticated editor, so
 * neither of those toggles is offered here — they'd control nothing.
 *
 * What's here instead, all against real tables/features:
 *   - Export My Data      -> GET /user/export (account + projects/files + chat history)
 *   - Default Visibility  -> PUT /user/default-visibility (ties into the
 *                             existing `sharing.enabled` plan feature)
 *   - Clear AI Chat History -> POST /user/chat-history/clear
 *   - Delete Account is intentionally NOT duplicated here — this panel
 *     just links back to the Account tab where DeleteAccountPanel lives,
 *     so there's exactly one place that flow exists.
 */
export default function PrivacyPanel({ onGoToAccount }: { onGoToAccount?: () => void }) {
    const { user, setUser } = useAuthStore();

    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState('');

    const [visibility, setVisibility] = useState<'private' | 'public'>(user?.default_project_visibility || 'private');
    const [savingVisibility, setSavingVisibility] = useState(false);
    const [visibilitySaved, setVisibilitySaved] = useState(false);

    const [clearing, setClearing] = useState(false);
    const [clearMessage, setClearMessage] = useState('');
    const [clearError, setClearError] = useState('');

    const handleExport = async () => {
        setExporting(true);
        setExportError('');
        try {
            const res = await privacyApi.exportData();
            const disposition: string = res.headers?.['content-disposition'] || '';
            const match = disposition.match(/filename="?([^"]+)"?/);
            const filename = match?.[1] || `ubiq-export-${user?.username || 'account'}.json`;

            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            setExportError('Failed to export your data. Please try again.');
        } finally {
            setExporting(false);
        }
    };

    const handleVisibilityChange = async (next: 'private' | 'public') => {
        setVisibility(next);
        setSavingVisibility(true);
        setVisibilitySaved(false);
        try {
            await privacyApi.updateDefaultVisibility(next);
            if (user) setUser({ ...user, default_project_visibility: next });
            setVisibilitySaved(true);
            setTimeout(() => setVisibilitySaved(false), 2000);
        } catch {
            // Revert on failure — most likely the plan doesn't allow
            // public projects (sharing.enabled), same gate ProjectController
            // applies at creation time.
            setVisibility(user?.default_project_visibility || 'private');
        } finally {
            setSavingVisibility(false);
        }
    };

    const handleClearChatHistory = async () => {
        if (!window.confirm('Delete all AI chat history across every project? This cannot be undone.')) return;
        setClearing(true);
        setClearError('');
        setClearMessage('');
        try {
            const res = await privacyApi.clearChatHistory();
            setClearMessage(res.data?.message || 'Chat history cleared.');
        } catch {
            setClearError('Failed to clear chat history. Please try again.');
        } finally {
            setClearing(false);
        }
    };

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-xl font-bold text-white mb-2">Privacy</h2>
                <p className="text-sm text-slate-400">Your data, your control.</p>
            </div>

            {/* Export My Data */}
            <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                    <Download className="w-4 h-4 text-slate-400" />
                    <h3 className="text-sm font-bold text-white">Export My Data</h3>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                    Download a JSON file with your account info, every project and file, and your AI chat history.
                </p>
                {exportError && <p className="text-xs text-red-400 mb-2">{exportError}</p>}
                <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60"
                >
                    {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    Download My Data
                </button>
            </div>

            {/* Default Project Visibility */}
            <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                    <Eye className="w-4 h-4 text-slate-400" />
                    <h3 className="text-sm font-bold text-white">Default Project Visibility</h3>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                    Applies to new projects when you don't set visibility explicitly at creation.
                </p>
                <div className="flex items-center gap-2">
                    {(['private', 'public'] as const).map((opt) => (
                        <button
                            key={opt}
                            onClick={() => handleVisibilityChange(opt)}
                            disabled={savingVisibility}
                            className={`px-4 py-2 rounded-lg text-sm font-bold capitalize transition-all disabled:opacity-60 ${
                                visibility === opt
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                            }`}
                        >
                            {opt}
                        </button>
                    ))}
                    {savingVisibility && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
                    {visibilitySaved && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                        </span>
                    )}
                </div>
            </div>

            {/* Clear AI Chat History */}
            <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                <div className="flex items-center gap-2 mb-1">
                    <MessageSquareX className="w-4 h-4 text-slate-400" />
                    <h3 className="text-sm font-bold text-white">Clear AI Chat History</h3>
                </div>
                <p className="text-xs text-slate-400 mb-4">
                    Deletes every chat session and message across all of your projects. Your project files aren't affected.
                </p>
                {clearError && <p className="text-xs text-red-400 mb-2">{clearError}</p>}
                {clearMessage && (
                    <p className="text-xs text-emerald-400 mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {clearMessage}
                    </p>
                )}
                <button
                    onClick={handleClearChatHistory}
                    disabled={clearing}
                    className="flex items-center gap-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-slate-300 hover:text-red-300 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60"
                >
                    {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareX className="w-4 h-4" />}
                    Clear Chat History
                </button>
            </div>

            {/* Link to Delete Account — E3d lives on the Account tab; not duplicated here */}
            <div className="p-6 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                    <div>
                        <h3 className="text-sm font-bold text-white">Delete Account</h3>
                        <p className="text-xs text-slate-400">Manage account deletion from the Account tab.</p>
                    </div>
                </div>
                <button
                    onClick={onGoToAccount}
                    className="text-xs font-bold text-indigo-300 hover:text-indigo-200 px-3 py-2 rounded-lg border border-white/10 hover:border-indigo-500/30 transition-all shrink-0"
                >
                    Go to Account
                </button>
            </div>
        </div>
    );
}
