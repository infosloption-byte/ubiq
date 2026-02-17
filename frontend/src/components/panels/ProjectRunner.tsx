import { useState, useEffect, useRef } from 'react';
import { projectAPI } from '../../services/api';
import { 
    PlayIcon, ArrowPathIcon, ArrowTopRightOnSquareIcon, 
    ExclamationTriangleIcon, CommandLineIcon, ServerIcon,
    ShieldExclamationIcon, XMarkIcon 
} from '@heroicons/react/24/outline';

interface ProjectRunnerProps {
    projectId: number;
    onClose?: () => void;
}

export default function ProjectRunner({ projectId, onClose }: ProjectRunnerProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    
    // State for Real Logs & Errors
    const [error, setError] = useState('');
    const [realLogs, setRealLogs] = useState<string>(''); 
    const bottomRef = useRef<HTMLDivElement>(null);

    // 1. Auto-scroll to bottom of logs
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [realLogs]);

    // 2. POLL FOR LOGS (Every 2 seconds)
    useEffect(() => {
        let interval: NodeJS.Timeout;

        // Poll if running OR if we have a URL (to catch post-boot logs)
        if (isRunning || previewUrl) {
            const fetchLogs = async () => {
                try {
                    // Ensure you added getBuildLog to api.ts as instructed
                    // @ts-ignore 
                    const res = await projectAPI.getBuildLog(projectId);
                    setRealLogs(res.data.log || '');
                } catch (e) {
                    console.warn("Log polling waiting...", e);
                }
            };

            fetchLogs(); // Initial fetch
            interval = setInterval(fetchLogs, 2000);
        }

        return () => clearInterval(interval);
    }, [isRunning, previewUrl, projectId]);

    const handleRun = async () => {
        setIsRunning(true);
        setError('');
        setRealLogs('Initializing build request...');
        setPreviewUrl(null);
        
        try {
            // Trigger the backend to start Docker & create startup.sh
            const res = await projectAPI.runProject(projectId);
            
            setRealLogs((prev) => prev + "\n[System] Container allocated. Executing startup script...\n");
            
            // Give the container ~5 seconds to run the script before enabling the "Open" button.
            // This prevents opening the tab before the server port is actually listening.
            setTimeout(() => {
                setPreviewUrl(res.data.url);
                setIsRunning(false);
            }, 5000);
            
        } catch (err: any) {
            const errorMsg = err.response?.data?.error || 'Failed to start sandbox.';
            const details = err.response?.data?.details || err.message;
            
            setError(errorMsg);
            setRealLogs((prev) => prev + `\n❌ Error: ${errorMsg}\nDetails: ${details}\n`);
            setIsRunning(false);
        }
    };

    const isMixedContent = window.location.protocol === 'https:' && previewUrl?.startsWith('http:');

    return (
        <div className="flex flex-col h-full bg-ubiq-950">
            {/* --- HEADER --- */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900/50 shrink-0">
                 <div className="flex items-center gap-2">
                     <ServerIcon className="w-4 h-4 text-emerald-400" />
                     <span className="text-sm font-medium text-slate-200">Sandbox Server</span>
                 </div>
                 
                 <div className="flex items-center gap-3">
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
                     
                     <button 
                        onClick={handleRun}
                        disabled={isRunning}
                        className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 rounded-md text-xs font-bold transition-colors disabled:opacity-50"
                     >
                        {isRunning ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <PlayIcon className="w-3.5 h-3.5" />}
                        {isRunning ? 'BOOTING...' : 'RUN'}
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
                
                {/* 1. REAL LOG TERMINAL (Active during Boot & Success) */}
                {(isRunning || previewUrl) && (
                    <div className="absolute inset-0 flex flex-col p-4 bg-ubiq-950 z-10">
                         {/* Status Bar */}
                         <div className="flex items-center gap-2 mb-3 shrink-0">
                            {isRunning ? (
                                <ArrowPathIcon className="w-4 h-4 animate-spin text-emerald-500" />
                            ) : (
                                <ShieldExclamationIcon className="w-4 h-4 text-amber-500" />
                            )}
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                                {isRunning ? "Compiling & Booting..." : "Live Server Logs"}
                            </span>
                         </div>

                         {/* Log Output Window */}
                         <div className="flex-1 bg-black/60 border border-white/10 rounded-lg p-4 font-mono text-[10px] text-slate-300 overflow-y-auto custom-scrollbar whitespace-pre-wrap leading-relaxed shadow-inner">
                             {realLogs || "Waiting for container output..."}
                             <div ref={bottomRef} className="animate-pulse text-emerald-400 mt-2">_</div>
                         </div>

                         {/* Success Overlay for Mixed Content */}
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

                {/* 2. ERROR STATE */}
                {error && !isRunning && (
                    <div className="absolute inset-0 flex flex-col p-6 bg-ubiq-950 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-2 text-red-400 mb-4">
                            <ExclamationTriangleIcon className="w-6 h-6" />
                            <h3 className="text-lg font-bold">{error}</h3>
                        </div>
                        <div className="bg-black/80 border border-red-500/30 rounded-lg p-4 font-mono text-[10px] text-red-300 overflow-x-auto whitespace-pre-wrap">
                            {realLogs}
                        </div>
                    </div>
                )}

                {/* 3. SUCCESS IFRAME (Only works if Sandbox is HTTPS or Host is Localhost) */}
                {previewUrl && !isMixedContent && !isRunning && !error && (
                    <iframe 
                        src={previewUrl} 
                        className="w-full h-full border-none bg-white relative z-20"
                        title="Project Preview"
                        sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                    />
                )}

                {/* 4. IDLE STATE */}
                {!previewUrl && !isRunning && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 bg-ubiq-950">
                        <CommandLineIcon className="w-12 h-12 mb-4 opacity-20" />
                        <span className="text-sm font-medium">Ready to compile and boot sandbox.</span>
                    </div>
                )}
            </div>
        </div>
    );
}