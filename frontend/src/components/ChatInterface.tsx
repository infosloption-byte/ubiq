import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { chatAPI, aiAPI } from '../services/api';
import ReactMarkdown from 'react-markdown';
import { 
  PaperAirplaneIcon, 
  StopIcon, 
  SparklesIcon,
  UserIcon,
  ClipboardIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

interface Message {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string;
}

interface ChatInterfaceProps {
  sessionId: number;
}

export default function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const { user } = useAuthStore(); // Subscribed to store updates
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    loadMessages();
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

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

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const content = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const tempUserMsg: Message = { role: 'user', content, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, tempUserMsg]);
    setIsLoading(true);
    setIsTyping(true);

    try {
      await chatAPI.sendMessage(sessionId, { content });

      const contextMessages = messages.slice(-10).map(m => ({
        role: m.role,
        content: m.content
      }));
      contextMessages.push({ role: 'user', content });

      // DEBUG: Verify exactly what model is being used from the store
      const preferred = user?.preferences?.preferred_model;
      console.log('DEBUG: User Preferences in Store:', user?.preferences);
      
      const modelToSend = (typeof preferred === 'string' && preferred.trim() !== '') 
        ? preferred 
        : 'codellama:7b';

      console.log('Sending chat request with model:', modelToSend);

      const response = await aiAPI.chat({
        messages: contextMessages,
        model: modelToSend
      });

      const aiContent = response.data.message.content || response.data.message;

      const aiMsg: Message = { 
        role: 'assistant', 
        content: aiContent, 
        created_at: new Date().toISOString() 
      };
      
      await chatAPI.sendMessage(sessionId, { content: aiContent, role: 'assistant' });
      setMessages(prev => [...prev, aiMsg]);

    } catch (error: any) {
      console.error('Chat failed:', error);
      let errorMsg = "**Error:** Failed to connect to AI.";
      
      if (error.response?.status === 422) {
         errorMsg = "**Configuration Error:** The AI model setting is invalid. Please go to settings and select a model again.";
      } else if (error.response?.data?.message) {
         errorMsg = `**Error:** ${error.response.data.message}`;
      }

      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: errorMsg
      }]);
    } finally {
      setIsLoading(false);
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Helper for Code Copy Button
  const CopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    return (
      <button onClick={handleCopy} className="absolute right-2 top-2 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-all">
        {copied ? <CheckIcon className="w-4 h-4 text-green-400" /> : <ClipboardIcon className="w-4 h-4" />}
      </button>
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth custom-scrollbar">
        <div className="max-w-3xl mx-auto space-y-8">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ring-1 ring-white/10 shadow-lg ${
                msg.role === 'user' ? 'bg-ubiq-800 text-slate-300' : 'bg-gradient-to-tr from-indigo-600 to-purple-600 text-white'
              }`}>
                {msg.role === 'user' ? <UserIcon className="w-4 h-4" /> : <SparklesIcon className="w-4 h-4" />}
              </div>
              <div className={`flex-1 max-w-[85%] rounded-2xl px-6 py-4 text-sm leading-relaxed shadow-sm relative group ${
                msg.role === 'user' ? 'bg-ubiq-800 text-slate-200 rounded-tr-sm border border-white/5' : 'bg-transparent text-slate-300 px-0 py-0 shadow-none'
              }`}>
                <ReactMarkdown components={{
                    code({node, className, children, ...props}) {
                      const match = /language-(\w+)/.exec(className || '');
                      const isInline = !match;
                      return isInline ? (
                        <code className="bg-ubiq-950/50 border border-ubiq-700 rounded px-1.5 py-0.5 text-ubiq-accent font-mono text-xs" {...props}>{children}</code>
                      ) : (
                        <div className="relative mt-3 mb-3 rounded-lg overflow-hidden border border-ubiq-700 bg-ubiq-950 shadow-lg">
                           <div className="flex items-center justify-between px-4 py-1.5 bg-ubiq-900 border-b border-ubiq-800">
                              <span className="text-[10px] text-slate-500 uppercase">{match?.[1] || 'code'}</span>
                              <CopyButton text={String(children)} />
                           </div>
                           <pre className="p-4 overflow-x-auto text-xs font-mono text-slate-300"><code className={className} {...props}>{children}</code></pre>
                        </div>
                      );
                    },
                    p: ({children}) => <p className="mb-3 last:mb-0">{children}</p>,
                    ul: ({children}) => <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>,
                    ol: ({children}) => <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>,
                    a: ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-ubiq-accent hover:underline">{children}</a>
                  }}>{msg.content}</ReactMarkdown>
              </div>
            </div>
          ))}
          {isTyping && (
             <div className="flex gap-5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white ring-1 ring-white/10"><SparklesIcon className="w-4 h-4 animate-pulse" /></div>
                <div className="flex items-center gap-1.5 h-8 px-2">
                   <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-75" />
                   <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-150" />
                   <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce delay-300" />
                </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="px-4 pb-6 pt-2 bg-gradient-to-t from-ubiq-950 via-ubiq-950 to-transparent z-20">
        <div className="max-w-3xl mx-auto relative">
          <div className="relative glass-panel rounded-2xl p-2 flex items-end gap-2 shadow-2xl ring-1 ring-white/10 focus-within:ring-ubiq-accent/50 transition-all">
            <textarea ref={textareaRef} rows={1} value={input} onChange={handleInput} onKeyDown={handleKeyDown} placeholder="Ask anything..." className="w-full bg-transparent text-slate-200 text-sm px-4 py-3 focus:outline-none resize-none max-h-[200px] placeholder:text-slate-500" />
            <button onClick={() => handleSendMessage()} disabled={!input.trim() || isLoading} className={`p-2.5 rounded-xl mb-1 flex-shrink-0 transition-all duration-200 ${input.trim() && !isLoading ? 'bg-ubiq-accent hover:bg-ubiq-accent-hover text-white shadow-lg shadow-ubiq-accent/20' : 'bg-ubiq-800 text-slate-500 cursor-not-allowed'}`}>
              {isLoading ? <StopIcon className="w-5 h-5 animate-pulse" /> : <PaperAirplaneIcon className="w-5 h-5" />}
            </button>
          </div>
          <div className="text-center mt-3 text-[10px] text-slate-600 font-medium">AI can make mistakes. Please review generated code.</div>
        </div>
      </div>
    </div>
  );
}