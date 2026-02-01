import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { projectAPI, fileAPI, chatAPI, aiAPI } from '../services/api';
import axios from 'axios';
import Layout from '../components/Layout';
import FileTree from '../components/FileTree';
import ChatInterface from '../components/ChatInterface';
import InputDialog from '../components/InputDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import EditorTabs from '../components/EditorTabs';
import { buildFileTree, type FileNode } from '../utils/fileUtils';
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { 
  CodeBracketIcon, ChatBubbleLeftRightIcon, XMarkIcon, ArrowPathIcon, 
  CheckIcon, NoSymbolIcon, PlusIcon, FolderPlusIcon, MagnifyingGlassIcon 
} from '@heroicons/react/24/outline';

export default function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);

  // --- Data State ---
  const [project, setProject] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  
  // --- Tabbed Editing State ---
  const [openFiles, setOpenFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<FileNode | null>(null);
  
  const [fileContent, setFileContent] = useState('');
  const [proposedContent, setProposedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [chatSessionId, setChatSessionId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // --- Auto Prompt State ---
  const [autoPrompt, setAutoPrompt] = useState<string | null>(null);

  // --- Modal State ---
  const [createModal, setCreateModal] = useState<{ isOpen: boolean; type: 'file' | 'folder'; parentPath: string }>({ isOpen: false, type: 'file', parentPath: '' });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; node: FileNode | null }>({ isOpen: false, node: null });
  const [confirmDiscardModal, setConfirmDiscardModal] = useState<{ isOpen: boolean; nextFile: any | null }>({ isOpen: false, nextFile: null });

  // --- Layout State ---
  const [showChat, setShowChat] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [chatWidth, setChatWidth] = useState(400);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingChat, setIsResizingChat] = useState(false);
  const [showEditor, setShowEditor] = useState(true);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (projectId) { loadProjectData(projectId); initializeProjectChat(projectId); }
  }, [projectId]);

  useEffect(() => {
      if (files.length > 0) {
          if (!fileSearch.trim()) {
              setFileTree(buildFileTree(files));
          } else {
              const filtered = files.filter(f => 
                  f.name.toLowerCase().includes(fileSearch.toLowerCase()) || 
                  f.path.toLowerCase().includes(fileSearch.toLowerCase())
              );
              setFileTree(buildFileTree(filtered));
          }
      }
  }, [fileSearch, files]);

  const loadProjectData = async (pid: number) => {
    try {
      const [pRes, fRes] = await Promise.all([projectAPI.get(pid), fileAPI.getAll(pid)]);
      setProject(pRes.data.project);
      const raw = fRes.data.files || [];
      setFiles(raw);
      setFileTree(buildFileTree(raw));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const initializeProjectChat = async (pid: number) => {
      try {
          const res = await chatAPI.getSessions();
          const sessions = res.data.sessions || [];
          const existingSession = sessions.find((s: any) => s.project_id === pid);
          if (existingSession) setChatSessionId(existingSession.id);
          else {
              const newRes = await chatAPI.createSession({ project_id: pid, title: `Workspace Chat` });
              setChatSessionId(newRes.data.session.id);
          }
      } catch (e) {}
  };

  const getLanguageFromFilename = (filename: string) => {
      const ext = filename.split('.').pop()?.toLowerCase();
      const map: any = { js: 'javascript', ts: 'typescript', py: 'python', html: 'html', css: 'css', php: 'php', java: 'java', go: 'go', sql: 'sql', md: 'markdown' };
      return map[ext || ''] || 'plaintext';
  };

  // --- MEGA-PROMPT GENERATOR ---
  const getProjectStructureContext = () => {
      if (!files || files.length === 0) return "No files in project.";
      
      const textFiles = files.filter(f => 
          f.size_bytes < 50000 && 
          !f.name.match(/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i)
      );

      return textFiles.map(f => `
// =======================================================
// FILE: ${f.path}
// =======================================================
${f.content || '// (Empty file)'}
`).join('\n\n');
  };

  // --- Actions ---
  const openCreateModal = (type: 'file' | 'folder', parentPath: string = '') => {
      setCreateModal({ isOpen: true, type, parentPath });
  };

  const submitCreate = async (name: string) => {
      setCreateModal(prev => ({ ...prev, isOpen: false })); 
      const { type, parentPath } = createModal;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;

      try {
          if (type === 'folder') {
              await fileAPI.create(projectId, { name: '.gitkeep', path: `${fullPath}/.gitkeep`, content: '', language: 'text' });
          } else {
              await fileAPI.create(projectId, { name: name, path: fullPath, content: '', language: getLanguageFromFilename(name) });
          }
          loadProjectData(projectId);
      } catch (e) { console.error("Create failed", e); }
  };

  const openDeleteModal = (node: FileNode) => {
      setDeleteModal({ isOpen: true, node });
  };

  const submitDelete = async () => {
      const { node } = deleteModal;
      if (!node) return;
      
      try {
          if (node.type === 'folder') {
              let token = localStorage.getItem('token');
              if (!token) {
                  const authStorage = localStorage.getItem('auth-storage');
                  if (authStorage) token = JSON.parse(authStorage).state?.token;
              }
              await axios.delete(`http://localhost:8000/api/v1/projects/${projectId}/files/path`, {
                  data: { path: node.path },
                  headers: { Authorization: `Bearer ${token}` }
              });
          } else if (node.fileId) {
              await fileAPI.delete(node.fileId);
          }

          if (node.fileId) closeTab(node.fileId);
          if (activeFile && (activeFile.fileId === node.fileId || (activeFile.path && activeFile.path.startsWith(node.path + '/')))) {
              setActiveFile(null);
              setFileContent('');
              setProposedContent(null);
          }
          loadProjectData(projectId);
      } catch (e) { console.error("Delete failed", e); }
  };

  const handleFileSelect = async (file: FileNode) => {
    if (!file.fileId) return; 
    if (proposedContent !== null) {
        setConfirmDiscardModal({ isOpen: true, nextFile: file });
        return;
    }
    if (!openFiles.find(f => f.fileId === file.fileId)) {
        setOpenFiles(prev => [...prev, file]);
    }
    loadFileContent(file);
  };

  const closeTab = (fileId: number) => {
      setOpenFiles(prev => prev.filter(f => f.fileId !== fileId));
      if (activeFile?.fileId === fileId) {
          const remaining = openFiles.filter(f => f.fileId !== fileId);
          if (remaining.length > 0) {
              loadFileContent(remaining[remaining.length - 1]);
          } else {
              setActiveFile(null);
              setFileContent('');
              setProposedContent(null);
          }
      }
  };

  const loadFileContent = async (file: FileNode) => {
      if (!file.fileId) return;
      setActiveFile(file);
      setShowEditor(false); 
      try {
          const res = await fileAPI.get(file.fileId);
          setFileContent(res.data.file.content || '');
      } catch (e) { console.error(e); } 
      finally { setTimeout(() => setShowEditor(true), 50); }
  };

  const handleSave = async (contentToSave?: string) => {
      if (!activeFile?.fileId) return;
      setIsSaving(true);
      try {
          const content = contentToSave !== undefined ? contentToSave : fileContent;
          await fileAPI.update(activeFile.fileId, { content: content });
      } catch (e) { console.error("Save failed", e); } 
      finally { setIsSaving(false); }
  };

  const handleApplyCode = (newCode: string) => {
      if (!activeFile) { alert("Please open a file."); return; }
      setProposedContent(newCode);
  };

  const handleAcceptDiff = async () => {
      if (proposedContent !== null) {
          const newContent = proposedContent;
          setShowEditor(false);
          if (activeFile) await handleSave(newContent);
          setTimeout(() => { setFileContent(newContent); setProposedContent(null); setShowEditor(true); }, 100); 
      }
  };

  const handleRejectDiff = () => {
      setShowEditor(false);
      setTimeout(() => { setProposedContent(null); setShowEditor(true); }, 100);
  };

  // --- Context Menu Actions ---
  const handleEditorMount: OnMount = (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { handleSave(); });

      // Action 1: Explain
      editor.addAction({
          id: 'ai-explain',
          label: 'AI: Explain Selection',
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 1,
          run: (ed) => {
              const selection = ed.getSelection();
              const text = ed.getModel()?.getValueInRange(selection || undefined);
              if (text) {
                  setShowChat(true); 
                  setAutoPrompt(`Explain this code:\n\`\`\`${text}\`\`\``);
              } else { alert("Select some code first."); }
          }
      });

      // Action 2: Refactor
      editor.addAction({
          id: 'ai-refactor',
          label: 'AI: Refactor / Optimize',
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 2,
          run: (ed) => {
              const selection = ed.getSelection();
              const text = ed.getModel()?.getValueInRange(selection || undefined);
              if (text) {
                  setShowChat(true); 
                  setAutoPrompt(`Refactor and optimize this code:\n\`\`\`${text}\`\`\``);
              }
          }
      });

      // Action 3: Generate Docs
      editor.addAction({
          id: 'ai-docs',
          label: 'AI: Generate Documentation',
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 3,
          run: (ed) => {
              const selection = ed.getSelection();
              const text = ed.getModel()?.getValueInRange(selection || undefined);
              if (text) {
                  setShowChat(true); 
                  setAutoPrompt(`Generate documentation comments for this code:\n\`\`\`${text}\`\`\``);
              }
          }
      });
      
      if (monaco.languages.registerInlineCompletionItemProvider) {
          monaco.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
              provideInlineCompletionItems: async (model, position) => {
                  return new Promise((resolve) => {
                      if (debounceRef.current) clearTimeout(debounceRef.current);
                      debounceRef.current = setTimeout(async () => {
                          const text = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
                          if (text.length < 5) { resolve({ items: [] }); return; }
                          try {
                              const res = await aiAPI.completion({ code: model.getValue(), language: model.getLanguageId(), max_tokens: 50 });
                              if (res.data.completion) resolve({ items: [{ insertText: res.data.completion, range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } }] });
                              else resolve({ items: [] });
                          } catch (e) { resolve({ items: [] }); }
                      }, 500); 
                  });
              },
              freeInlineCompletion: () => {}
          });
      }
  };

  const startResizingSidebar = useCallback(() => setIsResizingSidebar(true), []);
  const startResizingChat = useCallback(() => setIsResizingChat(true), []);
  const stopResizing = useCallback(() => { setIsResizingSidebar(false); setIsResizingChat(false); }, []);
  const resize = useCallback((e: MouseEvent) => {
      if (isResizingSidebar) { const w = e.clientX - 64; if (w > 150 && w < 600) setSidebarWidth(w); }
      if (isResizingChat) { const w = window.innerWidth - e.clientX; if (w > 300 && w < 800) setChatWidth(w); }
  }, [isResizingSidebar, isResizingChat]);
  useEffect(() => { window.addEventListener("mousemove", resize); window.addEventListener("mouseup", stopResizing); return () => { window.removeEventListener("mousemove", resize); window.removeEventListener("mouseup", stopResizing); }; }, [resize, stopResizing]);

  if (loading) return <Layout><div className="flex h-full items-center justify-center text-slate-500">Loading Workspace...</div></Layout>;

  return (
    <Layout>
      <div className={`flex h-full bg-ubiq-950 overflow-hidden ${isResizingSidebar || isResizingChat ? 'select-none cursor-col-resize' : ''}`}>
        
        {/* LEFT PANEL */}
        <div ref={sidebarRef} className="bg-ubiq-900 border-r border-white/5 flex flex-col shrink-0 relative transition-none" style={{ width: sidebarWidth }}>
           <div className="flex flex-col h-full">
               <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900 shrink-0">
                  <div className="flex items-center gap-2 overflow-hidden"><CodeBracketIcon className="w-4 h-4 text-ubiq-accent shrink-0" /><span className="font-medium text-slate-300 text-sm truncate">{project?.name}</span></div>
                  <div className="flex gap-1">
                      <button onClick={() => openCreateModal('folder')} className="p-1 text-slate-400 hover:text-white transition-colors"><FolderPlusIcon className="w-4 h-4" /></button>
                      <button onClick={() => openCreateModal('file')} className="p-1 text-slate-400 hover:text-white transition-colors"><PlusIcon className="w-4 h-4" /></button>
                  </div>
               </div>
               <div className="px-3 py-2 border-b border-white/5">
                   <div className="relative">
                       <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
                       <input type="text" placeholder="Search..." value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} className="w-full bg-ubiq-950 border border-white/10 rounded-md py-1 pl-8 pr-2 text-xs text-slate-300 focus:outline-none focus:border-ubiq-accent" />
                   </div>
               </div>
               <div className="flex-1 overflow-y-auto p-2 custom-scrollbar bg-ubiq-900">
                  <FileTree nodes={fileTree} onSelectFile={handleFileSelect} onDeleteNode={openDeleteModal} onCreateNode={openCreateModal} selectedFileId={activeFile?.fileId} />
               </div>
           </div>
           <div onMouseDown={(e) => { e.preventDefault(); startResizingSidebar(); }} className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-ubiq-accent/50 z-50 transition-colors" />
        </div>

        {/* CENTER PANEL */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] relative">
           <EditorTabs files={openFiles} activeFileId={activeFile?.fileId || null} onSelect={handleFileSelect} onClose={closeTab} />
           <div className="h-12 bg-[#1e1e1e] border-b border-white/5 flex items-center justify-between px-4 shrink-0">
              {proposedContent !== null ? (
                  <div className="flex items-center gap-3 animate-fade-in"><span className="text-xs font-bold text-amber-400 uppercase">Diff View</span><button onClick={handleAcceptDiff} disabled={!showEditor || isSaving} className="text-green-400 text-xs flex gap-1"><CheckIcon className="w-3.5 h-3.5"/> Accept</button><button onClick={handleRejectDiff} disabled={!showEditor || isSaving} className="text-red-400 text-xs flex gap-1"><NoSymbolIcon className="w-3.5 h-3.5"/> Reject</button></div>
              ) : (
                  <span className="text-xs text-slate-400 font-mono truncate">{activeFile ? activeFile.path : 'No file selected'}</span>
              )}
              <div className="flex items-center gap-2">
                 <button onClick={() => handleSave()} className="p-1.5 hover:text-white text-slate-500"><ArrowPathIcon className={`w-4 h-4 ${isSaving?'animate-spin':''}`} /></button>
                 <button onClick={() => setShowChat(!showChat)} className="p-1.5 hover:text-white text-slate-500"><ChatBubbleLeftRightIcon className="w-5 h-5" /></button>
              </div>
           </div>
           <div className="flex-1 relative overflow-hidden">
              {!showEditor ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]"><div className="w-5 h-5 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" /></div>
              ) : activeFile ? (
                 proposedContent !== null ? (
                     <DiffEditor key={`diff-${activeFile.fileId}`} height="100%" theme="vs-dark" original={fileContent} modified={proposedContent} language={getLanguageFromFilename(activeFile.name)} options={{ minimap: {enabled:false}, fontSize: 14, automaticLayout: true, readOnly: true }} />
                 ) : (
                     <Editor key={`editor-${activeFile.fileId}`} height="100%" theme="vs-dark" value={fileContent} onChange={(v) => setFileContent(v||'')} onMount={handleEditorMount} language={getLanguageFromFilename(activeFile.name)} options={{ minimap: {enabled:false}, fontSize: 14, automaticLayout: true, inlineSuggest: { enabled: true } }} />
                 )
              ) : (
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 bg-[#1e1e1e]"><CodeBracketIcon className="w-16 h-16 mb-4 opacity-20" /><p className="text-sm">Select a file</p></div>
              )}
           </div>
        </div>

        {/* RIGHT PANEL (Chat) */}
        {showChat && (
           <div ref={chatRef} className="bg-ubiq-950 flex flex-col shrink-0 border-l border-white/5 transition-none relative" style={{ width: chatWidth }}>
              <div onMouseDown={(e) => { e.preventDefault(); startResizingChat(); }} className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-ubiq-accent/50 z-50 -ml-0.5 transition-colors" />
              <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900/50 shrink-0">
                 <span className="text-sm font-medium text-slate-200">AI Assistant</span>
                 <button onClick={() => setShowChat(false)} className="text-slate-500 hover:text-white"><XMarkIcon className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-hidden relative">
                 {chatSessionId ? (
                     <ChatInterface 
                        sessionId={chatSessionId} 
                        // FIX: Always Pass Project Structure
                        activeContext={{
                            projectStructure: getProjectStructureContext(),
                            // Only include currentFile if activeFile exists
                            currentFile: activeFile ? { name: activeFile.name, content: fileContent } : undefined
                        }}
                        onApplyCode={handleApplyCode} 
                        autoPrompt={autoPrompt}
                        onAutoPromptClear={() => setAutoPrompt(null)}
                     />
                 ) : null}
              </div>
           </div>
        )}

        {/* MODALS */}
        <InputDialog isOpen={createModal.isOpen} onClose={() => setCreateModal(p => ({...p, isOpen: false}))} onSubmit={submitCreate} title={`New ${createModal.type === 'folder' ? 'Folder' : 'File'}`} message={`Enter name for new ${createModal.type} inside '${createModal.parentPath || 'root'}':`} placeholder={createModal.type === 'folder' ? "components" : "App.tsx"} />
        <ConfirmDialog isOpen={deleteModal.isOpen} onClose={() => setDeleteModal({ isOpen: false, node: null })} onConfirm={submitDelete} title="Delete Item?" message={`Are you sure you want to delete '${deleteModal.node?.name}'? This action cannot be undone.`} confirmText="Delete" isDestructive={true} />
        <ConfirmDialog isOpen={confirmDiscardModal.isOpen} onClose={() => setConfirmDiscardModal({ isOpen: false, nextFile: null })} onConfirm={() => { setProposedContent(null); handleFileSelect(confirmDiscardModal.nextFile); }} title="Discard Changes?" message="You have unsaved changes from the AI. Switching files will discard them." confirmText="Discard Changes" isDestructive={true} />
      </div>
    </Layout>
  );
}