import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import ChatInterface from '../components/ChatInterface';
import { chatAPI } from '../services/api';

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
      
      // Select first session if available
      if (response.data.sessions && response.data.sessions.length > 0) {
        setCurrentSession(response.data.sessions[0].id);
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewSession = async () => {
    try {
      const response = await chatAPI.createSession({
        title: newSessionTitle || 'New Chat',
      });

      await loadSessions();
      setCurrentSession(response.data.session.id);
      setShowNewSessionDialog(false);
      setNewSessionTitle('');
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const handleDeleteSession = async (sessionId: number) => {
    if (!confirm('Are you sure you want to delete this chat session?')) return;

    try {
      await chatAPI.deleteSession(sessionId);
      await loadSessions();
      
      if (currentSession === sessionId) {
        setCurrentSession(sessions.length > 1 ? sessions[0].id : null);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-slate-400">Loading chat...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="h-full flex">
        {/* Sidebar - Chat Sessions */}
        <div className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <h2 className="text-white font-semibold text-lg mb-3">Chat Sessions</h2>
            <button
              onClick={() => setShowNewSessionDialog(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
            >
              + New Chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="text-slate-500 text-sm text-center py-8 px-4">
                No chat sessions yet. Create one to get started!
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative rounded transition-colors ${
                      currentSession === session.id
                        ? 'bg-blue-600'
                        : 'hover:bg-slate-700'
                    }`}
                  >
                    <button
                      onClick={() => setCurrentSession(session.id)}
                      className="w-full text-left px-3 py-3 text-sm"
                    >
                      <div className={`font-medium mb-1 truncate ${
                        currentSession === session.id ? 'text-white' : 'text-slate-300'
                      }`}>
                        {session.title}
                      </div>
                      <div className={`text-xs truncate ${
                        currentSession === session.id ? 'text-blue-100' : 'text-slate-500'
                      }`}>
                        {new Date(session.created_at).toLocaleDateString()}
                      </div>
                    </button>
                    
                    <button
                      onClick={() => handleDeleteSession(session.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-1"
                      title="Delete session"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Main Chat Area */}
        <div className="flex-1">
          {currentSession ? (
            <ChatInterface sessionId={currentSession} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-6xl mb-4">💬</div>
                <h3 className="text-xl font-semibold text-white mb-2">
                  No chat session selected
                </h3>
                <p className="text-slate-400 mb-4">
                  Create a new chat or select an existing one from the sidebar
                </p>
                <button
                  onClick={() => setShowNewSessionDialog(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
                >
                  Start New Chat
                </button>
              </div>
            </div>
          )}
        </div>

        {/* New Session Dialog */}
        {showNewSessionDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md border border-slate-700">
              <h3 className="text-white text-xl font-semibold mb-4">New Chat Session</h3>
              
              <div className="mb-4">
                <label className="block text-slate-300 text-sm mb-2">
                  Session Title (Optional)
                </label>
                <input
                  type="text"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  placeholder="e.g., Python Help, React Questions..."
                  className="w-full bg-slate-700 text-white px-3 py-2 rounded border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => setShowNewSessionDialog(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewSession}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded font-medium transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}