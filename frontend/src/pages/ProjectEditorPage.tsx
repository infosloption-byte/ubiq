import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { projectAPI, fileAPI, chatAPI, aiAPI } from '../services/api';
import Layout from '../components/Layout';
import FileTree from '../components/FileTree';
import ChatInterface from '../components/ChatInterface';
import InputDialog from '../components/InputDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import EditorTabs from '../components/EditorTabs';
import SourceControlPanel from '../components/panels/SourceControlPanel';
import { buildFileTree, type FileNode } from '../utils/fileUtils';
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import FilePreview from '../components/FilePreview';
import ProjectRunner from '../components/panels/ProjectRunner';
import TerminalPanel from '../components/panels/TerminalPanel';
import { useAiModeStore } from '../stores/aiModeStore';
import {
    CodeBracketIcon, ChatBubbleLeftRightIcon, XMarkIcon, ArrowPathIcon,
    CheckIcon, NoSymbolIcon, PlusIcon, FolderPlusIcon, MagnifyingGlassIcon,
    CloudArrowUpIcon, EyeIcon, ServerStackIcon, CpuChipIcon, ServerIcon,
    FolderIcon, CommandLineIcon, PlayIcon, ArrowDownOnSquareIcon, Cog6ToothIcon
} from '@heroicons/react/24/outline';

export default function ProjectEditorPage() {
    const { id } = useParams<{ id: string }>();
    const projectId = Number(id);

    const [showSettings, setShowSettings] = useState(false);
    const [localUrl, setLocalUrl] = useState(localStorage.getItem('ubiq_local_url') || 'http://localhost:11434');
    const [remoteUrl, setRemoteUrl] = useState(localStorage.getItem('ubiq_ollama_url') || '');

    const handleSaveSettings = () => {
        if (aiMode === 'remote') localStorage.setItem('ubiq_ollama_url', remoteUrl);
        else localStorage.setItem('ubiq_local_url', localUrl);
        setShowSettings(false);
        alert("Connection URL updated!");
    };

    const [searchParams] = useSearchParams();
    const openFileIdParam = searchParams.get('openFile');

    const [activeSideTab, setActiveSideTab] = useState<'files' | 'git'>('files');
    const [rightPanelContent, setRightPanelContent] = useState<'chat' | 'runner' | null>('chat');
    const [chatWidth, setChatWidth] = useState(400);
    const [isSandboxRunning, setIsSandboxRunning] = useState(false);

    const [project, setProject] = useState<any>(null);
    const [files, setFiles] = useState<any[]>([]);
    const [fileTree, setFileTree] = useState<FileNode[]>([]);
    const [fileSearch, setFileSearch] = useState('');

    // FIX: Added filesLoaded flag to distinguish "API returned empty project" from
    // "API hasn't responded yet". The old approach checked files.length > 0 in the
    // tab-restore effect, which would skip restoration entirely for projects with no files
    // if the effect ran during the brief window before the API responded.
    const [filesLoaded, setFilesLoaded] = useState(false);

    const [openFiles, setOpenFiles] = useState<FileNode[]>([]);
    const [activeFile, setActiveFile] = useState<FileNode | null>(null);
    const [fileContent, setFileContent] = useState('');
    const [proposedContent, setProposedContent] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [chatSessionId, setChatSessionId] = useState<number | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const [autoPrompt, setAutoPrompt] = useState<string | null>(null);

    // FIX: aiMode now comes from the shared Zustand store. Previously it was useState
    // initialized from localStorage, which meant the ChatPage and ProjectEditorPage could
    // drift out of sync within the same session.
    const { aiMode, setAiMode } = useAiModeStore();

    const [createModal, setCreateModal] = useState<{ isOpen: boolean; type: 'file' | 'folder'; parentPath: string }>({ isOpen: false, type: 'file', parentPath: '' });
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; node: FileNode | null }>({ isOpen: false, node: null });
    const [confirmDiscardModal, setConfirmDiscardModal] = useState<{ isOpen: boolean; nextFile: any | null }>({ isOpen: false, nextFile: null });

    const [sidebarWidth, setSidebarWidth] = useState(256);
    const [isResizingSidebar, setIsResizingSidebar] = useState(false);
    const [isResizingChat, setIsResizingChat] = useState(false);
    const [showEditor, setShowEditor] = useState(true);
    const [showPreview, setShowPreview] = useState(false);
    const [showTerminal, setShowTerminal] = useState(false);

    const sidebarRef = useRef<HTMLDivElement>(null);
    const chatRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const debounceRef = useRef<NodeJS.Timeout | null>(null);
    const restoredRef = useRef(false);

    // 1. Initial Load
    useEffect(() => {
        if (projectId) {
            loadProjectData(projectId);
            initializeProjectChat(projectId);
        }
    }, [projectId]);

    // 2. Restore Tabs & Active File — runs once after filesLoaded becomes true.
    // FIX: The old code triggered on `files` array changes and checked `files.length > 0`.
    // That was ambiguous: a project with no files would never trigger restoration, AND a
    // slow API could have the effect run before files arrived. Using a dedicated `filesLoaded`
    // boolean is explicit and correct in all cases.
    useEffect(() => {
        if (!filesLoaded || restoredRef.current) return;
        restoredRef.current = true;

        const savedTabs = localStorage.getItem(`ubiq_tabs_${projectId}`);
        if (savedTabs) {
            try {
                const tabIds: number[] = JSON.parse(savedTabs);
                const uniqueIds = Array.from(new Set(tabIds));
                const restoredFiles: FileNode[] = [];
                uniqueIds.forEach((tid) => {
                    const found = files.find(f => f.id === Number(tid));
                    if (found) {
                        restoredFiles.push({
                            id: String(found.id),
                            name: found.name,
                            path: found.path,
                            type: 'file',
                            fileId: found.id,
                            language: found.language,
                            updatedAt: found.updated_at
                        });
                    }
                });
                if (restoredFiles.length > 0) setOpenFiles(restoredFiles);
            } catch (e) { console.error("Failed to restore tabs", e); }
        }

        const savedActiveId = localStorage.getItem(`ubiq_active_${projectId}`);
        const targetId = openFileIdParam ? Number(openFileIdParam) : (savedActiveId ? Number(savedActiveId) : null);
        if (targetId) {
            const targetFile = files.find(f => f.id === targetId);
            if (targetFile) {
                handleFileSelect({
                    id: String(targetFile.id),
                    name: targetFile.name,
                    path: targetFile.path,
                    type: 'file',
                    fileId: targetFile.id,
                    language: targetFile.language,
                    updatedAt: targetFile.updated_at
                });
            }
        }
    }, [filesLoaded]);

    // 3. Persist Tabs & Active File
    useEffect(() => {
        if (filesLoaded && restoredRef.current) {
            const tabIds = Array.from(new Set(openFiles.map(f => f.fileId).filter(Boolean)));
            localStorage.setItem(`ubiq_tabs_${projectId}`, JSON.stringify(tabIds));
            if (activeFile?.fileId) {
                localStorage.setItem(`ubiq_active_${projectId}`, String(activeFile.fileId));
            }
        }
    }, [openFiles, activeFile, filesLoaded, projectId]);

    // Search Filter
    useEffect(() => {
        if (filesLoaded) {
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
    }, [fileSearch, files, filesLoaded]);

    const refreshFiles = async () => {
        try {
            const res = await fileAPI.getAll(projectId);
            const raw = res.data.files || [];
            setFiles(raw);
            setFileTree(buildFileTree(raw));
        } catch (error) {
            console.error("Failed to refresh file tree:", error);
        }
    };

    const isBinaryFile = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'pdf', 'zip'].includes(ext || '');
    };

    const loadProjectData = async (pid: number) => {
        try {
            const [pRes, fRes] = await Promise.all([projectAPI.get(pid), fileAPI.getAll(pid)]);
            setProject(pRes.data.project);
            const raw = fRes.data.files || [];
            setFiles(raw);
            setFileTree(buildFileTree(raw));
            // FIX: Set filesLoaded AFTER both files and project are set, so the restore
            // effect always sees a complete `files` array.
            setFilesLoaded(true);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const initializeProjectChat = async (pid: number) => {
        try {
            const res = await chatAPI.getSessions({ project_id: pid });
            const sessions = res.data.sessions || [];
            if (sessions.length > 0) {
                setChatSessionId(sessions[0].id);
            } else {
                const newRes = await chatAPI.createSession({ project_id: pid, title: `Workspace Chat` });
                setChatSessionId(newRes.data.session.id);
            }
        } catch (e) { console.error("Failed to init project chat", e); }
    };

    const getLanguageFromFilename = (filename: string) => {
        const ext = filename.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            js: 'javascript', ts: 'typescript', py: 'python', html: 'html',
            css: 'css', php: 'php', java: 'java', go: 'go', sql: 'sql', md: 'markdown'
        };
        return map[ext || ''] || 'plaintext';
    };

    // FIX: Memoized with useMemo. Previously this was a plain function called on every render,
    // which for large projects would concatenate megabytes of file content into a string
    // every single time ChatInterface re-rendered (e.g. every keystroke in the chat input).
    const projectStructureContext = useMemo(() => {
        if (!files || files.length === 0) return "No files in project.";
        const textFiles = files.filter(f =>
            f.size_bytes < 50000 &&
            !f.name.match(/\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/i)
        );
        return textFiles.map(f => `// FILE: ${f.path}\n${f.content || '// (Empty file)'}`).join('\n\n');
    }, [files]);

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
                await fileAPI.create(projectId, { name, path: fullPath, content: '', language: getLanguageFromFilename(name) });
            }
            loadProjectData(projectId);
        } catch (e) { console.error("Create failed", e); }
    };

    const openDeleteModal = (node: FileNode) => { setDeleteModal({ isOpen: true, node }); };

    const submitDelete = async () => {
        const { node } = deleteModal;
        if (!node) return;

        try {
            if (node.type === 'folder') {
                // FIX: Previously called fileAPI.delete(node.fileId || 0).
                // Folder nodes have no fileId (it's undefined), so this was sending
                // DELETE /files/0 — a broken request that either 404s or accidentally
                // matches something. Now uses a dedicated folder-delete endpoint that
                // removes all files under the given path prefix server-side.
                await fileAPI.deleteFolder(projectId, node.path);
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

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const uploadedFiles = e.target.files;
        if (!uploadedFiles || uploadedFiles.length === 0) return;

        setIsUploading(true);
        setUploadProgress(0);

        for (let i = 0; i < uploadedFiles.length; i++) {
            const file = uploadedFiles[i];
            const formData = new FormData();
            formData.append('file', file);

            try {
                // FIX: fileAPI.upload now exists (was missing from api.ts, causing a runtime crash).
                await fileAPI.upload(projectId, formData, (progressEvent: ProgressEvent) => {
                    if (progressEvent.total) {
                        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        const totalProgress = ((i * 100) + percentCompleted) / uploadedFiles.length;
                        setUploadProgress(totalProgress);
                    }
                });
            } catch (err) { console.error(`Failed to upload ${file.name}`, err); }
        }

        setUploadProgress(100);
        setTimeout(() => {
            setIsUploading(false);
            setUploadProgress(0);
            loadProjectData(projectId);
        }, 500);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleFileSelect = async (file: FileNode) => {
        if (!file.fileId) return;

        if (proposedContent !== null && activeFile?.fileId !== file.fileId) {
            setConfirmDiscardModal({ isOpen: true, nextFile: file });
            return;
        }

        setOpenFiles(prev => {
            if (prev.some(f => f.fileId === file.fileId)) return prev;
            return [...prev, file];
        });

        loadFileContent(file);
    };

    const closeTab = (fileId: number) => {
        const newTabs = openFiles.filter(f => f.fileId !== fileId);
        setOpenFiles(newTabs);
        if (activeFile?.fileId === fileId) {
            if (newTabs.length > 0) {
                loadFileContent(newTabs[newTabs.length - 1]);
            } else {
                setActiveFile(null);
                setFileContent('');
                setProposedContent(null);
                localStorage.removeItem(`ubiq_active_${projectId}`);
            }
        }
    };

    const loadFileContent = async (file: FileNode) => {
        if (!file.fileId) return;
        setActiveFile(file);

        if (isBinaryFile(file.name)) { setShowPreview(true); setShowEditor(false); }
        else { setShowPreview(false); setShowEditor(false); }

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
            let content = contentToSave;
            if (content === undefined) {
                content = editorRef.current ? editorRef.current.getValue() : fileContent;
            }
            await fileAPI.update(activeFile.fileId, { content: content });
            setFiles(prevFiles => prevFiles.map(f =>
                f.id === activeFile.fileId ? { ...f, content } : f
            ));
            setFileContent(content || '');
        } catch (e) { console.error("Save failed", e); }
        finally { setIsSaving(false); }
    };

    const handleSaveRef = useRef(handleSave);
    useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

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

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            handleSaveRef.current();
        });

        editor.addAction({
            id: 'ai-explain', label: 'AI: Explain Selection', contextMenuGroupId: 'navigation', contextMenuOrder: 1,
            run: (ed) => {
                const selection = ed.getSelection();
                const text = ed.getModel()?.getValueInRange(selection || undefined);
                if (text) { setRightPanelContent('chat'); setAutoPrompt(`Explain this code:\n\`\`\`${text}\`\`\``); }
                else { alert("Select some code first."); }
            }
        });
        editor.addAction({
            id: 'ai-refactor', label: 'AI: Refactor / Optimize', contextMenuGroupId: 'navigation', contextMenuOrder: 2,
            run: (ed) => {
                const selection = ed.getSelection();
                const text = ed.getModel()?.getValueInRange(selection || undefined);
                if (text) { setRightPanelContent('chat'); setAutoPrompt(`Refactor and optimize this code:\n\`\`\`${text}\`\`\``); }
            }
        });
        editor.addAction({
            id: 'ai-docs', label: 'AI: Generate Documentation', contextMenuGroupId: 'navigation', contextMenuOrder: 3,
            run: (ed) => {
                const selection = ed.getSelection();
                const text = ed.getModel()?.getValueInRange(selection || undefined);
                if (text) { setRightPanelContent('chat'); setAutoPrompt(`Generate documentation comments for this code:\n\`\`\`${text}\`\`\``); }
            }
        });

        if (monaco.languages.registerInlineCompletionItemProvider) {
            monaco.languages.registerInlineCompletionItemProvider({ pattern: '**' }, {
                provideInlineCompletionItems: async (model, position) => {
                    return new Promise((resolve) => {
                        if (debounceRef.current) clearTimeout(debounceRef.current);
                        debounceRef.current = setTimeout(async () => {
                            const text = model.getValueInRange({
                                startLineNumber: 1, startColumn: 1,
                                endLineNumber: position.lineNumber, endColumn: position.column
                            });
                            if (text.length < 5) { resolve({ items: [] }); return; }

                            const storedKeys = localStorage.getItem('ubiq_api_keys');
                            const apiKeys = storedKeys ? JSON.parse(storedKeys) : {};
                            if (aiMode === 'local') {
                                apiKeys['ollama_url'] = localStorage.getItem('ubiq_local_url') || 'http://localhost:11434';
                            } else if (aiMode === 'remote') {
                                const savedRemote = localStorage.getItem('ubiq_ollama_url') || '';
                                if (savedRemote) apiKeys['ollama_url'] = savedRemote;
                            }

                            try {
                                const res = await aiAPI.completion({
                                    code: model.getValue(),
                                    language: model.getLanguageId(),
                                    max_tokens: 50,
                                    api_keys: apiKeys
                                });
                                if (res.data.completion) {
                                    resolve({
                                        items: [{
                                            insertText: res.data.completion,
                                            range: {
                                                startLineNumber: position.lineNumber, startColumn: position.column,
                                                endLineNumber: position.lineNumber, endColumn: position.column
                                            }
                                        }]
                                    });
                                } else { resolve({ items: [] }); }
                            } catch (e) { resolve({ items: [] }); }
                        }, 500);
                    });
                },
                freeInlineCompletion: () => { }
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

    useEffect(() => {
        window.addEventListener("mousemove", resize);
        window.addEventListener("mouseup", stopResizing);
        return () => { window.removeEventListener("mousemove", resize); window.removeEventListener("mouseup", stopResizing); };
    }, [resize, stopResizing]);

    if (loading) return (
        <Layout>
            <div className="flex h-full bg-ubiq-950 overflow-hidden animate-pulse">
                <div className="w-12 bg-ubiq-950 border-r border-white/5 flex flex-col items-center py-4 gap-4 shrink-0">
                    {[...Array(3)].map((_, i) => <div key={i} className="w-6 h-6 rounded bg-ubiq-800" />)}
                </div>
                <div className="w-56 bg-ubiq-900 border-r border-white/5 flex flex-col gap-2 p-3 shrink-0">
                    <div className="h-3 w-20 rounded bg-ubiq-800 mb-2" />
                    {[80, 65, 90, 55, 75].map((w, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded bg-ubiq-800 shrink-0" />
                            <div className="h-2.5 rounded bg-ubiq-800" style={{ width: `${w}%` }} />
                        </div>
                    ))}
                </div>
                <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="h-9 border-b border-white/5 bg-ubiq-950 flex items-center gap-1 px-2">
                        {[100, 80].map((w, i) => <div key={i} className="h-5 rounded bg-ubiq-800" style={{ width: `${w}px` }} />)}
                    </div>
                    <div className="flex-1 p-6 flex flex-col gap-3">
                        {[60, 85, 40, 70, 90, 50, 75, 30, 65, 80, 45, 70].map((w, i) => (
                            <div key={i} className="h-2.5 rounded bg-ubiq-800/60" style={{ width: `${w}%`, marginLeft: i % 3 !== 0 ? '24px' : '0' }} />
                        ))}
                    </div>
                </div>
            </div>
        </Layout>
    );

    return (
        <Layout>
            <div className={`flex h-full bg-ubiq-950 overflow-hidden ${isResizingSidebar || isResizingChat ? 'select-none cursor-col-resize' : ''}`}>

                {/* ACTIVITY BAR */}
                <div className="w-12 bg-ubiq-950 border-r border-white/5 flex flex-col items-center py-4 gap-4 shrink-0 z-20">
                    <ActivityIcon icon={<FolderIcon className="w-5 h-5" />} active={activeSideTab === 'files'} onClick={() => setActiveSideTab('files')} label="Files" />
                    <ActivityIcon icon={<CommandLineIcon className="w-5 h-5" />} active={activeSideTab === 'git'} onClick={() => setActiveSideTab('git')} label="Source Control" />
                </div>

                {/* SIDEBAR */}
                <div ref={sidebarRef} className="bg-ubiq-900 border-r border-white/5 flex flex-col shrink-0 relative transition-none" style={{ width: sidebarWidth }}>

                    {activeSideTab === 'files' ? (
                        <div className="flex flex-col h-full">
                            <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900 shrink-0">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <CodeBracketIcon className="w-4 h-4 text-ubiq-accent shrink-0" />
                                    <span className="font-medium text-slate-300 text-sm truncate">{project?.name}</span>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => fileInputRef.current?.click()} className="p-1 text-slate-400 hover:text-white transition-colors" title="Upload Files"><CloudArrowUpIcon className="w-4 h-4" /></button>
                                    <button onClick={() => openCreateModal('folder')} className="p-1 text-slate-400 hover:text-white transition-colors" title="New Folder"><FolderPlusIcon className="w-4 h-4" /></button>
                                    <button onClick={() => openCreateModal('file')} className="p-1 text-slate-400 hover:text-white transition-colors" title="New File"><PlusIcon className="w-4 h-4" /></button>
                                </div>
                            </div>

                            {isUploading && (
                                <div className="h-1 w-full bg-ubiq-950">
                                    <div className="h-full bg-ubiq-accent transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{ width: `${uploadProgress}%` }} />
                                </div>
                            )}

                            <div className="px-3 py-2 border-b border-white/5">
                                <div className="relative">
                                    <MagnifyingGlassIcon className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-500" />
                                    <input type="text" placeholder="Search..." value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} className="w-full bg-ubiq-950 border border-white/10 rounded-md py-1 pl-8 pr-2 text-xs text-slate-300 focus:outline-none focus:border-ubiq-accent" />
                                </div>
                            </div>

                            <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 shrink-0">
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <FolderIcon className="w-4 h-4 text-ubiq-accent" />
                                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider truncate">{project?.name || 'Project'}</span>
                                </div>
                                <button onClick={refreshFiles} className="p-1.5 text-slate-500 hover:text-white hover:bg-white/10 rounded-md transition-all" title="Refresh File Tree">
                                    <ArrowPathIcon className="w-4 h-4" />
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar bg-ubiq-900">
                                <FileTree nodes={fileTree} onSelectFile={handleFileSelect} onDeleteNode={openDeleteModal} onCreateNode={openCreateModal} selectedFileId={activeFile?.fileId} />
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col h-full w-full">
                            <SourceControlPanel projectId={projectId} />
                        </div>
                    )}

                    <div onMouseDown={(e) => { e.preventDefault(); startResizingSidebar(); }} className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-ubiq-accent/50 z-50 transition-colors" />
                </div>

                <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" multiple />

                {/* CENTER: Editor + Terminal */}
                <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] relative">
                    <div className={`flex-1 flex flex-col min-h-0 transition-all duration-300 ${showTerminal ? 'h-[60%]' : 'h-full'}`}>

                        <EditorTabs files={openFiles} activeFileId={activeFile?.fileId || null} onSelect={handleFileSelect} onClose={closeTab} />

                        <div className="h-12 bg-[#1e1e1e] border-b border-white/5 flex items-center justify-between px-4 shrink-0">
                            {proposedContent !== null ? (
                                <div className="flex items-center gap-3 animate-fade-in">
                                    <span className="text-xs font-bold text-amber-400 uppercase">Diff View</span>
                                    <button onClick={handleAcceptDiff} disabled={!showEditor || isSaving} className="text-green-400 text-xs flex gap-1 items-center hover:text-green-300">
                                        <CheckIcon className="w-3.5 h-3.5" /> Accept
                                    </button>
                                    <button onClick={handleRejectDiff} disabled={!showEditor || isSaving} className="text-red-400 text-xs flex gap-1 items-center hover:text-red-300">
                                        <NoSymbolIcon className="w-3.5 h-3.5" /> Reject
                                    </button>
                                </div>
                            ) : (
                                <span className="text-xs text-slate-400 font-mono truncate">{activeFile ? activeFile.path : 'No file selected'}</span>
                            )}

                            <div className="flex items-center gap-2">
                                {activeFile && (
                                    <button
                                        onClick={() => setShowPreview(!showPreview)}
                                        className={`p-1.5 transition-colors flex items-center gap-2 text-xs rounded-md ${showPreview ? 'bg-ubiq-accent text-white' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}
                                    >
                                        {showPreview ? <CodeBracketIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                                        <span className="hidden md:inline">{showPreview ? 'Code' : 'Preview'}</span>
                                    </button>
                                )}

                                <button
                                    onClick={() => handleSave()}
                                    disabled={isSaving}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors border ${isSaving ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' : 'border-white/10 text-slate-300 bg-white/5 hover:bg-white/10 hover:text-white hover:border-white/20'}`}
                                >
                                    {isSaving ? <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownOnSquareIcon className="w-3.5 h-3.5" />}
                                    <span className="text-xs font-medium">{isSaving ? 'Saving...' : 'Save'}</span>
                                </button>

                                <div className="w-px h-4 bg-white/10 mx-1"></div>

                                <div className="flex bg-black/30 rounded-lg p-0.5 ml-2 border border-white/5">
                                    <button onClick={() => setShowTerminal(!showTerminal)} className={`p-1.5 transition-colors flex items-center gap-2 text-xs rounded-md ${showTerminal ? 'bg-white/10 text-white' : 'text-slate-500 hover:text-white'}`} title="Toggle Terminal">
                                        <CommandLineIcon className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setRightPanelContent(rightPanelContent === 'runner' ? null : 'runner')} className={`p-1.5 rounded-md transition-colors ${rightPanelContent === 'runner' ? 'bg-emerald-600/20 text-emerald-400' : 'text-slate-500 hover:text-white'}`} title="Run Project">
                                        <PlayIcon className="w-5 h-5" />
                                    </button>
                                    <button onClick={() => setRightPanelContent(rightPanelContent === 'chat' ? null : 'chat')} className={`p-1.5 rounded-md transition-colors ${rightPanelContent === 'chat' ? 'bg-ubiq-accent/20 text-ubiq-accent' : 'text-slate-500 hover:text-white'}`} title="AI Chat">
                                        <ChatBubbleLeftRightIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 relative overflow-hidden">
                            {!showEditor ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e]">
                                    <div className="w-5 h-5 border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" />
                                </div>
                            ) : activeFile ? (
                                showPreview ? (
                                    <FilePreview file={activeFile} content={fileContent} projectId={projectId} allFiles={files} />
                                ) : proposedContent !== null ? (
                                    <DiffEditor key={`diff-${activeFile.fileId}`} height="100%" theme="vs-dark" original={fileContent} modified={proposedContent} language={getLanguageFromFilename(activeFile.name)} options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true, readOnly: true }} />
                                ) : (
                                    <Editor key={`editor-${activeFile.fileId}`} height="100%" theme="vs-dark" value={fileContent} onChange={(v) => setFileContent(v || '')} onMount={handleEditorMount} language={getLanguageFromFilename(activeFile.name)} options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true, inlineSuggest: { enabled: true } }} />
                                )
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600 bg-[#1e1e1e]">
                                    <CodeBracketIcon className="w-16 h-16 mb-4 opacity-20" />
                                    <p className="text-sm">Select a file</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {showTerminal && (
                        <div className="h-[40%] shrink-0 border-t border-white/10 animate-slide-up bg-[#0c0c0c]">
                            <TerminalPanel projectId={projectId} isContainerRunning={isSandboxRunning} />
                        </div>
                    )}
                </div>

                {/* RIGHT PANEL */}
                {rightPanelContent && (
                    <div ref={chatRef} className="bg-ubiq-950 flex flex-col shrink-0 border-l border-white/5 transition-none relative" style={{ width: chatWidth }}>
                        <div onMouseDown={(e) => { e.preventDefault(); startResizingChat(); }} className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-ubiq-accent/50 z-50 -ml-0.5 transition-colors" />

                        {rightPanelContent === 'chat' ? (
                            <>
                                <div className="h-12 flex items-center justify-between px-4 border-b border-white/5 bg-ubiq-900/50 shrink-0">
                                    <span className="text-sm font-medium text-slate-200">AI Assistant</span>
                                    <div className="flex items-center gap-2">
                                        {/* FIX: Buttons now call setAiMode('...') directly.
                                            Previously they called handleAiModeChange({ target: { value: '...' } } as any)
                                            — a fake HTMLSelectElement event to work around the old localStorage approach. */}
                                        <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5">
                                            <button onClick={() => setAiMode('cloud')} className={`px-2.5 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 transition-all ${aiMode === 'cloud' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                                                <ServerStackIcon className="w-3 h-3" /> Cloud
                                            </button>
                                            <button onClick={() => setAiMode('local')} className={`px-2.5 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 transition-all ${aiMode === 'local' ? 'bg-emerald-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                                                <CpuChipIcon className="w-3 h-3" /> Local
                                            </button>
                                            <button onClick={() => setAiMode('remote')} className={`px-2.5 py-1 rounded-md text-[10px] font-medium flex items-center gap-1 transition-all ${aiMode === 'remote' ? 'bg-amber-600 text-white shadow' : 'text-slate-500 hover:text-slate-300'}`}>
                                                <ServerIcon className="w-3 h-3" /> Remote
                                            </button>
                                        </div>

                                        {(aiMode === 'local' || aiMode === 'remote') && (
                                            <button onClick={() => setShowSettings(!showSettings)} className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'text-white bg-white/10' : 'text-slate-500 hover:text-white hover:bg-white/5'}`}>
                                                <Cog6ToothIcon className="w-3.5 h-3.5" />
                                            </button>
                                        )}

                                        <button onClick={() => setRightPanelContent(null)} className="text-slate-500 hover:text-white">
                                            <XMarkIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>

                                {showSettings && aiMode !== 'cloud' && (
                                    <div className="absolute top-12 left-0 right-0 bg-ubiq-900 border-b border-white/10 p-4 z-50 shadow-xl animate-slide-down">
                                        <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                                            {aiMode === 'remote' ? 'Remote Server URL' : 'Local Ollama URL'}
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={aiMode === 'remote' ? remoteUrl : localUrl}
                                                onChange={(e) => aiMode === 'remote' ? setRemoteUrl(e.target.value) : setLocalUrl(e.target.value)}
                                                placeholder={aiMode === 'remote' ? 'http://54.123.x.x:11434' : 'http://localhost:11434'}
                                                className="flex-1 bg-black/50 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:border-ubiq-accent outline-none font-mono"
                                            />
                                            <button onClick={handleSaveSettings} className="bg-ubiq-accent px-3 py-1 text-xs text-white rounded hover:bg-indigo-500">Save</button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 mt-2">
                                            {aiMode === 'remote'
                                                ? 'Your EC2 / Azure Ollama server public URL.'
                                                : 'Local Ollama endpoint. Default: http://localhost:11434'}
                                        </p>
                                    </div>
                                )}

                                <div className="flex-1 overflow-hidden relative">
                                    {chatSessionId ? (
                                        <ChatInterface
                                            sessionId={chatSessionId}
                                            activeContext={{ projectStructure: projectStructureContext, currentFile: activeFile ? { name: activeFile.name, content: fileContent } : undefined }}
                                            onApplyCode={handleApplyCode}
                                            autoPrompt={autoPrompt}
                                            onAutoPromptClear={() => setAutoPrompt(null)}
                                            aiMode={aiMode}
                                        />
                                    ) : null}
                                </div>
                            </>
                        ) : (
                            <ProjectRunner projectId={projectId} onClose={() => setRightPanelContent(null)} onContainerStateChange={setIsSandboxRunning} />
                        )}
                    </div>
                )}

                <InputDialog isOpen={createModal.isOpen} onClose={() => setCreateModal(p => ({ ...p, isOpen: false }))} onSubmit={submitCreate} title={`New ${createModal.type === 'folder' ? 'Folder' : 'File'}`} message={`Enter name for new ${createModal.type} inside '${createModal.parentPath || 'root'}':`} placeholder={createModal.type === 'folder' ? "components" : "App.tsx"} />
                <ConfirmDialog isOpen={deleteModal.isOpen} onClose={() => setDeleteModal({ isOpen: false, node: null })} onConfirm={submitDelete} title="Delete Item?" message={`Are you sure you want to delete '${deleteModal.node?.name}'? This action cannot be undone.`} confirmText="Delete" isDestructive={true} />
                <ConfirmDialog isOpen={confirmDiscardModal.isOpen} onClose={() => setConfirmDiscardModal({ isOpen: false, nextFile: null })} onConfirm={() => { setProposedContent(null); handleFileSelect(confirmDiscardModal.nextFile); }} title="Discard Changes?" message="You have unsaved AI changes. Switching files will discard them." confirmText="Discard Changes" isDestructive={true} />
            </div>
        </Layout>
    );
}

const ActivityIcon = ({ icon, active, onClick, label }: { icon: React.ReactNode; active: boolean; onClick: () => void; label: string }) => (
    <button onClick={onClick} className={`p-2.5 rounded-lg transition-all group relative ${active ? 'bg-ubiq-accent text-white shadow-lg shadow-ubiq-accent/20' : 'text-slate-500 hover:text-white hover:bg-white/5'}`} title={label}>
        {icon}
        <span className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 bg-black text-white text-[10px] rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity z-50">{label}</span>
    </button>
);