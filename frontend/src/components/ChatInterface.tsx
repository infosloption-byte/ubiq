import { useState, useRef, useEffect } from 'react';
import { aiAPI, chatAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

interface ChatInterfaceProps {
  sessionId?: number;
}

export default function ChatInterface({ sessionId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const { user } = useAuthStore();

  useEffect(() => {
    if (sessionId) {
      loadMessages();
    }
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = async () => {
    if (!sessionId) return;

    try {
      const response = await chatAPI.getMessages(sessionId);
      const loadedMessages = response.data.messages.map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at),
      }));
      setMessages(loadedMessages);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { 
      role: 'user', 
      content: input,
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError('');

    try {
      // If we have a session ID, save to backend
      if (sessionId) {
        await chatAPI.sendMessage(sessionId, { content: userMessage.content });
      }

      // Get AI response
      const response = await aiAPI.chat({
        messages: [...messages, userMessage].map(m => ({
          role: m.role,
          content: m.content,
        })),
      });

      const assistantMessage: Message = {
        role: 'assistant',
        content: response.data.message.content || response.data.message,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: any) {
      console.error('Chat failed:', err);
      
      let errorMessage = 'Sorry, I encountered an error. Please try again.';
      
      if (err.response?.status === 429) {
        errorMessage = 'Rate limit exceeded. Please wait a moment before sending more messages.';
      } else if (err.response?.status === 401) {
        errorMessage = 'Your session has expired. Please refresh the page.';
      }
      
      setError(errorMessage);
      
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: errorMessage,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    if (confirm('Are you sure you want to clear this chat?')) {
      setMessages([]);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatTimestamp = (date?: Date) => {
    if (!date) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-white font-semibold text-lg">AI Coding Assistant</h2>
          <p className="text-slate-400 text-sm">Ask me anything about coding, debugging, or best practices</p>
        </div>
        <button
          onClick={clearChat}
          className="text-slate-400 hover:text-white transition-colors px-3 py-1.5 rounded hover:bg-slate-700"
          title="Clear chat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && !isLoading && (
          <div className="text-center text-slate-500 mt-20">
            <div className="text-7xl mb-6">💬</div>
            <h3 className="text-2xl font-semibold text-white mb-3">
              Hi! I'm your AI coding assistant.
            </h3>
            <p className="text-lg mb-6">
              I can help you with:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto text-left">
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                <div className="text-2xl mb-2">💻</div>
                <div className="font-medium text-white mb-1">Code Generation</div>
                <div className="text-sm text-slate-400">Write functions, classes, and algorithms</div>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                <div className="text-2xl mb-2">🐛</div>
                <div className="font-medium text-white mb-1">Debugging Help</div>
                <div className="text-sm text-slate-400">Find and fix errors in your code</div>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                <div className="text-2xl mb-2">📚</div>
                <div className="font-medium text-white mb-1">Code Explanation</div>
                <div className="text-sm text-slate-400">Understand complex code snippets</div>
              </div>
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                <div className="text-2xl mb-2">✨</div>
                <div className="font-medium text-white mb-1">Best Practices</div>
                <div className="text-sm text-slate-400">Learn coding patterns and tips</div>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[85%] rounded-lg p-4 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-100 border border-slate-700'
              }`}
            >
              {/* Message Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <div className={`text-xs font-semibold uppercase ${
                    msg.role === 'user' ? 'text-blue-100' : 'text-slate-400'
                  }`}>
                    {msg.role === 'user' ? 'You' : 'AI Assistant'}
                  </div>
                  {msg.timestamp && (
                    <div className={`text-xs ${
                      msg.role === 'user' ? 'text-blue-200' : 'text-slate-500'
                    }`}>
                      {formatTimestamp(msg.timestamp)}
                    </div>
                  )}
                </div>
                {msg.role === 'assistant' && (
                  <button
                    onClick={() => copyToClipboard(msg.content)}
                    className="text-slate-400 hover:text-white transition-colors"
                    title="Copy to clipboard"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Message Content */}
              <div className="prose prose-invert max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {msg.content}
                </pre>
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 max-w-[85%]">
              <div className="flex items-center space-x-2 mb-2">
                <div className="text-xs font-semibold uppercase text-slate-400">AI Assistant</div>
                <div className="text-xs text-slate-500">typing...</div>
              </div>
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-500/10 border border-red-500 text-red-500 rounded-lg p-4 max-w-md">
              {error}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-slate-700 p-6 bg-slate-800">
        <div className="flex space-x-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about coding... (Shift+Enter for new line)"
            className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none border border-slate-600 placeholder-slate-400"
            rows={3}
            disabled={isLoading}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-8 py-3 rounded-lg font-medium transition-colors self-end flex items-center space-x-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Thinking...</span>
              </>
            ) : (
              <>
                <span>Send</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </>
            )}
          </button>
        </div>
        
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-slate-500">
            Press <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to send, 
            <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300 ml-1">Shift+Enter</kbd> for new line
          </p>
          <div className="text-xs text-slate-500">
            Model: <span className="text-slate-400 font-medium">
              {user?.preferences?.preferred_model || 'codellama:7b'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}