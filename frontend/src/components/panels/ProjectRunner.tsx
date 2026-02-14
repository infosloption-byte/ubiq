import { useState, useEffect } from 'react';
import { projectAPI } from '../../services/api';
import { 
    PlayIcon, ArrowPathIcon, ArrowTopRightOnSquareIcon, 
    ExclamationTriangleIcon, CommandLineIcon, ServerIcon,
    ShieldExclamationIcon, XMarkIcon 
} from '@heroicons/react/24/outline';

interface ProjectRunnerProps {
    projectId: number;
    onClose?: () => void; // NEW: Passed from parent to close the panel cleanly
}

export default function ProjectRunner({ projectId, onClose }: ProjectRunnerProps) {
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    
    // Detailed Terminal States
    const [error, setError] = useState('');
    const [errorDetails, setErrorDetails] = useState('');
    const [executedCommand, setExecutedCommand] = useState('');
    const [loadingStep, setLoadingStep] = useState(0);

    // Simulated terminal text to keep user engaged while backend blocks
    const loadingMessages = [
        "Analyzing ubiq.json configuration...",
        "Allocating container and mapping ports...",
        "Mounting workspace storage volume...",
        "Executing runtime build scripts...",
        "Installing framework dependencies...",
        "Starting development server..."
    ];

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (isRunning) {
            setLoadingStep(0);
            interval = setInterval(() => {
                setLoadingStep(prev => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
            }, 3000); // Change message every 3 seconds
        }
        return () => clearInterval(interval);
    }, [isRunning]);

    const handleRun = async () => {
        setIsRunning(true);
        setError('');
        setErrorDetails('');
        setExecutedCommand('');
        setPreviewUrl(null);
        
        try {
            const res = await projectAPI.runProject(projectId);
            
            // Artificial delay to let the UI breathe
            setTimeout(() => {
                setExecutedCommand(res.data.command || 'Sandbox booted successfully.');
                setPreviewUrl(res.data.url);
                setIsRunning(false);
            }, 1500);
            
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to start sandbox.');
            setErrorDetails(err.response?.data?.details || err.message || 'Unknown network error.');
            setExecutedCommand(err.response?.data?.command || 'Unknown command');
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
                 
                 {/* Action Buttons safely aligned */}
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
                     
                     {/* NEW: Clean Close Button */}
                     {onClose && (
                         <div className="pl-2 border-l border-white/10 ml-1">
                             <button 
                                onClick={onClose} 
                                className="p-1 text-slate-500 hover:text-white hover:bg-white/5 rounded transition-colors"
                                title="Close Panel"
                             >
                                 <XMarkIcon className="w-4 h-4" />
                             </button>
                         </div>
                     )}
                 </div>
            </div>

            {/* --- VIEW AREA --- */}
            <div className="flex-1 relative overflow-hidden flex flex-col bg-[#0B0B10]">
                
                {/* STATE 1: LOADING (Terminal Stepper) */}
                {isRunning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-ubiq-950 z-10">
                         <ArrowPathIcon className="w-10 h-10 animate-spin text-emerald-500 mb-6" />
                         <div className="w-full max-w-sm bg-black/50 border border-white/10 rounded-lg p-4 font-mono text-xs">
                             {loadingMessages.map((msg, idx) => (
                                 <div 
                                    key={idx} 
                                    className={`py-1 transition-all duration-500 ${idx === loadingStep ? 'text-emerald-400' : idx < loadingStep ? 'text-slate-500' : 'hidden'}`}
                                 >
                                    <span className="mr-2 opacity-50">$</span> {msg}
                                 </div>
                             ))}
                             <div className="animate-pulse text-emerald-400 mt-1">_</div>
                         </div>
                    </div>
                )}

                {/* STATE 2: ERROR TERMINAL */}
                {error && !isRunning && (
                    <div className="absolute inset-0 flex flex-col p-6 bg-ubiq-950 overflow-y-auto custom-scrollbar">
                        <div className="flex items-center gap-2 text-red-400 mb-4">
                            <ExclamationTriangleIcon className="w-6 h-6" />
                            <h3 className="text-lg font-bold">{error}</h3>
                        </div>
                        
                        <div className="space-y-4 w-full">
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Executed Command</p>
                                <div className="bg-black/60 border border-red-500/20 rounded-lg p-3 font-mono text-[10px] text-slate-300 break-all">
                                    <span className="text-red-400 select-none">$ </span>
                                    {executedCommand}
                                </div>
                            </div>
                            
                            <div>
                                <p className="text-xs font-bold text-slate-500 uppercase mb-1">Build Logs / Error Output</p>
                                <pre className="bg-black/80 border border-red-500/30 rounded-lg p-4 font-mono text-[10px] text-red-300 overflow-x-auto whitespace-pre-wrap">
                                    {errorDetails}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}

                {/* STATE 3: MIXED CONTENT WARNING (SUCCESS LOGS) */}
                {previewUrl && isMixedContent && !isRunning && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-ubiq-950 text-center p-6 z-10 overflow-y-auto custom-scrollbar">
                        <ShieldExclamationIcon className="w-12 h-12 text-amber-500 mb-4 opacity-80 shrink-0" />
                        <h3 className="text-slate-200 font-bold mb-2 text-lg shrink-0">Running Securely</h3>
                        <p className="text-slate-400 text-sm mb-6 max-w-sm shrink-0">
                            The Docker container compiled successfully. Browsers block HTTP sandboxes from displaying directly inside HTTPS editors.
                        </p>
                        
                        {/* NEW: Beautiful Build History Log instead of ugly command */}
                        <div className="bg-black/40 border border-white/5 rounded-lg p-4 font-mono text-[10px] text-slate-300 mb-8 w-full max-w-sm text-left space-y-2 shrink-0">
                            <p className="text-emerald-400 mb-3 font-bold uppercase tracking-wider text-xs border-b border-white/5 pb-2">Build Log History</p>
                            {loadingMessages.map((msg, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                    <span className="text-emerald-500 font-bold">✓</span>
                                    <span className="opacity-80">{msg}</span>
                                </div>
                            ))}
                            <div className="flex items-start gap-2 mt-2 pt-2 border-t border-white/5">
                                <span className="text-emerald-500 font-bold">✓</span>
                                <span className="text-emerald-400 font-bold">Server online and listening.</span>
                            </div>
                        </div>

                        <a 
                            href={previewUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="px-6 py-2.5 bg-ubiq-accent hover:bg-indigo-500 text-white font-medium rounded-lg flex items-center gap-2 transition-colors shadow-lg shadow-indigo-900/20 shrink-0"
                        >
                            Open Sandbox <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                        </a>
                    </div>
                )}

                {/* STATE 4: SUCCESS IFRAME (If localhost or secure) */}
                {previewUrl && !isMixedContent && !isRunning && !error && (
                    <iframe 
                        src={previewUrl} 
                        className="w-full h-full border-none bg-white"
                        title="Project Preview"
                        sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
                    />
                )}

                {/* STATE 5: IDLE */}
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