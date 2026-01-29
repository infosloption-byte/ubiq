import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import ChatInterface from '../components/ChatInterface';
import ModelSelector from '../components/ModelSelector'; // Added Import
import { chatAPI } from '../services/api';
import { 
  PlusIcon, 
  ChatBubbleLeftIcon, 
  TrashIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';

interface ChatSession {
  id: number;
  title: string;
  model_used: string;
  created_at: string;
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await chatAPI.getSessions();
      setSessions(response.data.sessions || []);
      
      if (response.data.sessions?.length > 0 && !currentSession) {
        setCurrentSession(response.data.sessions[0].id);
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewSession = async () => {
    if (!newSessionTitle.trim()) return;
    
    try {
      const response = await chatAPI.createSession({
        title: newSessionTitle,
      });

      await loadSessions();
      setCurrentSession(response.data.session.id);
      setShowNewSessionDialog(false);
      setNewSessionTitle('');
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    if (!confirm('Delete this chat history?')) return;

    try {
      await chatAPI.deleteSession(sessionId);
      const updatedSessions = sessions.filter(s => s.id !== sessionId);
      setSessions(updatedSessions);
      
      if (currentSession === sessionId) {
        setCurrentSession(updatedSessions.length > 0 ? updatedSessions[0].id : null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      loadSessions();
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full bg-ubiq-950">
          <div className="flex flex-col items-center gap-4">
             <div className="w-10 h-10 border-2 border-ubiq-accent border-t-transparent rounded-full animate-spin" />
             <p className="text-slate-500 text-sm font-medium tracking-wide">INITIALIZING...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="h-full flex flex-col md:flex-row overflow-hidden bg-ubiq-950">
        {/* Matte Sidebar - Chat Sessions */}
        <div className="w-full md:w-72 bg-ubiq-900 border-r border-white/5 flex flex-col shrink-0">
          <div className="p-5 border-b border-white/5">
            <h2 className="text-slate-400 font-medium text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
               <ChatBubbleLeftRightIcon className="w-4 h-4 text-ubiq-accent" />
               Conversation History
            </h2>
            <button
              onClick={() => setShowNewSessionDialog(true)}
              className="btn-primary w-full shadow-lg shadow-purple-500/20"
            >
              <PlusIcon className="w-4 h-4" /> New Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
            {sessions.length === 0 ? (
              <div className="text-slate-600 text-xs text-center py-12 border border-dashed border-ubiq-800 rounded-xl m-2">
                No history yet.<br/>Start your first chat!
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => setCurrentSession(session.id)}
                  className={`group flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-all border ${
                    currentSession === session.id
                      ? 'bg-ubiq-800 border-white/5 text-white shadow-md'
                      : 'bg-transparent border-transparent text-slate-400 hover:bg-ubiq-800/50 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <ChatBubbleLeftIcon className={`w-4 h-4 shrink-0 transition-colors ${
                      currentSession === session.id ? 'text-ubiq-accent' : 'text-slate-600 group-hover:text-slate-400'
                    }`} />
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-sm truncate font-medium">
                        {session.title}
                      </span>
                      <span className="text-[10px] opacity-60 truncate">
                        {new Date(session.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="p-1.5 rounded-lg text-slate-600 hover:bg-red-500/10 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Delete session"
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-ubiq-950 relative">
          
          {/* Header Bar with Model Selector (Added) */}
          <div className="h-16 shrink-0 border-b border-white/5 flex items-center justify-between px-6 bg-ubiq-950/80 backdrop-blur-md z-10 sticky top-0">
             <div className="flex items-center gap-3">
               <span className="text-slate-200 font-medium truncate max-w-xs md:max-w-md">
                  {currentSession 
                    ? sessions.find(s => s.id === currentSession)?.title 
                    : 'New Conversation'}
               </span>
             </div>
             
             {/* Integrated Model Selector */}
             <ModelSelector />
          </div>

          <div className="flex-1 overflow-hidden relative">
            {currentSession ? (
              <ChatInterface sessionId={currentSession} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-ubiq-950">
                <div className="w-24 h-24 bg-gradient-to-tr from-indigo-500/10 via-purple-500/10 to-pink-500/10 rounded-full flex items-center justify-center mb-8 backdrop-blur-xl border border-white/5 shadow-2xl animate-pulse">
                   <SparklesIcon className="w-10 h-10 text-ubiq-accent opacity-80" />
                </div>
                
                <h3 className="text-3xl font-bold text-white mb-3 tracking-tight">
                  How can I help you?
                </h3>
                <p className="text-slate-500 max-w-sm mb-10 leading-relaxed">
                  I can help you write code, debug issues, or explain complex programming concepts.
                </p>
                
                <button
                  onClick={() => setShowNewSessionDialog(true)}
                  className="btn-primary px-8 py-3 text-sm shadow-xl shadow-indigo-500/20"
                >
                  Start New Conversation
                </button>
              </div>
            )}
          </div>
        </div>

        {/* New Session Dialog */}
        {showNewSessionDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50">
            <div className="glass-panel p-6 rounded-2xl w-full max-w-sm shadow-2xl transform transition-all scale-100">
              <h3 className="text-white text-lg font-semibold mb-4 flex items-center gap-2">
                <PlusIcon className="w-5 h-5 text-ubiq-accent" />
                New Chat
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 ml-1 uppercase tracking-wide">Topic</label>
                  <input
                    type="text"
                    value={newSessionTitle}
                    onChange={(e) => setNewSessionTitle(e.target.value)}
                    placeholder="e.g. React Component Debugging"
                    className="input-primary w-full mt-2"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && handleNewSession()}
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowNewSessionDialog(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:bg-white/5 transition-colors text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleNewSession}
                    className="flex-1 btn-primary text-sm"
                  >
                    Create Chat
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}