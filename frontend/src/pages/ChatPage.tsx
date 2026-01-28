import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { chatAPI, aiAPI } from '../services/api';
import ReactMarkdown from 'react-markdown';
import { 
  PaperAirplaneIcon, 
  PlusIcon, 
  CpuChipIcon,
  StopIcon
} from '@heroicons/react/24/solid';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default function ChatPage() {
  const { user } = useAuthStore();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const startNewChat = () => {
    setMessages([]);
    setSessionId(null);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // 1. Create session if it doesn't exist
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        const sessionRes = await chatAPI.createSession({ title: input.substring(0, 30) });
        currentSessionId = sessionRes.data.session.id;
        setSessionId(currentSessionId);
      }

      // 2. Save user message to backend
      if (currentSessionId) {
        await chatAPI.sendMessage(currentSessionId, { content: userMsg.content });
      }

      // 3. Get AI Response
      // We pass the conversation history to the AI
      const response = await aiAPI.chat({
        messages: messages.concat(userMsg).map(m => ({ 
          role: m.role, 
          content: m.content 
        }))
      });

      const aiContent = response.data.message.content || response.data.message;
      
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: aiContent 
      }]);

    } catch (error) {
      console.error('Chat failed:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "**Error:** Failed to get response. Please try again." 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-ubiq-950 relative">
      {/* Empty State / Welcome Screen */}
      {messages.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 z-0">
          <div className="w-20 h-20 bg-gradient-to-br from-ubiq-accent to-purple-600 rounded-2xl flex items-center justify-center mb-6 shadow-2xl shadow-ubiq-accent/20">
            <CpuChipIcon className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">
            Good afternoon, {user?.username}
          </h2>
          <p className="text-slate-400 max-w-md">
            I'm your AI engineering companion. I can help you write code, debug issues, or architect new solutions.
          </p>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth z-10">
        <div className="max-w-3xl mx-auto space-y-8">
          {messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* AI Avatar */}
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ubiq-accent to-purple-600 flex-shrink-0 flex items-center justify-center text-xs text-white font-bold shadow-lg shadow-ubiq-accent/20">
                  AI
                </div>
              )}

              {/* Message Bubble */}
              <div 
                className={`max-w-[85%] rounded-2xl px-6 py-4 text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user' 
                    ? 'bg-ubiq-800 text-slate-100 rounded-br-sm' 
                    : 'bg-ubiq-900/50 backdrop-blur-sm text-slate-300 border border-white/5'
                }`}
              >
                <ReactMarkdown 
                  components={{
                    code({node, className, children, ...props}) {
                      return (
                        <code className={`${className} bg-black/30 rounded px-1 py-0.5 text-ubiq-accent font-mono text-xs`} {...props}>
                          {children}
                        </code>
                      )
                    },
                    pre({children}) {
                      return (
                        <pre className="bg-ubiq-950 rounded-lg p-4 my-3 overflow-x-auto border border-ubiq-800 text-slate-300 font-mono text-xs">
                          {children}
                        </pre>
                      )
                    }
                  }}
                >
                    {msg.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}
          
          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex gap-4">
               <div className="w-8 h-8 rounded-full bg-ubiq-800 animate-pulse" />
               <div className="flex items-center gap-1 h-10 px-4">
                 <span className="w-1.5 h-1.5 bg-ubiq-700 rounded-full animate-bounce delay-75"></span>
                 <span className="w-1.5 h-1.5 bg-ubiq-700 rounded-full animate-bounce delay-150"></span>
                 <span className="w-1.5 h-1.5 bg-ubiq-700 rounded-full animate-bounce delay-300"></span>
               </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-6 bg-gradient-to-t from-ubiq-950 via-ubiq-950 to-transparent z-20">
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSendMessage} className="relative group">
            <button 
              type="button"
              onClick={startNewChat}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-white hover:bg-ubiq-800 rounded-lg transition-all"
              title="New Chat"
            >
                <PlusIcon className="w-5 h-5" />
            </button>
            
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your code..."
              className="w-full bg-ubiq-900/80 backdrop-blur-xl border border-ubiq-800 text-slate-200 rounded-2xl pl-14 pr-14 py-4 focus:outline-none focus:border-ubiq-accent/50 focus:ring-1 focus:ring-ubiq-accent/50 transition-all shadow-2xl shadow-black/50"
            />
            
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 bg-ubiq-accent hover:bg-ubiq-accent-hover text-white rounded-xl disabled:opacity-0 disabled:scale-90 transition-all duration-200 shadow-lg shadow-ubiq-accent/25"
            >
              {isLoading ? (
                <StopIcon className="w-5 h-5 animate-pulse" />
              ) : (
                <PaperAirplaneIcon className="w-5 h-5" />
              )}
            </button>
          </form>
          <div className="text-center mt-3 text-xs text-slate-600 font-medium">
            Ubiq AI Agent • v1.0 • Running on Local LLaMA
          </div>
        </div>
      </div>
    </div>
  );
}