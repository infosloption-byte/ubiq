import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { projectAPI, fileAPI, chatAPI } from '../services/api';
import Layout from '../components/Layout';
import FileTree from '../components/FileTree';
import ChatInterface from '../components/ChatInterface';
// Ensure 'type' is used for OnMount to avoid Vite build errors
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { 
  CodeBracketIcon, 
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  ArrowPathIcon,
  CheckIcon,
  NoSymbolIcon
} from '@heroicons/react/24/outline';

export default function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);

  // --- Data State ---
  const [project, setProject] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [activeFile, setActiveFile] = useState<any>(null);
  
  const [fileContent, setFileContent] = useState('');
  const [proposedContent, setProposedContent] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [chatSessionId, setChatSessionId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // --- Layout State ---
  const [showChat, setShowChat] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingChat, setIsResizingChat] = useState(false);

  // --- FIX: Transition State to prevent Monaco crash ---
  // This forces the editor to unmount completely before switching modes
  const [isEditorTransitioning, setIsEditorTransitioning] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);

  // --- Initialization ---
  useEffect(() => {
    if (projectId) {
        loadProjectData(projectId);
        initializeProjectChat(projectId);
    }
  }, [projectId]);

  const loadProjectData = async (pid: number) => {
    try {
      const [pRes, fRes] = await Promise.all([
        projectAPI.get(pid),
        fileAPI.getAll(pid)
      ]);
      setProject(pRes.data.project);
      setFiles(fRes.data.files || []);
    } catch (error) {
      console.error("Failed to load project:", error);
    } finally {
      setLoading(false);
    }
  };

  const initializeProjectChat = async (pid: number) => {
      try {
          const res = await chatAPI.getSessions();
          const sessions = res.data.sessions || [];
          const existingSession = sessions.find((s: any) => s.project_id === pid);
          if (existingSession) {
              setChatSessionId(existingSession.id);
          } else {
              const newRes = await chatAPI.createSession({ project_id: pid, title: `Workspace Chat` });
              setChatSessionId(newRes.data.session.id);
          }
      } catch (error) { console.error("Failed to init chat:", error); }
  };

  const getLanguageFromFilename = (filename: string) => {
      const ext = filename.split('.').pop()?.toLowerCase();
      const map: any = { js: 'javascript', ts: 'typescript', py: 'python', html: 'html', css: 'css', php: 'php', java: 'java', go: 'go', sql: 'sql', md: 'markdown' };
      return map[ext || ''] || 'plaintext';
  };

  // --- File Actions ---
  const handleFileSelect = async (file: any) => {
    if (proposedContent !== null) {
        if (!confirm("You have unsaved changes from AI. Discard them?")) return;
        setProposedContent(null);
    }
    setActiveFile(file);
    
    // Smooth transition when switching files
    setIsEditorTransitioning(true);
    
    try {
        const res = await fileAPI.get(file.id);
        setFileContent(res.data.file.content || '');
    } catch (e) {
        console.error("Failed to load file content", e);
    } finally {
        setTimeout(() => setIsEditorTransitioning(false), 50);
    }
  };

  const handleSave = async () => {
      if (!activeFile) return;
      setIsSaving(true);
      try {
          await fileAPI.update(activeFile.id, { content: fileContent });
      } catch (e) {
          console.error("Save failed", e);
      } finally {
          setIsSaving(false);
      }
  };

  const handleApplyCode = (newCode: string) => {
      if (!activeFile) {
          alert("Please open a file to apply code.");
          return;
      }
      // Switch to Diff View
      setProposedContent(newCode);
  };

  // --- FIX: Robust Unmount-Update-Remount Pattern ---
  const handleAcceptDiff = () => {
      if (proposedContent !== null) {
          const newContent = proposedContent;
          
          // 1. Force Unmount (removes DiffEditor from DOM)
          setIsEditorTransitioning(true);

          // 2. Wait for disposal to complete (100ms is safe)
          setTimeout(() => {
              setFileContent(newContent);
              setProposedContent(null); // Clear diff state
              
              // 3. Remount (adds Standard Editor to DOM)
              setIsEditorTransitioning(false);
          }, 100); 
      }
  };

  const handleRejectDiff = () => {
      // Same safe transition for Reject
      setIsEditorTransitioning(true);
      setTimeout(() => {
          setProposedContent(null);
          setIsEditorTransitioning(false);
      }, 100);
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          handleSave();
      });
  };

  // --- Resizing Logic ---
  const startResizingSidebar = useCallback(() => setIsResizingSidebar(true), []);
  const startResizingChat = useCallback(() => setIsResizingChat(true), []);
  const stopResizing = useCallback(() => { setIsResizingSidebar(false); setIsResizingChat(false); }, []);
  const resize = useCallback((e: MouseEvent) => {
      if (isResizingSidebar) {
          const w = e.clientX - 64; 
          if (w > 150 && w < 600) setSidebarWidth(w);
      }
      if (isResizingChat) {
          const w = window.innerWidth - e.clientX;
          if (w > 300 && w < 800) setChatWidth(w);
      }
  }, [isResizingSidebar, isResizingChat]);

  useEffect(() => {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
      return () => { window.removeEventListener("mousemove", resize); window.removeEventListener("mouseup", stopResizing); };
  }, [resize, stopResizing]);

  if (loading) return <Layout><div className="flex h-full items-center justify-center text-slate-500">Loading...</div></Layout>;

  return (
    <Layout>
      <div className={`flex h-full bg-ubiq-950 overflow-hidden ${isResizingSidebar || isResizingChat ? 'select-none cursor-col-resize' : ''}`}>
        
        {/* LEFT: File Explorer */}
        <div ref={sidebarRef} className="bg-ubiq-900 border-r border-white/5 flex flex-col shrink-0 relative transition-none" style={{ width: sidebarWidth }}>
           <div className="h-12 flex items-center px-4 border-b border-white/5 font-medium text-slate-300 text-sm truncate bg-ubiq-900">
              <CodeBracketIcon className="w-4 h-4 mr-2 text-ubiq-accent shrink-0" />
              <span className="truncate">{project?.name || 'Project'}</span>
           </div>
           <div className="flex-1 overflow-y-auto p-2 custom-scrollbar bg-ubiq-900">
              <FileTree files={files} onSelectFile={handleFileSelect} selectedFileId={activeFile?.id} />
           </div>
           <div onMouseDown={startResizingSidebar} className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-ubiq-accent/50 active:bg-ubiq-accent transition-colors z-10" />
        </div>

        {/* CENTER: Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] relative">
           
           {/* Header */}
           <div className="h-12 bg-[#1e1e1e] border-b border-white/5 flex items-center justify-between px-4 shrink-0">
              {proposedContent !== null ? (
                  <div className="flex items-center gap-3 animate-fade-in">
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wide flex items-center gap-2">
                          Diff View
                      </span>
                      <div className="h-4 w-px bg-white/10 mx-1" />
                      <button 
                          onClick={handleAcceptDiff}
                          disabled={isEditorTransitioning}
                          className="flex items-center gap-1.5 px-3 py-1 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                          <CheckIcon className="w-3.5 h-3.5" /> Accept
                      </button>
                      <button 
                          onClick={handleRejectDiff}
                          disabled={isEditorTransitioning}
                          className="flex items-center gap-1.5 px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                          <NoSymbolIcon className="w-3.5 h-3.5" /> Reject
                      </button>
                  </div>
              ) : (
                  <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 font-mono truncate">
                         {activeFile ? activeFile.path : 'No file selected'}
                      </span>
                      {isSaving && <span className="text-[10px] text-slate-500 animate-pulse">Saving...</span>}
                  </div>
              )}
              
              <div className="flex items-center gap-2">
                 {proposedContent === null && (
                     <button onClick={handleSave} className="p-1.5 hover:text-white text-slate-500 transition-colors" title="Save (Ctrl+S)">
                        <ArrowPathIcon className={`w-4 h-4 ${isSaving ? 'animate-spin' : ''}`} />
                     </button>
                 )}
                 <button onClick={() => setShowChat(!showChat)} className={`p-1.5 rounded-lg transition-colors ${showChat ? 'bg-ubiq-accent/20 text-ubiq-accent' : 'text-slate-500 hover:text-white'}`} title="Toggle AI Chat">
                    <ChatBubbleLeftRightIcon className="w-5 h-5" />
                 </button>
              </div>
           </div>

           {/* Editor / Diff Area (Guarded by Transition State) */}
           <div className="flex-1 relative overflow-hidden">
              {/* FIX: If transitioning, show loader. If not, show editors. */}
              {isEditorTransitioning ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]">
                      <div className="w-5 h-5 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                  </div>
              ) : (
                  activeFile ? (
                     proposedContent !== null ? (
                         <DiffEditor
                            key="diff-editor" 
                            height="100%"
                            theme="vs-dark"
                            language={getLanguageFromFilename(activeFile.name)}
                            original={fileContent}
                            modified={proposedContent}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                wordWrap: 'on',
                                automaticLayout: true,
                                readOnly: true,
                                renderSideBySide: true,
                                padding: { top: 16 }
                            }}
                         />
                     ) : (
                         <Editor
                            key="standard-editor" 
                            height="100%"
                            theme="vs-dark"
                            language={getLanguageFromFilename(activeFile.name)}
                            value={fileContent}
                            onChange={(value) => setFileContent(value || '')}
                            onMount={handleEditorMount}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 14,
                                wordWrap: 'on',
                                automaticLayout: true,
                                padding: { top: 16 },
                                smoothScrolling: true,
                            }}
                         />
                     )
                  ) : (
                     <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 bg-[#1e1e1e]">
                        <CodeBracketIcon className="w-16 h-16 mb-4 opacity-20" />
                        <p className="text-sm">Select a file to start editing</p>
                        <p className="text-xs opacity-50 mt-2">Use Ctrl+S to save changes</p>
                     </div>
                  )
              )}
           </div>
        </div>

        {/* RIGHT: AI Chat */}
        {showChat && (
           <div ref={chatRef} className="bg-ubiq-950 flex flex-col shrink-0 relative border-l border-white/5 transition-none" style={{ width: chatWidth }}>
              <div onMouseDown={startResizingChat} className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-ubiq-accent/50 active:bg-ubiq-accent transition-colors z-10 -ml-0.5" />
              <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900/50 shrink-0">
                 <span className="text-sm font-medium text-slate-200">AI Assistant</span>
                 <button onClick={() => setShowChat(false)} className="text-slate-500 hover:text-white"><XMarkIcon className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-hidden relative">
                 {chatSessionId ? (
                     <ChatInterface 
                        sessionId={chatSessionId}
                        activeContext={activeFile ? { fileName: activeFile.name, fileContent: fileContent } : null}
                        onApplyCode={handleApplyCode}
                     />
                 ) : (
                     <div className="flex items-center justify-center h-full text-slate-500 text-xs">Initializing Chat...</div>
                 )}
              </div>
           </div>
        )}

      </div>
    </Layout>
  );
}