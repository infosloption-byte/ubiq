import { useState, useEffect, useRef, useCallback } from 'react';
import { projectAPI, userAPI } from '../../services/api';
import { 
    PlayIcon, ArrowPathIcon, ArrowTopRightOnSquareIcon, 
    ExclamationTriangleIcon, CommandLineIcon, ServerIcon,
    ShieldExclamationIcon, XMarkIcon, StopIcon
} from '@heroicons/react/24/outline';

interface ProjectRunnerProps {
    projectId: number;
    onClose?: () => void;
    onContainerStateChange?: (running: boolean) => void;
}

export default function ProjectRunner({ projectId, onClose, onContainerStateChange }: ProjectRunnerProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isStopping, setIsStopping] = useState(false);
    const [error, setError] = useState('');
    const [realLogs, setRealLogs] = useState<string>('');
    const [isPollingActive, setIsPollingActive] = useState(false);
    const [storageInfo, setStorageInfo] = useState<{ used_mb: number; limit_mb: number } | null>(null);
    const [containerStatus, setContainerStatus] = useState<string | null>(null);
    const [exitCode, setExitCode] = useState<number | null>(null);
    
    const bottomRef = useRef<HTMLDivElement>(null);
    const pollStartRef = useRef<number>(0);
    const pendingUrlRef = useRef<string | null>(null);

    // Auto-scroll
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [realLogs]);

    // Fetch storage info once on mount
    useEffect(() => {
        userAPI.getStats().then(res => {
            const d = res.data;
            if (d?.storage_used_mb !== undefined) {
                setStorageInfo({ used_mb: d.storage_used_mb, limit_mb: d.storage_limit_mb ?? 500 });
            }
        }).catch(() => {});
    }, []);

    // FIX #14: client-side timeout is now a pure elapsed-time safety net
    // (network issues, backend unreachable) — not a text-matching one.
    // The old version required the log to NOT match a "success" pattern
    // to fire at all, which is exactly what silently disabled it here:
    // Vite's "ready in "/"Local:" banner printed before the crash, so the
    // log satisfied that pattern forever afterward and this check could
    // never trigger. Real success/failure now comes from the backend
    // (port_ready / container_status, see getBuildLog FIX #14) which
    // checks the actual TCP port rather than guessing from log text —
    // this timeout only exists to stop polling if THAT itself goes
    // silent (e.g. the network drops), set comfortably above the
    // backend's own 60s stall threshold so the backend's real answer
    // wins in the normal case.
    const CLIENT_TIMEOUT_MS = 150_000;

    // Real-state polling — stops only once the port actually answers,
    // or the backend reports a concrete failure (crashed / stuck / gone),
    // or this client-side timeout is hit as a last-resort safety net.
    useEffect(() => {
        if (!isPollingActive) return;

        let cancelled = false;

        const fetchLogs = async () => {
            if (cancelled) return;
            try {
                // @ts-ignore
                const res = await projectAPI.getBuildLog(projectId);
                const log: string = res.data.log || '';
                const status: string = res.data.container_status;
                const code: number | null = res.data.exit_code ?? null;
                const portReady: boolean = res.data.port_ready;

                setRealLogs(log);
                setContainerStatus(status);
                setExitCode(code);

                // Real success: the port actually answers.
                if (portReady) {
                    setPreviewUrl(pendingUrlRef.current);
                    setIsPollingActive(false);
                    onContainerStateChange?.(true);
                    return;
                }

                // Real failure: backend says the container crashed/stalled/vanished
                // (see getBuildLog FIX #14 — checks the real port + log mtime,
                // not log text, so this fires reliably even when the log
                // contains an earlier "ready"-looking line from before a crash).
                if (status === 'exited' || status === 'missing') {
                    setError(
                        status === 'exited'
                            ? `Sandbox stopped unexpectedly${code !== null ? ` (exit code ${code})` : ''}.`
                            : 'Sandbox container disappeared before it became reachable.'
                    );
                    setIsPollingActive(false);
                    return;
                }

                // Last-resort safety net — only reachable if the backend
                // itself has been unable to answer definitively for this
                // long (e.g. network trouble reaching it).
                const elapsed = Date.now() - pollStartRef.current;
                if (elapsed > CLIENT_TIMEOUT_MS) {
                    setError('Build is taking longer than expected — please try again.');
                    setIsPollingActive(false);
                }
            } catch (e) {
                console.warn('Log polling error', e);
            }
        };

        fetchLogs();
        const interval = setInterval(fetchLogs, 2000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [isPollingActive, projectId]);

    const handleRun = async () => {
        setIsRunning(true);
        setError('');
        setRealLogs('Initializing build request...');
        setPreviewUrl(null);
        setIsPollingActive(false);
        setContainerStatus(null);
        setExitCode(null);
        pollStartRef.current = Date.now();

        try {
            const res = await projectAPI.runProject(projectId);
            pendingUrlRef.current = res.data.url;
            setRealLogs(prev => prev + '\n[System] Container allocated. Executing startup script...\n');
            setIsRunning(false);       // hand off from "booting" spinner to log-polling view
            setIsPollingActive(true);  // readiness is now decided by the poller, not a timer
        } catch (err: any) {
            const errorMsg = err.response?.data?.error || 'Failed to start sandbox.';
            const details = err.response?.data?.details || err.message;
            setError(errorMsg);
            setRealLogs(prev => prev + `\n❌ Error: ${errorMsg}\nDetails: ${details}\n`);
            setIsRunning(false);
            setIsPollingActive(false);
        }
    };

    const handleStop = async () => {
        setIsStopping(true);
        setIsPollingActive(false);
        try {
            await projectAPI.stopProject(projectId);
        } catch (e) {
            // Container may already be gone — that's fine
        }
        setPreviewUrl(null);
        setIsRunning(false);
        setIsStopping(false);
        setRealLogs(prev => prev + '\n[Ubiq] Container stopped.\n');
        onContainerStateChange?.(false);
    };

    const isMixedContent = window.location.protocol === 'https:' && previewUrl?.startsWith('http:');

    const storagePercent = storageInfo ? Math.min(100, (storageInfo.used_mb / storageInfo.limit_mb) * 100) : null;
    const storageBarColor = storagePercent !== null
        ? storagePercent > 90 ? 'bg-red-500' : storagePercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
        : 'bg-emerald-500';

    return (
        <div className="flex flex-col h-full bg-ubiq-950">
            {/* --- HEADER --- */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900/50 shrink-0">
                 <div className="flex items-center gap-2">
                     <ServerIcon className="w-4 h-4 text-emerald-400" />
                     <span className="text-sm font-medium text-slate-200">Sandbox Server</span>
                     {/* Storage pill */}
                     {storageInfo && (
                         <div className="hidden sm:flex items-center gap-1.5 ml-2 px-2 py-0.5 bg-white/5 rounded-full border border-white/5">
                             <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
                                 <div className={`h-full rounded-full ${storageBarColor}`} style={{ width: `${storagePercent}%` }} />
                             </div>
                             <span className="text-[10px] text-slate-500">
                                 {storageInfo.used_mb < 1000
                                     ? `${storageInfo.used_mb.toFixed(0)}MB`
                                     : `${(storageInfo.used_mb / 1024).toFixed(1)}GB`
                                 } / {storageInfo.limit_mb >= 1024
                                     ? `${(storageInfo.limit_mb / 1024).toFixed(0)}GB`
                                     : `${storageInfo.limit_mb}MB`
                                 }
                             </span>
                         </div>
                     )}
                 </div>
                 
                 <div className="flex items-center gap-2">
                     {previewUrl && (
                        <a 
                            href={previewUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-md text-xs font-medium text-slate-300 hover:text-white transition-colors"
                            title="Open in New Tab"
                        >
                            Open Tab <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                        </a>
                     )}

                     {/* STOP button — visible when container is running */}
                     {(previewUrl || isRunning) && (
                         <button 
                            onClick={handleStop}
                            disabled={isStopping}
                            className="flex items-center gap-1.5 px-3 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-md text-xs font-bold transition-colors disabled:opacity-50"
                         >
                            {isStopping 
                                ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                                : <StopIcon className="w-3.5 h-3.5" />
                            }
                            {isStopping ? 'STOPPING...' : 'STOP'}
                         </button>
                     )}
                     
                     <button 
                        onClick={handleRun}
                        disabled={isRunning || isStopping}
                        className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-md text-xs font-bold transition-colors disabled:opacity-50"
                     >
                        {isRunning ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <PlayIcon className="w-3.5 h-3.5" />}
                        {isRunning ? 'BOOTING...' : (previewUrl ? 'RESTART' : 'RUN')}
                     </button>
                     
                     {onClose && (
                         <div className="pl-2 border-l border-white/10 ml-1">
                             <button onClick={onClose} className="p-1 text-slate-500 hover:text-white hover:bg-white/5 rounded transition-colors" title="Close Panel">
                                 <XMarkIcon className="w-4 h-4" />
                             </button>
                         </div>
                     )}
                 </div>
            </div>

            {/* --- VIEW AREA --- */}
            <div className="flex-1 relative overflow-hidden flex flex-col bg-[#0B0B10]">
                
                {/* 1. LOG TERMINAL
                     Must also show while isPollingActive — handleRun() hands
                     off from isRunning=true to isPollingActive=true (see its
                     comments) well before previewUrl is set (that only
                     happens once the poller sees port_ready). Without
                     isPollingActive here, that entire boot-polling window
                     had neither isRunning nor previewUrl true, so this block
                     hid itself and the IDLE block below took over instead —
                     "Ready to compile..." while build-log kept polling
                     invisibly underneath. */}
                {(isRunning || isPollingActive || previewUrl) && (
                    <div className="absolute inset-0 flex flex-col p-4 bg-ubiq-950 z-10">
                         <div className="flex items-center gap-2 mb-3 shrink-0">
                            {isRunning ? (
                                <ArrowPathIcon className="w-4 h-4 animate-spin text-emerald-500" />
                            ) : isPollingActive ? (
                                <ArrowPathIcon className="w-4 h-4 animate-spin text-slate-400" />
                            ) : (
                                <ShieldExclamationIcon className="w-4 h-4 text-amber-500" />
                            )}
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                {isRunning ? 'Compiling & Booting...' : 'Live Server Logs'}
                            </span>
                            {!isRunning && !isPollingActive && (
                                <span className="text-[10px] text-slate-600 ml-auto">● stable</span>
                            )}
                         </div>

                         <div className="flex-1 bg-black/60 border border-white/10 rounded-lg p-4 font-mono text-[10px] text-slate-300 overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed shadow-inner">
                             {realLogs || 'Waiting for container output...'}
                             <div ref={bottomRef} className="animate-pulse text-emerald-400 mt-2">_</div>
                         </div>

                         {previewUrl && isMixedContent && !isRunning && (
                            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-center shrink-0">
                                <p className="text-amber-200 text-xs mb-2">Sandbox is running on HTTP. Browsers block unsafe embedding.</p>
                                <a 
                                    href={previewUrl} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-ubiq-accent hover:bg-indigo-500 text-white text-xs font-bold rounded transition-colors shadow-lg shadow-indigo-900/20"
                                >
                                    Open Preview in New Tab <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                                </a>
                            </div>
                         )}
                    </div>
                )}

                {/* 2. ERROR STATE
                     Also gated on !isPollingActive for the same reason as
                     above — an error set mid-poll (e.g. stall timeout)
                     already calls setIsPollingActive(false) itself, but
                     guarding here too keeps this block from ever fighting
                     the Log Terminal block for the same render. */}
                {error && !isRunning && !isPollingActive && (
                    <div className="absolute inset-0 flex flex-col p-6 bg-ubiq-950 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-2 text-red-400 mb-2">
                            <ExclamationTriangleIcon className="w-6 h-6" />
                            <h3 className="text-lg font-bold">{error}</h3>
                        </div>
                        {(containerStatus || exitCode !== null) && (
                            <div className="flex items-center gap-3 mb-4 text-[11px] font-mono text-red-300/80">
                                {containerStatus && (
                                    <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded">
                                        container: {containerStatus}
                                    </span>
                                )}
                                {exitCode !== null && (
                                    <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded">
                                        exit code: {exitCode}
                                    </span>
                                )}
                            </div>
                        )}
                        <div className="bg-black/80 border border-red-500/30 rounded-lg p-4 font-mono text-[10px] text-red-300 overflow-x-auto whitespace-pre-wrap">
                            {realLogs}
                        </div>
                    </div>
                )}

                {/* 3. SUCCESS IFRAME */}
                {previewUrl && !isMixedContent && !isRunning && !error && (
                    <iframe 
                        src={previewUrl} 
                        className="w-full h-full border-none bg-white relative z-20"
                        title="Project Preview"
                        sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                    />
                )}

                {/* 4. IDLE STATE
                     The actual bug fix: this used to be reachable during
                     active build-log polling (isRunning already false,
                     previewUrl not yet set), which is why the panel showed
                     "Ready to compile..." while requests kept firing in the
                     background. Now excluded for the whole isPollingActive
                     window, not just the initial isRunning one. */}
                {!previewUrl && !isRunning && !isPollingActive && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-ubiq-950">
                        <CommandLineIcon className="w-12 h-12 mb-4 opacity-20" />
                        <span className="text-sm font-medium">Ready to compile and boot sandbox.</span>
                        {storageInfo && storagePercent !== null && storagePercent > 80 && (
                            <p className="text-xs text-amber-400 mt-3 opacity-70">
                                ⚠ Storage {storagePercent.toFixed(0)}% used — consider cleaning old projects.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}