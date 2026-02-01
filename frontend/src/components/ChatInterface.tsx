import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { chatAPI, streamChat, generateTitle } from '../services/api';
import ModelSelector from './ModelSelector'; 
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  PaperAirplaneIcon, StopIcon, SparklesIcon, UserIcon, 
  ClipboardIcon, CheckIcon, ArrowPathIcon, PhotoIcon, 
  DocumentTextIcon, ArrowDownOnSquareIcon 
} from '@heroicons/react/24/outline';

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

interface ChatInterfaceProps {
  sessionId: number;
  onSessionUpdate?: () => void;
  // UPDATED INTERFACE
  activeContext?: {
      projectStructure: string;
      currentFile?: { name: string; content: string };
  };
  onApplyCode?: (code: string) => void;
  autoPrompt?: string | null;
  onAutoPromptClear?: () => void;
}

export default function ChatInterface({ 
  sessionId, 
  onSessionUpdate, 
  activeContext,
  onApplyCode,
  autoPrompt,
  onAutoPromptClear
}: ChatInterfaceProps) {
  
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadMessages(); }, [sessionId]);

  useEffect(() => {
    if (autoPrompt) {
        processMessage(autoPrompt, true);
        if (onAutoPromptClear) onAutoPromptClear();
    }
  }, [autoPrompt]);

  useEffect(() => { scrollToBottom(); }, [messages, isLoading]);

  const loadMessages = async () => {
    try {
      setMessages([]);
      const response = await chatAPI.getMessages(sessionId);
      setMessages(response.data.messages || []);
    } catch (error) { console.error('Failed to load messages:', error); }
  };

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); };

  const handleStop = () => {
    if (abortController) { abortController.abort(); setAbortController(null); setIsLoading(false); }
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
        if (messages[messages.length - 1].role === 'assistant') { setMessages(prev => prev.slice(0, -1)); }
        processMessage(lastUserMsg.content, false);
    }
  };

  const handleCopyResponse = (content: string) => { navigator.clipboard.writeText(content); };

  const processMessage = async (content: string, isNewUserMessage: boolean = true) => {
    if (isLoading) return;

    const controller = new AbortController();
    setAbortController(controller);
    setIsLoading(true);

    try {
      if (isNewUserMessage) {
        const tempUserMsg: Message = { role: 'user', content, created_at: new Date().toISOString() };
        setMessages(prev => [...prev, tempUserMsg]);
        await chatAPI.sendMessage(sessionId, { content });
      }

      setMessages(prev => [...prev, { role: 'assistant', content: '', created_at: new Date().toISOString() }]);

      const preferred = user?.preferences?.preferred_model;
      const modelToSend = (typeof preferred === 'string' && preferred.trim() !== '') ? preferred : 'codellama:7b';
      
      // --- CRITICAL FIX: INJECT CONTEXT INTO MESSAGES ---
      const contextMessages = messages.map(m => ({ role: m.role, content: m.content }));
      
      // Build System Context
      let systemContext = "";
      if (activeContext) {
          if (activeContext.projectStructure) {
              systemContext += `\n[PROJECT STRUCTURE & FILES]\n${activeContext.projectStructure}\n`;
          }
          if (activeContext.currentFile) {
              systemContext += `\n[CURRENTLY OPEN FILE: ${activeContext.currentFile.name}]\n${activeContext.currentFile.content}\n`;
          }
      }

      // Prepend System Context
      if (systemContext) {
          // If the first message is already 'system', append to it. Otherwise add new one.
          // Note: Some models prefer system prompt at the start.
          contextMessages.unshift({ 
              role: 'system', 
              content: `You are an expert AI coding assistant. Use the following context to answer:\n${systemContext}` 
          });
      }

      if (isNewUserMessage) contextMessages.push({ role: 'user', content });

      let fullContent = '';
      
      // Keep requestContext in payload just in case backend is updated later to support it natively
      const requestContext = activeContext ? {
          projectStructure: activeContext.projectStructure,
          file: activeContext.currentFile ? {
              name: activeContext.currentFile.name,
              content: activeContext.currentFile.content
          } : undefined
      } : undefined;

      await streamChat(
        contextMessages, // This now contains the injected context!
        modelToSend,
        (chunk) => {
          fullContent += chunk;
          setMessages(prev => {
            const newMsgs = [...prev];
            const lastIndex = newMsgs.length - 1;
            if (newMsgs[lastIndex]) newMsgs[lastIndex].content = fullContent;
            return newMsgs;
          });
        },
        async () => {
          setIsLoading(false);
          setAbortController(null);
          await chatAPI.sendMessage(sessionId, { content: fullContent, role: 'assistant' });
          if (messages.length <= 1) { await generateTitle(sessionId, content); if (onSessionUpdate) onSessionUpdate(); }
        },
        (error) => {
          setMessages(prev => {
             const newMsgs = [...prev];
             const lastIndex = newMsgs.length - 1;
             if (newMsgs[lastIndex]) newMsgs[lastIndex].content += `\n\n**Error:** ${error}`;
             return newMsgs;
          });
          setIsLoading(false);
          setAbortController(null);
        },
        controller.signal,
        requestContext
      );

    } catch (error) {
      console.error('Chat processing failed:', error);
      setIsLoading(false);
      setAbortController(null);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;
    const msg = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    processMessage(msg, true);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const CodeBlockHeader = ({ language, code }: { language: string, code: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };

    return (
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#1e1e1e] border-b border-white/5 font-sans">
         <span className="text-[10px] text-slate-500 uppercase font-medium">{language || 'text'}</span>
         <div className="flex items-center gap-2">
            {onApplyCode && (
                <button onClick={() => onApplyCode(code)} className="flex items-center gap-1 text-[10px] text-ubiq-accent hover:text-white transition-colors" title="Insert code into editor">
                    <ArrowDownOnSquareIcon className="w-3.5 h-3.5" /> Apply
                </button>
            )}
            <div className="w-px h-3 bg-white/10" />
            <button onClick={handleCopy} className="text-[10px] text-slate-400 hover:text-white transition-colors flex items-center gap-1">
                {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
            </button>
         </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative bg-ubiq-950">
      <div className="flex-1 overflow-y-auto px-4 md:px-4 py-6 scroll-smooth custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-6 pb-32">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] ring-1 ring-white/10 shadow-lg mt-1 ${msg.role === 'user' ? 'bg-ubiq-800 text-slate-300' : 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white'}`}>
                {msg.role === 'user' ? <UserIcon className="w-3.5 h-3.5" /> : <SparklesIcon className="w-3.5 h-3.5" />}
              </div>
              <div className={`flex flex-col max-w-[90%] min-w-0`}>
                  <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed shadow-sm overflow-hidden ${msg.role === 'user' ? 'bg-ubiq-800 text-slate-200 border border-white/5 rounded-tr-none' : 'bg-transparent text-slate-300 px-0 py-0 shadow-none'}`}>
                    <ReactMarkdown components={{
                        code({node, className, children, ...props}) {
                          const match = /language-(\w+)/.exec(className || '');
                          const codeString = String(children).replace(/\n$/, '');
                          return !props.inline && match ? (
                            <div className="my-3 rounded-lg overflow-hidden border border-white/10 bg-[#0d0d0d] shadow-lg w-full">
                               <CodeBlockHeader language={match[1]} code={codeString} />
                               <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" customStyle={{ margin: 0, padding: '1rem', background: 'transparent', fontSize: '12px' }} {...props}>{codeString}</SyntaxHighlighter>
                            </div>
                          ) : (
                            <code className="bg-white/10 border border-white/5 rounded px-1.5 py-0.5 text-slate-200 font-mono text-xs break-all" {...props}>{children}</code>
                          );
                        },
                        a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ubiq-accent hover:underline">{children}</a>,
                        p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({children}) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
                        ol: ({children}) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
                    }}>{msg.content}</ReactMarkdown>
                  </div>
                  <div className={`flex gap-2 mt-1 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} opacity-50 hover:opacity-100 transition-opacity`}>
                      {msg.role === 'assistant' && idx === messages.length - 1 && !isLoading && (
                          <button onClick={handleRetry} className="p-1 rounded text-slate-500 hover:text-ubiq-accent transition-colors" title="Regenerate"><ArrowPathIcon className="w-3 h-3" /></button>
                      )}
                  </div>
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
             <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white ring-1 ring-white/10"><SparklesIcon className="w-3.5 h-3.5 animate-pulse" /></div>
                <div className="flex items-center gap-1.5 h-7 px-2"><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-75" /><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-150" /><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-300" /></div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-3 md:px-4 pb-4 pt-2 bg-gradient-to-t from-ubiq-950 via-ubiq-950 to-transparent z-20">
        <div className="max-w-3xl mx-auto relative">
          {activeContext && (
             <div className="absolute -top-8 left-2 flex items-center gap-1.5 px-3 py-1 bg-ubiq-900/90 border border-ubiq-accent/30 rounded-t-lg text-[10px] text-ubiq-accent font-medium backdrop-blur-sm shadow-sm animate-fade-in">
                <DocumentTextIcon className="w-3 h-3" />
                Context: {activeContext.currentFile ? activeContext.currentFile.name : 'Full Project'}
             </div>
          )}
          <div className={`relative glass-panel rounded-2xl p-2 shadow-2xl ring-1 ring-white/10 focus-within:ring-ubiq-accent/50 transition-all flex flex-col gap-2 bg-ubiq-900/90 backdrop-blur-xl ${activeContext ? 'rounded-tl-none' : ''}`}>
            <textarea ref={textareaRef} rows={1} value={input} onChange={handleInput} onKeyDown={handleKeyDown} placeholder={activeContext?.currentFile ? `Ask about ${activeContext.currentFile.name}...` : "Ask about your project..."} className="w-full bg-transparent text-slate-200 text-sm px-3 py-2 focus:outline-none resize-none max-h-[150px] placeholder:text-slate-500 custom-scrollbar" />
            <div className="flex items-center justify-between px-1 pb-0.5">
                <div className="flex items-center gap-1 md:gap-2">
                    <div className="scale-90 origin-left"><ModelSelector /></div>
                    <button className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors hidden md:block" title="Attach Image"><PhotoIcon className="w-5 h-5" /></button>
                </div>
                {isLoading ? (
                    <button onClick={handleStop} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all text-xs font-medium"><StopIcon className="w-4 h-4 animate-pulse" /> Stop</button>
                ) : (
                    <button onClick={() => handleSubmit()} disabled={!input.trim()} className={`p-2 rounded-xl transition-all duration-200 ${input.trim() ? 'bg-ubiq-accent hover:bg-ubiq-accent-hover text-white shadow-lg shadow-ubiq-accent/20' : 'bg-ubiq-800 text-slate-500 cursor-not-allowed'}`}><PaperAirplaneIcon className="w-5 h-5" /></button>
                )}
            </div>
          </div>
          <div className="text-center mt-2 text-[10px] text-slate-600 font-medium hidden md:block">AI can make mistakes. Check important info.</div>
        </div>
      </div>
    </div>
  );
}