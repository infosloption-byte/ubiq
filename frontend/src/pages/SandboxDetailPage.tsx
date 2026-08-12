import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { sandboxAPI } from '../services/api';
import ConfirmDialog from '../components/ConfirmDialog';
import {
    ArrowLeftIcon,
    FolderIcon,
    ClockIcon,
    StopIcon,
    CpuChipIcon,
    CircleStackIcon,
    WifiIcon,
    HeartIcon,
    ExclamationTriangleIcon,
    CodeBracketIcon,
    ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface SandboxDetail {
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
    log: string | null;
    log_available: boolean;
    log_note: string | null;
    crash_summary: {
        exit_code: number | null;
        oom_killed: boolean | null;
        finished_at: string | null;
        reason: string;
    } | null;
}

const STATUS_STYLES: Record<SandboxDetail['status'], { dot: string; badge: string; label: string }> = {
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

function formatDateTime(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

export default function SandboxDetailPage() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [sandbox, setSandbox] = useState<SandboxDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [stopModalOpen, setStopModalOpen] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [, forceTick] = useState(0);

    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const logRef = useRef<HTMLPreElement>(null);

    const load = useCallback(async (isBackground = false) => {
        if (!id) return;
        if (!isBackground) setLoading(true);
        try {
            const response = await sandboxAPI.get(Number(id));
            setSandbox(response.data.sandbox);
        } catch (error: any) {
            if (error?.response?.status === 404 || error?.response?.status === 403) {
                setNotFound(true);
            }
            console.error('Failed to load sandbox detail', error);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        load();
        // Live vitals + log for a still-running sandbox change server-side
        // without any action here, same cadence as the editor's own
        // sandbox panel — a crashed/stopped run's data is static, but
        // polling it anyway costs one cheap request and keeps this
        // simple rather than branching poll behavior on status.
        pollRef.current = setInterval(() => load(true), 5_000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [load]);

    useEffect(() => {
        const tick = setInterval(() => forceTick(t => t + 1), 1000);
        return () => clearInterval(tick);
    }, []);

    // Keep the log view pinned to the bottom as new lines arrive, same
    // behavior as the editor's own Live Server Logs panel.
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [sandbox?.log]);

    const handleStop = async () => {
        if (!sandbox) return;
        setStopping(true);
        try {
            await sandboxAPI.stop(sandbox.id);
            await load(true);
        } catch (error) {
            console.error('Failed to stop sandbox', error);
            alert('Failed to stop sandbox. Please try again.');
        } finally {
            setStopping(false);
            setStopModalOpen(false);
        }
    };

    if (loading) {
        return (
            <Layout>
                <div className="text-center py-20 text-slate-500">Loading sandbox…</div>
            </Layout>
        );
    }

    if (notFound || !sandbox) {
        return (
            <Layout>
                <div className="max-w-2xl mx-auto text-center py-20">
                    <p className="text-slate-400 mb-4">This sandbox doesn't exist, or isn't yours.</p>
                    <Link to="/sandboxes" className="text-ubiq-accent hover:underline">Back to Sandboxes</Link>
                </div>
            </Layout>
        );
    }

    const style = STATUS_STYLES[sandbox.status];
    const isRunning = sandbox.status === 'running';
    const uptime = isRunning ? liveDurationSeconds(sandbox.started_at) : sandbox.duration_seconds;

    return (
        <Layout>
            <div className="max-w-5xl mx-auto px-4 py-8">
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-6">
                    <Link to="/sandboxes" className="hover:text-ubiq-accent flex items-center gap-1">
                        <ArrowLeftIcon className="w-3.5 h-3.5" /> Sandboxes
                    </Link>
                </div>

                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div className="flex items-start gap-4">
                        <div
                            onClick={() => navigate(`/projects/${sandbox.project_id}`)}
                            className={`w-12 h-12 rounded-xl flex items-center justify-center cursor-pointer shrink-0 ${sandbox.project_language ? 'bg-ubiq-accent/10 text-ubiq-accent' : 'bg-white/5 text-slate-400'}`}
                            title="Open project"
                        >
                            <FolderIcon className="w-7 h-7" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <h1
                                    onClick={() => navigate(`/projects/${sandbox.project_id}`)}
                                    className="text-xl font-semibold text-white hover:text-ubiq-accent transition-colors cursor-pointer"
                                >
                                    {sandbox.project_name}
                                </h1>
                                <span className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${style.badge}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full shadow-[0_0_6px] ${style.dot} ${isRunning ? 'animate-pulse' : ''}`} />
                                    {style.label}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <CodeBracketIcon className="w-3.5 h-3.5" />
                                <span>{sandbox.framework || sandbox.runtime || 'Unknown stack'}</span>
                                {sandbox.port && <span className="text-slate-600">• :{sandbox.port}</span>}
                                <span className="text-slate-600">• {sandbox.container_name}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => load()}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all text-sm"
                        >
                            <ArrowPathIcon className="w-4 h-4" /> Refresh
                        </button>
                        {sandbox.stopped_at === null && (
                            <button
                                onClick={() => setStopModalOpen(true)}
                                disabled={stopping}
                                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all text-sm font-medium disabled:opacity-50"
                            >
                                <StopIcon className="w-4 h-4" /> {stopping ? 'Stopping…' : 'Stop'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Timing row */}
                <div className="flex items-center gap-4 text-xs text-slate-500 mb-6 pb-6 border-b border-white/5">
                    <span className="flex items-center gap-1.5">
                        <ClockIcon className="w-3.5 h-3.5" />
                        {isRunning ? `Up ${formatDuration(uptime)}` : `Ran ${formatDuration(uptime)}`}
                    </span>
                    <span>Started {formatDateTime(sandbox.started_at)}</span>
                    {sandbox.stopped_at && <span>Stopped {formatDateTime(sandbox.stopped_at)}</span>}
                </div>

                {/* Vitals */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5">
                        <CpuChipIcon className="w-4 h-4 text-slate-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">CPU</p>
                            <p className="text-xs text-slate-300 truncate">{sandbox.cpu_percent || '—'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5">
                        <CircleStackIcon className="w-4 h-4 text-slate-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Memory</p>
                            <p className="text-xs text-slate-300 truncate">{sandbox.mem_percent || sandbox.mem_usage || '—'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5">
                        <WifiIcon className="w-4 h-4 text-slate-500 shrink-0" />
                        <div className="min-w-0">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Network</p>
                            <p className="text-xs text-slate-300 truncate">{sandbox.net_io || '—'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2.5">
                        <HeartIcon className={`w-4 h-4 shrink-0 ${sandbox.health === 'healthy' ? 'text-emerald-400' : sandbox.health === 'unhealthy' ? 'text-red-400' : 'text-slate-500'}`} />
                        <div className="min-w-0">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wide">Health</p>
                            <p className="text-xs text-slate-300 truncate capitalize">{sandbox.health || 'No check'}</p>
                        </div>
                    </div>
                </div>

                {/* Crash summary */}
                {sandbox.crash_summary && (
                    <div className="mb-6 px-4 py-3.5 rounded-xl bg-red-500/5 border border-red-500/20">
                        <div className="flex items-start gap-2.5">
                            <ExclamationTriangleIcon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <p className="text-sm text-red-300 font-medium mb-1">Why this crashed</p>
                                <p className="text-sm text-red-300/80">{sandbox.crash_summary.reason}</p>
                                {(sandbox.crash_summary.exit_code !== null || sandbox.crash_summary.oom_killed || sandbox.crash_summary.finished_at) && (
                                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-red-400/70">
                                        {sandbox.crash_summary.exit_code !== null && <span>Exit code: {sandbox.crash_summary.exit_code}</span>}
                                        {sandbox.crash_summary.oom_killed && <span>OOM-killed</span>}
                                        {sandbox.crash_summary.finished_at && <span>Finished: {formatDateTime(sandbox.crash_summary.finished_at)}</span>}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Raw log */}
                <div>
                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                        Startup Log
                    </h2>
                    {sandbox.log_available && sandbox.log ? (
                        <pre
                            ref={logRef}
                            className="bg-black/40 border border-white/5 rounded-xl p-4 text-xs text-slate-300 font-mono leading-relaxed overflow-auto max-h-[28rem] whitespace-pre-wrap"
                        >
                            {sandbox.log}
                        </pre>
                    ) : (
                        <div className="bg-white/5 border border-white/5 rounded-xl p-4 text-sm text-slate-500">
                            {sandbox.log_note || 'No log available for this run.'}
                        </div>
                    )}
                </div>

                <ConfirmDialog
                    isOpen={stopModalOpen}
                    onClose={() => setStopModalOpen(false)}
                    onConfirm={handleStop}
                    title="Stop this sandbox?"
                    message={`This will stop and remove the running container for "${sandbox.project_name}". Unsaved container state (e.g. anything not written to project files) will be lost. You can start it again anytime from the project.`}
                    confirmText={stopping ? 'Stopping...' : 'Stop Sandbox'}
                    isDestructive
                />
            </div>
        </Layout>
    );
}
