import { useState, useRef, useEffect, useCallback } from 'react';
import { terminalAPI } from '../../services/api';
import { CommandLineIcon, TrashIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface TerminalPanelProps {
    projectId: number;
    isContainerRunning?: boolean;
}

interface HistoryItem {
    type: 'command' | 'output' | 'error' | 'system';
    content: string;
    _id?: symbol;
}

const WELCOME: HistoryItem[] = [
    { type: 'system', content: 'Ubiq Terminal v1.0' },
    { type: 'system', content: 'Type commands to interact with your sandbox container.' },
];

const BLOCKED_COMMANDS = ['rm -rf /', 'mkfs', ':(){:|:&};:', 'dd if=/dev/zero'];

export default function TerminalPanel({ projectId, isContainerRunning = true }: TerminalPanelProps) {
    const [history, setHistory] = useState<HistoryItem[]>(WELCOME);
    const [input, setInput] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const cmdHistory = useRef<string[]>([]);
    const cmdHistoryIndex = useRef<number>(-1);
    const savedInput = useRef<string>('');

    const bottomRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);

    const focusInput = () => {
        if (window.getSelection()?.toString()) return;
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const hist = cmdHistory.current;
            if (hist.length === 0) return;
            if (cmdHistoryIndex.current === -1) savedInput.current = input;
            const nextIndex = Math.min(cmdHistoryIndex.current + 1, hist.length - 1);
            cmdHistoryIndex.current = nextIndex;
            setInput(hist[hist.length - 1 - nextIndex]);
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (cmdHistoryIndex.current <= 0) {
                cmdHistoryIndex.current = -1;
                setInput(savedInput.current);
                return;
            }
            const nextIndex = cmdHistoryIndex.current - 1;
            cmdHistoryIndex.current = nextIndex;
            setInput(cmdHistory.current[cmdHistory.current.length - 1 - nextIndex]);
        }

        if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault();
            setHistory([]);
        }
    };

    const handleExecute = async (e: React.FormEvent) => {
        e.preventDefault();
        const cmd = input.trim();
        if (!cmd || isProcessing) return;

        setInput('');
        cmdHistoryIndex.current = -1;
        savedInput.current = '';

        const lastCmd = cmdHistory.current[cmdHistory.current.length - 1];
        if (cmd !== lastCmd) {
            cmdHistory.current.push(cmd);
            if (cmdHistory.current.length > 100) cmdHistory.current.shift();
        }

        setHistory(prev => [...prev, { type: 'command', content: cmd }]);

        if (cmd === 'clear' || cmd === 'cls') { setHistory([]); return; }

        if (cmd === 'help') {
            setHistory(prev => [...prev, {
                type: 'system',
                content: 'Built-ins: clear, help\nUp/Down arrows: navigate history\nCtrl+L: clear terminal\nAll other commands run in your sandbox container.'
            }]);
            return;
        }

        if (!isContainerRunning) {
            setHistory(prev => [...prev, { type: 'error', content: 'No container running. Click RUN in the Sandbox panel first.' }]);
            return;
        }

        if (BLOCKED_COMMANDS.some(b => cmd.startsWith(b))) {
            setHistory(prev => [...prev, { type: 'error', content: `Command blocked for safety: ${cmd}` }]);
            return;
        }

        setIsProcessing(true);
        const tempSym = Symbol('temp');
        setHistory(prev => [...prev, { type: 'system', content: '► Running...', _id: tempSym }]);

        try {
            const res = await terminalAPI.execute(projectId, cmd);
            const output = res.data.output ?? '';
            setHistory(prev => [
                ...prev.filter(item => item._id !== tempSym),
                { type: 'output', content: output || '(no output)' }
            ]);
        } catch (err: any) {
            const msg = err.response?.data?.output
                || err.response?.data?.error
                || 'Failed to execute command. Is the container still running?';
            setHistory(prev => [
                ...prev.filter(item => item._id !== tempSym),
                { type: 'error', content: msg }
            ]);
        } finally {
            setIsProcessing(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#0c0c0c] font-mono text-sm border-t border-white/10" onClick={focusInput}>
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1c] border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2 text-slate-400">
                    <CommandLineIcon className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-wider">Terminal</span>
                    {!isContainerRunning && (
                        <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full ml-1">
                            <ExclamationTriangleIcon className="w-3 h-3" />
                            No container
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-600 hidden sm:block">↑↓ history · Ctrl+L clear</span>
                    <button
                        onClick={e => { e.stopPropagation(); setHistory([]); }}
                        className="p-1 text-slate-500 hover:text-white transition-colors"
                        title="Clear Console"
                    >
                        <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Output */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-1">
                {history.map((item, idx) => (
                    <div key={idx} className={`whitespace-pre-wrap break-all leading-relaxed ${
                        item.type === 'command' ? 'text-yellow-400 mt-3 font-bold' :
                        item.type === 'error'   ? 'text-red-400' :
                        item.type === 'system'  ? 'text-slate-500 italic text-xs' :
                        'text-slate-300'
                    }`}>
                        {item.type === 'command' && <span className="mr-2 text-emerald-500">$</span>}
                        {item.content}
                    </div>
                ))}

                <form onSubmit={handleExecute} className="flex items-center mt-2">
                    <span className={`mr-2 font-bold ${isProcessing ? 'text-slate-500 animate-pulse' : 'text-emerald-500'}`}>
                        {isProcessing ? '...' : '$'}
                    </span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isProcessing}
                        className="flex-1 bg-transparent border-none outline-none text-slate-100 placeholder:text-slate-700 caret-emerald-400"
                        placeholder={isContainerRunning ? '' : 'Start sandbox to use terminal...'}
                        autoComplete="off"
                        spellCheck={false}
                        autoFocus
                    />
                </form>
                <div ref={bottomRef} />
            </div>
        </div>
    );
}