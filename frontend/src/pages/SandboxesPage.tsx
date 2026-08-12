import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { sandboxAPI } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import {
    MagnifyingGlassIcon,
    CubeTransparentIcon,
    CodeBracketIcon,
    FolderIcon,
    ClockIcon,
    StopIcon,
    ArrowPathIcon,
    CpuChipIcon,
    CircleStackIcon,
    WifiIcon,
    ExclamationTriangleIcon,
    HeartIcon,
} from '@heroicons/react/24/outline';

interface Sandbox {
    id: number;
    project_id: number;
    project_name: string;
    project_language: string | null;
    status: 'running' | 'stopped' | 'crashed';
    runtime: string | null;
    framework: string | null;
    port: number | null;
    container_name: string;
    started_at: string;
    stopped_at: string | null;
    heartbeat_at: string | null;
    duration_seconds: number | null;
    docker_status: string;
    health: string | null;
    cpu_percent: string | null;
    mem_usage: string | null;
    mem_percent: string | null;
    net_io: string | null;
}

interface UsageInfo {
    used?: number;
    limit?: number | null;
    unlimited?: boolean;
    [key: string]: any;
}

const STATUS_STYLES: Record<Sandbox['status'], { dot: string; badge: string; label: string }> = {
    running: { dot: 'bg-emerald-400 shadow-emerald-400/50', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Running' },
    crashed: { dot: 'bg-red-400 shadow-red-400/50', badge: 'bg-red-500/10 text-red-400 border-red-500/20', label: 'Crashed' },
    stopped: { dot: 'bg-slate-500', badge: 'bg-white/5 text-slate-400 border-white/10', label: 'Stopped' },
};

function formatDuration(seconds: number | null): string {
    if (seconds === null || seconds < 0) return '—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function liveDurationSeconds(startedAt: string): number {
    return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
}

export default function SandboxesPage() {
    const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
    const [history, setHistory] = useState<Sandbox[]>([]);
    const [usage, setUsage] = useState<UsageInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState('');
    const [showHistory, setShowHistory] = useState(false);
    const [stopModal, setStopModal] = useState<{ open: boolean; sandbox: Sandbox | null }>({ open: false, sandbox: null });
    const [stoppingId, setStoppingId] = useState<number | null>(null);
    const [, forceTick] = useState(0);

    const navigate = useNavigate();
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadSandboxes = useCallback(async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        else setRefreshing(true);
        try {
            const response = await sandboxAPI.getAll();
            setSandboxes(response.data.sandboxes || []);
            setHistory(response.data.history || []);
            setUsage(response.data.usage || null);
        } catch (error) {
            console.error('Failed to load sandboxes', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadSandboxes();
        // Live vitals (CPU/mem) and health drift both change server-side
        // without any action here — poll like the editor's own sandbox
        // panel does, just at a page-level cadence rather than a
        // per-second one since this is an overview, not a live console.
        pollRef.current = setInterval(() => loadSandboxes(true), 10_000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [loadSandboxes]);

    // Tick every second purely to re-render running sandboxes' live
    // "uptime" counters without waiting for the next 10s poll.
    useEffect(() => {
        const tick = setInterval(() => forceTick(t => t + 1), 1000);
        return () => clearInterval(tick);
    }, []);

    const handleStop = async () => {
        if (!stopModal.sandbox) return;
        const id = stopModal.sandbox.id;
        setStoppingId(id);
        try {
            await sandboxAPI.stop(id);
            await loadSandboxes(true);
        } catch (error) {
            console.error('Failed to stop sandbox', error);
            alert('Failed to stop sandbox. Please try again.');
        } finally {
            setStoppingId(null);
            setStopModal({ open: false, sandbox: null });
        }
    };

    const filteredSandboxes = sandboxes.filter(s =>
        s.project_name.toLowerCase().includes(search.toLowerCase()) ||
        (s.framework || '').toLowerCase().includes(search.toLowerCase()) ||
        (s.runtime || '').toLowerCase().includes(search.toLowerCase())
    );

    const filteredHistory = history.filter(s =>
        s.project_name.toLowerCase().includes(search.toLowerCase())
    );

    const runningCount = sandboxes.filter(s => s.status === 'running').length;

    return (
        <Layout>
            <div className="h-full flex flex-col bg-ubiq-950 p-6 md:p-10 overflow-y-auto custom-scrollbar">

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                    <div>
                        <h1 className="text-3xl font-bold text-white tracking-tight mb-2">Sandboxes</h1>
                        <p className="text-slate-400">
                            Every sandbox you've started, across all projects — running, stopped, or crashed, with live health and vitals.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        {usage && (
                            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-ubiq-900 border border-white/5 text-sm">
                                <CubeTransparentIcon className="w-4 h-4 text-ubiq-accent" />
                                <span className="text-white font-semibold">{runningCount}</span>
                                <span className="text-slate-500">
                                    / {usage.unlimited ? '∞' : (usage.limit ?? '—')} active
                                </span>
                            </div>
                        )}
                        <button
                            onClick={() => loadSandboxes(true)}
                            disabled={refreshing}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all text-sm font-medium border border-white/5"
                            title="Refresh"
                        >
                            <ArrowPathIcon className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
                    <div className="relative max-w-md w-full">
                        <MagnifyingGlassIcon className="w-5 h-5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                            type="text"
                            placeholder="Search sandboxes by project, runtime, or framework..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="input-primary w-full pl-10 py-3 rounded-xl bg-ubiq-900/50 border-white/5 focus:bg-ubiq-900"
                        />
                    </div>

                    <button
                        onClick={() => setShowHistory(v => !v)}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all whitespace-nowrap ${
                            showHistory
                                ? 'bg-ubiq-accent/10 text-ubiq-accent border-ubiq-accent/30'
                                : 'bg-white/5 text-slate-400 border-white/5 hover:text-white'
                        }`}
                    >
                        <ClockIcon className="w-4 h-4" />
                        {showHistory ? 'Hide recent history' : 'Show recent history'}
                    </button>
                </div>

                {loading ? (
                    <div className="flex justify-center py-20">
                        <div className="w-8 h-8 border-2 border-ubiq-accent border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : filteredSandboxes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/10 rounded-2xl bg-white/5 mb-8">
                        <CubeTransparentIcon className="w-16 h-16 text-slate-600 mb-4" />
                        <h3 className="text-xl font-semibold text-white mb-2">No active sandboxes</h3>
                        <p className="text-slate-400 mb-6 max-w-sm text-center">
                            Sandboxes appear here once you run a project. Open a project and click Run to start one.
                        </p>
                        <button onClick={() => navigate('/projects')} className="btn-secondary">Go to Projects</button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                        {filteredSandboxes.map((sandbox) => {
                            const style = STATUS_STYLES[sandbox.status];
                            const isRunning = sandbox.status === 'running';
                            const uptime = isRunning
                                ? liveDurationSeconds(sandbox.started_at)
                                : sandbox.duration_seconds;

                            return (
                                <div
                                    key={sandbox.id}
                                    className="group relative bg-ubiq-900 border border-white/5 rounded-2xl p-6 hover:border-ubiq-accent/30 hover:bg-ubiq-900/80 transition-all duration-300 shadow-lg"
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div
                                            onClick={() => navigate(`/projects/${sandbox.project_id}`)}
                                            className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer ${sandbox.project_language ? 'bg-ubiq-accent/10 text-ubiq-accent' : 'bg-white/5 text-slate-400'}`}
                                        >
                                            <FolderIcon className="w-6 h-6" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${style.badge}`}>
                                                <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_6px] ${style.dot} ${isRunning ? 'animate-pulse' : ''}`} />
                                                {style.label}
                                            </span>
                                        </div>
                                    </div>

                                    <h3
                                        onClick={() => navigate(`/projects/${sandbox.project_id}`)}
                                        className="text-lg font-semibold text-white mb-1 group-hover:text-ubiq-accent transition-colors truncate cursor-pointer"
                                    >
                                        {sandbox.project_name}
                                    </h3>
                                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                                        <CodeBracketIcon className="w-3.5 h-3.5" />
                                        <span>{sandbox.framework || sandbox.runtime || 'Unknown stack'}</span>
                                        {sandbox.port && <span className="text-slate-600">• :{sandbox.port}</span>}
                                    </div>

                                    {/* Health / vitals */}
                                    <div className="grid grid-cols-2 gap-3 mb-4">
                                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                                            <CpuChipIcon className="w-4 h-4 text-slate-500 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">CPU</p>
                                                <p className="text-xs text-slate-300 truncate">{sandbox.cpu_percent || '—'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                                            <CircleStackIcon className="w-4 h-4 text-slate-500 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Memory</p>
                                                <p className="text-xs text-slate-300 truncate">{sandbox.mem_percent || sandbox.mem_usage || '—'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                                            <WifiIcon className="w-4 h-4 text-slate-500 shrink-0" />
                                            <div className="min-w-0">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Network</p>
                                                <p className="text-xs text-slate-300 truncate">{sandbox.net_io || '—'}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                                            <HeartIcon className={`w-4 h-4 shrink-0 ${sandbox.health === 'healthy' ? 'text-emerald-400' : sandbox.health === 'unhealthy' ? 'text-red-400' : 'text-slate-500'}`} />
                                            <div className="min-w-0">
                                                <p className="text-[10px] text-slate-500 uppercase tracking-wide">Health</p>
                                                <p className="text-xs text-slate-300 truncate capitalize">{sandbox.health || 'No check'}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {sandbox.status === 'crashed' && (
                                        <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20 text-[11px] text-red-300">
                                            <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
                                            <span>Container isn't responding to Docker. It will self-heal next time you click Run, or you can clear it below.</span>
                                        </div>
                                    )}

                                    <div className="flex items-center justify-between text-xs text-slate-500 border-t border-white/5 pt-4">
                                        <div className="flex items-center gap-1.5">
                                            <ClockIcon className="w-3.5 h-3.5" />
                                            {isRunning ? `Up ${formatDuration(uptime)}` : `Ran ${formatDuration(uptime)}`}
                                        </div>
                                        <button
                                            onClick={() => setStopModal({ open: true, sandbox })}
                                            disabled={stoppingId === sandbox.id}
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-all font-medium disabled:opacity-50"
                                            title="Stop and remove this sandbox"
                                        >
                                            <StopIcon className="w-3.5 h-3.5" />
                                            {stoppingId === sandbox.id ? 'Stopping…' : 'Stop'}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {showHistory && (
                    <div className="mt-2">
                        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">Recent history</h2>
                        {filteredHistory.length === 0 ? (
                            <p className="text-sm text-slate-500">No stopped sandboxes yet.</p>
                        ) : (
                            <div className="border border-white/5 rounded-2xl overflow-hidden divide-y divide-white/5">
                                {filteredHistory.map((sandbox) => (
                                    <div
                                        key={sandbox.id}
                                        onClick={() => navigate(`/projects/${sandbox.project_id}`)}
                                        className="flex items-center justify-between gap-4 px-5 py-3.5 bg-ubiq-900/50 hover:bg-ubiq-900 cursor-pointer transition-colors"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
                                            <span className="text-sm text-white truncate">{sandbox.project_name}</span>
                                            <span className="text-xs text-slate-500 truncate hidden sm:inline">
                                                {sandbox.framework || sandbox.runtime || ''}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-slate-500 shrink-0">
                                            <span>Ran {formatDuration(sandbox.duration_seconds)}</span>
                                            <span>{sandbox.stopped_at ? new Date(sandbox.stopped_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                <ConfirmDialog
                    isOpen={stopModal.open}
                    onClose={() => setStopModal({ open: false, sandbox: null })}
                    onConfirm={handleStop}
                    title="Stop this sandbox?"
                    message={`This will stop and remove the running container for "${stopModal.sandbox?.project_name}". Unsaved container state (e.g. anything not written to project files) will be lost. You can start it again anytime from the project.`}
                    confirmText={stoppingId === stopModal.sandbox?.id ? 'Stopping...' : 'Stop Sandbox'}
                    isDestructive
                />
            </div>
        </Layout>
    );
}
