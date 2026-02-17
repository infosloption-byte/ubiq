import { useState, useRef, useEffect } from 'react';
import { terminalAPI } from '../../services/api';
import { CommandLineIcon, TrashIcon } from '@heroicons/react/24/outline';

interface TerminalPanelProps {
    projectId: number;
}

interface HistoryItem {
    type: 'command' | 'output' | 'error';
    content: string;
}

export default function TerminalPanel({ projectId }: TerminalPanelProps) {
    const [history, setHistory] = useState<HistoryItem[]>([
        { type: 'output', content: 'Ubiq Terminal v1.0.0' },
        { type: 'output', content: 'Container connected. Ready for commands.' }
    ]);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom when history changes
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);

    // Focus input on click
    const handleContainerClick = () => {
        // Don't focus if user is selecting text
        if (window.getSelection()?.toString()) return;
        inputRef.current?.focus();
    };

    const handleExecute = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isProcessing) return;

        const cmd = input.trim();
        setInput('');
        setIsProcessing(true);

        // Add command to history
        setHistory(prev => [...prev, { type: 'command', content: cmd }]);

        try {
            if (cmd === 'clear') {
                setHistory([]);
                setIsProcessing(false);
                return;
            }

            // --- NEW: Add a temporary system message ---
            const tempId = Date.now();
            setHistory(prev => [...prev, { 
                type: 'output', 
                content: '► Connecting to container context...', 
                temp: true 
            } as any]);

            const res = await terminalAPI.execute(projectId, cmd);
            
            // Remove the temp message and show real output
            setHistory(prev => prev.filter((item: any) => !item.temp).concat({ 
                type: 'output', 
                content: res.data.output 
            }));

        } catch (err: any) {
            setHistory(prev => prev.filter((item: any) => !item.temp).concat({ 
                type: 'error', 
                content: err.response?.data?.output || 'Failed to execute command.' 
            }));
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div 
            className="flex flex-col h-full bg-[#0c0c0c] font-mono text-sm border-t border-white/10" 
            onClick={handleContainerClick}
        >
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1c] border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2 text-slate-400">
                    <CommandLineIcon className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Terminal</span>
                </div>
                <button 
                    onClick={() => setHistory([])} 
                    className="p-1 text-slate-500 hover:text-white transition-colors"
                    title="Clear Console"
                >
                    <TrashIcon className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Output Area */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-1">
                {history.map((item, idx) => (
                    <div key={idx} className={`${
                        item.type === 'command' ? 'text-yellow-400 mt-4 font-bold' : 
                        item.type === 'error' ? 'text-red-400' : 'text-slate-300'
                    } whitespace-pre-wrap break-all`}>
                        {item.type === 'command' && <span className="mr-2 opacity-50">$</span>}
                        {item.content}
                    </div>
                ))}
                
                {/* Input Line */}
                <form onSubmit={handleExecute} className="flex items-center mt-2 group">
                    <span className="text-emerald-500 mr-2 font-bold animate-pulse">{isProcessing ? '...' : '$'}</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={isProcessing}
                        className="flex-1 bg-transparent border-none outline-none text-slate-100 placeholder:text-slate-700"
                        autoComplete="off"
                        spellCheck="false"
                        autoFocus
                    />
                </form>
                <div ref={bottomRef} />
            </div>
        </div>
    );
}