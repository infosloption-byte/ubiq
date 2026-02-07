import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; // Hooks for URL Sync
import Layout from '../components/Layout';
import ChatInterface from '../components/ChatInterface';
import ConfirmDialog from '../components/ConfirmDialog';
import { chatAPI } from '../services/api';
import { 
  PlusIcon, 
  ChatBubbleLeftIcon, 
  TrashIcon,
  ChatBubbleLeftRightIcon,
  SparklesIcon,
  XMarkIcon,
  ClockIcon,
  PencilSquareIcon
} from '@heroicons/react/24/outline';

interface ChatSession {
  id: number;
  title: string;
  model_used: string;
  created_at: string;
}

export default function ChatPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>(); // Read URL param

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMobileHistory, setShowMobileHistory] = useState(false);
  
  // Title Editing State
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; sessionId: number | null }>({ 
    isOpen: false, 
    sessionId: null 
  });

  // 1. Initial Load
  useEffect(() => {
    loadSessions();
  }, []);

  // 2. Sync URL ID to State
  useEffect(() => {
    if (sessionId) {
        const id = Number(sessionId);
        if (!isNaN(id)) {
            setCurrentSession(id);
        }
    } else {
        setCurrentSession(null);
    }
  }, [sessionId]);

  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [isEditingTitle]);

  const loadSessions = async () => {
    try {
      // Calls getSessions without params -> Backend returns only Global chats (project_id=NULL)
      const response = await chatAPI.getSessions(); 
      setSessions(response.data.sessions || []);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewSession = async () => {
    try {
      // Create Global Chat (no project_id)
      const response = await chatAPI.createSession({ title: "New Chat" });
      await loadSessions();
      // Navigate to new URL
      navigate(`/chat/${response.data.session.id}`);
      setShowMobileHistory(false);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    setDeleteModal({ isOpen: true, sessionId });
  };

  const confirmDelete = async () => {
    const { sessionId: idToDelete } = deleteModal;
    if (!idToDelete) return;

    try {
      await chatAPI.deleteSession(idToDelete);
      const updated = sessions.filter(s => s.id !== idToDelete);
      setSessions(updated);
      
      // If deleting active session, redirect appropriately
      if (currentSession === idToDelete) {
          if (updated.length > 0) {
              navigate(`/chat/${updated[0].id}`);
          } else {
              navigate('/chat');
          }
      }
    } catch (error) {
      console.error('Failed to delete:', error);
    } finally {
      setDeleteModal({ isOpen: false, sessionId: null });
    }
  };

  const selectSession = (id: number) => {
    // Just navigate, the useEffect will handle state update
    navigate(`/chat/${id}`);
    setShowMobileHistory(false);
    setIsEditingTitle(false);
  };

  // --- TITLE EDITING ---
  const startEditing = () => {
    const session = sessions.find(s => s.id === currentSession);
    if (session) {
      setEditedTitle(session.title);
      setIsEditingTitle(true);
    }
  };

  const saveTitle = async () => {
    if (!editedTitle.trim() || !currentSession) {
      setIsEditingTitle(false);
      return;
    }
    setSessions(prev => prev.map(s => s.id === currentSession ? { ...s, title: editedTitle } : s));
    setIsEditingTitle(false);
    try {
      await chatAPI.updateSession(currentSession, { title: editedTitle });
    } catch (error) {
      console.error('Failed to update title:', error);
      loadSessions(); 
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') saveTitle();
    if (e.key === 'Escape') setIsEditingTitle(false);
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full bg-ubiq-950">
          <div className="w-10 h-10 border-2 border-ubiq-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  const activeSessionTitle = sessions.find(s => s.id === currentSession)?.title;

  return (
    <Layout>
      <div className="h-full flex flex-col md:flex-row overflow-hidden bg-ubiq-950 relative">
        
        {/* Mobile History Backdrop */}
        {showMobileHistory && (
          <div 
            className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm animate-fade-in"
            onClick={() => setShowMobileHistory(false)}
          />
        )}

        {/* Sidebar - History */}
        <div className={`
            fixed inset-y-0 left-0 z-40 w-72 bg-ubiq-900 border-r border-white/5 flex flex-col shrink-0 transform transition-transform duration-300 ease-out
            md:static md:translate-x-0
            ${showMobileHistory ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <div className="p-5 border-b border-white/5 flex items-center justify-between pt-20 md:pt-5">
            <h2 className="text-slate-400 font-medium text-xs uppercase tracking-wider flex items-center gap-2">
               <ChatBubbleLeftRightIcon className="w-4 h-4 text-ubiq-accent" />
               History
            </h2>
            <div className="flex gap-2">
                <button
                  onClick={handleNewSession}
                  className="p-1.5 rounded-lg bg-ubiq-accent/10 text-ubiq-accent hover:bg-ubiq-accent hover:text-white transition-all shadow-sm"
                  title="New Chat"
                >
                  <PlusIcon className="w-4 h-4" />
                </button>
                <button onClick={() => setShowMobileHistory(false)} className="md:hidden p-1.5 text-slate-500 hover:text-white">
                  <XMarkIcon className="w-5 h-5" />
                </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {sessions.length === 0 ? (
              <div className="text-slate-600 text-xs text-center py-12 border border-dashed border-ubiq-800 rounded-xl m-2">
                No history yet.<br/>Start your first chat!
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => selectSession(session.id)}
                  className={`group flex items-center justify-between px-3 py-3 rounded-xl cursor-pointer transition-all border ${
                    currentSession === session.id
                      ? 'bg-white/5 border-white/5 text-white shadow-sm'
                      : 'bg-transparent border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <ChatBubbleLeftIcon className={`w-4 h-4 shrink-0 transition-colors ${
                      currentSession === session.id ? 'text-ubiq-accent' : 'text-slate-600 group-hover:text-slate-400'
                    }`} />
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-sm truncate font-medium">{session.title}</span>
                      <span className="text-[10px] opacity-50 truncate">{new Date(session.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => handleDeleteClick(e, session.id)} 
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                    title="Delete Chat"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-ubiq-950 relative h-full">
          
          {currentSession && (
            <div className="absolute top-0 left-0 right-0 h-14 md:h-16 z-30 flex items-center justify-between px-4 md:px-6 pointer-events-none">
               <div className="absolute inset-0 bg-gradient-to-b from-ubiq-950/95 via-ubiq-950/70 to-transparent backdrop-blur-[1px]"></div>
               
               <div className="relative flex items-center gap-3 w-full pointer-events-auto">
                 <button onClick={() => setShowMobileHistory(true)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white">
                   <ClockIcon className="w-5 h-5" />
                 </button>

                 <div className="flex-1 min-w-0 flex items-center gap-2 group">
                    {isEditingTitle ? (
                        <input 
                            ref={titleInputRef}
                            type="text" 
                            value={editedTitle}
                            onChange={(e) => setEditedTitle(e.target.value)}
                            onBlur={saveTitle}
                            onKeyDown={handleTitleKeyDown}
                            className="bg-ubiq-900 border border-ubiq-accent/50 text-white text-xs md:text-sm font-medium px-2 py-1 rounded-md w-full max-w-md focus:outline-none focus:ring-1 focus:ring-ubiq-accent shadow-lg"
                        />
                    ) : (
                        <button onClick={startEditing} className="text-slate-300/90 font-medium text-xs md:text-sm tracking-wide truncate hover:text-white hover:bg-white/5 px-2 py-1 rounded-md transition-all flex items-center gap-2" title="Click to rename">
                            {activeSessionTitle}
                            <PencilSquareIcon className="w-3 h-3 opacity-0 group-hover:opacity-50" />
                        </button>
                    )}
                 </div>
               </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden relative h-full">
            {currentSession ? (
              <div className="h-full pt-14 md:pt-6">
                 {/* Pass loadSessions to allow auto-title to refresh the sidebar */}
                 <ChatInterface 
                   sessionId={currentSession} 
                   onSessionUpdate={loadSessions} 
                 />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-ubiq-950">
                <div className="w-20 h-20 bg-ubiq-accent/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
                   <SparklesIcon className="w-10 h-10 text-ubiq-accent" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">How can I help you?</h3>
                <button onClick={handleNewSession} className="btn-primary mt-6">
                  Start New Chat
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Custom Delete Confirmation Modal */}
        <ConfirmDialog 
            isOpen={deleteModal.isOpen} 
            onClose={() => setDeleteModal({ isOpen: false, sessionId: null })} 
            onConfirm={confirmDelete}
            title="Delete Chat?"
            message="Are you sure you want to delete this conversation? This action cannot be undone."
            confirmText="Delete"
            isDestructive={true}
        />
      </div>
    </Layout>
  );
}