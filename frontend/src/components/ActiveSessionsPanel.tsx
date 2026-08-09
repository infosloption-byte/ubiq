import { useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';
import { Monitor, MapPin, Clock, X, Loader2, RefreshCw } from 'lucide-react';

interface Session {
    id: number;
    is_current: boolean;
    device: string;
    ip_address: string | null;
    location: string | null; // null when geolocation couldn't resolve — see IpGeolocationService
    created_at: string;
    last_used_at: string | null;
}

/**
 * E3b (PLAN_SYSTEM_TASKS.md Phase E) — lists every active session (Sanctum
 * token) for the account: device, location, created, last active, plus a
 * per-session revoke action. The current session is labeled "This device"
 * and deliberately has no revoke button — revoking your own current
 * session from inside a settings list would just log you out mid-page in
 * a confusing way; "Log Out All Devices" (or the normal logout button)
 * already covers that case explicitly.
 */
export default function ActiveSessionsPanel() {
    const [sessions, setSessions] = useState<Session[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [revokingId, setRevokingId] = useState<number | null>(null);

    const fetchSessions = useCallback(() => {
        return authAPI.getSessions()
            .then(res => setSessions(res.data?.sessions || []))
            .catch(() => setSessions([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { fetchSessions(); }, [fetchSessions]);

    const handleRevoke = async (id: number) => {
        if (!window.confirm('Revoke this session? That device will need to sign in again.')) return;
        setRevokingId(id);
        try {
            await authAPI.revokeSession(id);
            await fetchSessions();
        } catch (e) {
            alert('Failed to revoke session.');
        } finally {
            setRevokingId(null);
        }
    };

    const formatDate = (iso: string | null) => {
        if (!iso) return 'Never';
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    if (loading) {
        return (
            <div className="p-6 bg-white/5 rounded-xl border border-white/10 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="p-6 bg-white/5 rounded-xl border border-white/10">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-bold text-white">Active Sessions</h3>
                <button
                    onClick={() => { setLoading(true); fetchSessions(); }}
                    title="Refresh sessions"
                    className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">Devices currently signed in to your account.</p>

            {(!sessions || sessions.length === 0) ? (
                <p className="text-xs text-slate-500">No sessions found.</p>
            ) : (
                <div className="space-y-2">
                    {sessions.map(s => (
                        <div key={s.id} className="p-3 rounded-lg bg-white/[0.02] border border-white/5 flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                                <Monitor className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-slate-200 font-medium truncate">{s.device}</span>
                                        {s.is_current && (
                                            <span className="text-[9px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded shrink-0">This device</span>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                                        <MapPin className="w-3 h-3 shrink-0" />
                                        {s.location || s.ip_address || 'Unknown location'}
                                    </div>
                                    <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                                        <Clock className="w-3 h-3 shrink-0" />
                                        Last active {formatDate(s.last_used_at)} · Created {formatDate(s.created_at)}
                                    </div>
                                </div>
                            </div>
                            {!s.is_current && (
                                <button
                                    onClick={() => handleRevoke(s.id)}
                                    disabled={revokingId === s.id}
                                    title="Revoke this session"
                                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50 shrink-0"
                                >
                                    {revokingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
