import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { chatAPI, streamChat, generateTitle } from '../services/api';
import ModelSelector from './ModelSelector'; 
import ReactMarkdown from 'react-markdown';
import { 
  PaperAirplaneIcon, 
  StopIcon, 
  SparklesIcon,
  UserIcon,
  ClipboardIcon,
  CheckIcon,
  ArrowPathIcon,
  PhotoIcon,
  DocumentTextIcon,
  ArrowDownOnSquareIcon // NEW: Icon for Apply
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
  activeContext?: {
      fileName: string;
      fileContent: string;
  } | null;
  onApplyCode?: (code: string) => void; // NEW: Callback for applying code
}

export default function ChatInterface({ 
  sessionId, 
  onSessionUpdate, 
  activeContext,
  onApplyCode // Destructure new prop
}: ChatInterfaceProps) {
  
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadMessages();
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const loadMessages = async () => {
    try {
      setMessages([]);
      const response = await chatAPI.getMessages(sessionId);
      setMessages(response.data.messages || []);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleStop = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
    }
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
        if (messages[messages.length - 1].role === 'assistant') {
            setMessages(prev => prev.slice(0, -1));
        }
        processMessage(lastUserMsg.content, false);
    }
  };

  const handleCopyResponse = (content: string) => {
    navigator.clipboard.writeText(content);
  };

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
      
      const contextMessages = messages.map(m => ({ role: m.role, content: m.content }));
      if (isNewUserMessage) contextMessages.push({ role: 'user', content });

      let fullContent = '';
      
      // PREPARE CONTEXT PAYLOAD
      const requestContext = activeContext ? {
          file: {
              name: activeContext.fileName,
              content: activeContext.fileContent
          }
      } : undefined;

      await streamChat(
        contextMessages,
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
          if (messages.length <= 1) {
             await generateTitle(sessionId, content);
             if (onSessionUpdate) onSessionUpdate(); 
          }
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
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
    }
  };

  // UPDATED: Helper for Code Actions (Copy & Apply)
  const CodeActions = ({ code }: { code: string }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = () => {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

    return (
      <div className="flex items-center gap-2">
        {/* Apply Button (Only if prop provided) */}
        {onApplyCode && (
            <button 
                onClick={() => onApplyCode(code)}
                className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-ubiq-accent hover:text-white transition-colors mr-2"
                title="Insert code into editor"
            >
                <ArrowDownOnSquareIcon className="w-3.5 h-3.5" />
                Apply
            </button>
        )}
        
        {/* Separator */}
        {onApplyCode && <div className="w-px h-3 bg-white/10" />}

        {/* Copy Button */}
        <button onClick={handleCopy} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Copy code">
           {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-400" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6 scroll-smooth custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-6 md:space-y-8 pb-32">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-3 md:gap-5 group ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] md:text-xs font-bold ring-1 ring-white/10 shadow-lg ${
                msg.role === 'user' ? 'bg-ubiq-800 text-slate-300' : 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white'
              }`}>
                {msg.role === 'user' ? <UserIcon className="w-4 h-4" /> : <SparklesIcon className="w-4 h-4" />}
              </div>

              <div className="flex flex-col max-w-[85%] md:max-w-[80%] min-w-0">
                  <div className={`rounded-2xl px-4 py-3 md:px-6 md:py-4 text-sm leading-relaxed shadow-sm relative overflow-hidden ${
                    msg.role === 'user' ? 'bg-ubiq-800 text-slate-200 rounded-tr-sm border border-white/5' : 'bg-transparent text-slate-300 px-0 py-0 shadow-none'
                  }`}>
                    <ReactMarkdown components={{
                        code({node, className, children, ...props}) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !match ? (
                            <code className="bg-ubiq-950/50 border border-ubiq-700 rounded px-1.5 py-0.5 text-ubiq-accent font-mono text-xs break-all" {...props}>{children}</code>
                          ) : (
                            <div className="relative mt-3 mb-3 rounded-lg overflow-hidden border border-ubiq-700 bg-ubiq-950 shadow-lg w-full">
                               <div className="flex items-center justify-between px-3 py-1.5 bg-ubiq-900 border-b border-ubiq-800">
                                  <span className="text-[10px] text-slate-500 uppercase">{match[1]}</span>
                                  {/* Replaced CopyCodeButton with CodeActions */}
                                  <CodeActions code={String(children)} />
                               </div>
                               <div className="overflow-x-auto custom-scrollbar">
                                  <pre className="p-3 text-xs font-mono text-slate-300 min-w-max"><code className={className} {...props}>{children}</code></pre>
                               </div>
                            </div>
                          );
                        },
                        a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ubiq-accent hover:underline break-all">{children}</a>
                    }}>{msg.content}</ReactMarkdown>
                  </div>

                  <div className={`flex gap-2 mt-1 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
                      <button onClick={() => handleCopyResponse(msg.content)} className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors">
                          <ClipboardIcon className="w-3.5 h-3.5" />
                      </button>
                      {msg.role === 'assistant' && idx === messages.length - 1 && !isLoading && (
                          <button onClick={handleRetry} className="p-1.5 rounded text-slate-500 hover:text-ubiq-accent hover:bg-white/5 transition-colors">
                              <ArrowPathIcon className="w-3.5 h-3.5" />
                          </button>
                      )}
                  </div>
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
             <div className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white ring-1 ring-white/10"><SparklesIcon className="w-4 h-4 animate-pulse" /></div>
                <div className="flex items-center gap-1.5 h-8 px-2"><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-75" /><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-150" /><div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-300" /></div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-3 md:px-4 pb-4 pt-2 bg-gradient-to-t from-ubiq-950 via-ubiq-950 to-transparent z-20">
        <div className="max-w-3xl mx-auto relative">
          
          {/* Active Context Indicator */}
          {activeContext && (
             <div className="absolute -top-8 left-2 flex items-center gap-1.5 px-3 py-1 bg-ubiq-900/90 border border-ubiq-accent/30 rounded-t-lg text-[10px] text-ubiq-accent font-medium backdrop-blur-sm shadow-sm animate-fade-in">
                <DocumentTextIcon className="w-3 h-3" />
                Reading: {activeContext.fileName}
             </div>
          )}

          <div className={`relative glass-panel rounded-2xl p-2 shadow-2xl ring-1 ring-white/10 focus-within:ring-ubiq-accent/50 transition-all flex flex-col gap-2 bg-ubiq-900/90 backdrop-blur-xl ${activeContext ? 'rounded-tl-none' : ''}`}>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={activeContext ? `Ask about ${activeContext.fileName}...` : "Ask anything..."}
              className="w-full bg-transparent text-slate-200 text-sm px-3 py-2 focus:outline-none resize-none max-h-[150px] placeholder:text-slate-500"
            />
            
            <div className="flex items-center justify-between px-1 pb-0.5">
                <div className="flex items-center gap-1 md:gap-2">
                    <div className="scale-90 origin-left"><ModelSelector /></div>
                    <button className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors hidden md:block" title="Attach Image"><PhotoIcon className="w-5 h-5" /></button>
                </div>
                {isLoading ? (
                    <button onClick={handleStop} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-all text-xs font-medium"><StopIcon className="w-4 h-4 animate-pulse" /> <span className="hidden md:inline">Stop</span></button>
                ) : (
                    <button onClick={() => handleSubmit()} disabled={!input.trim()} className={`p-2 rounded-xl transition-all duration-200 ${input.trim() ? 'bg-ubiq-accent hover:bg-ubiq-accent-hover text-white shadow-lg shadow-ubiq-accent/20' : 'bg-ubiq-800 text-slate-500 cursor-not-allowed'}`}><PaperAirplaneIcon className="w-5 h-5" /></button>
                )}
            </div>
          </div>
          <div className="text-center mt-2 text-[10px] text-slate-600 font-medium hidden md:block">AI can make mistakes.</div>
        </div>
      </div>
    </div>
  );
}