import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { projectAPI, fileAPI, getAuthToken } from '../services/api';
import axios from 'axios';
import Layout from '../components/Layout';
import ConfirmDialog from '../components/ConfirmDialog';
import EditProjectDialog from '../components/EditProjectDialog';
import { 
  FolderIcon, DocumentTextIcon, ArrowDownTrayIcon, CloudArrowUpIcon, 
  CodeBracketIcon, ChevronRightIcon, ClockIcon, ArrowLeftIcon, 
  TrashIcon, PencilSquareIcon, ArrowDownOnSquareIcon, EyeIcon, 
  XMarkIcon, ArrowPathIcon 
} from '@heroicons/react/24/outline';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

// Helper to format bytes
const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export default function ProjectInfoPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [project, setProject] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any | null>(null);

  // --- NEW: Delete State ---
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'compressing' | 'downloading'>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    loadData();
  }, [id]);

  const [editModalOpen, setEditModalOpen] = useState(false);

  const loadData = async () => {
    try {
      const [pRes, fRes] = await Promise.all([
          projectAPI.get(Number(id)), 
          fileAPI.getAll(Number(id)) 
      ]);
      setProject(pRes.data.project);
      setFiles(fRes.data.files || []);
    } catch (e) {
      console.error(e);
      // Optional: Redirect if project not found
      // navigate('/dashboard'); 
    } finally {
      setLoading(false);
    }
  };

  const totalFiles = files.length;
  const totalSize = files.reduce((acc, file) => acc + (file.size_bytes || 0), 0);
  const languages = files.reduce((acc: any, file) => {
      const lang = file.language || 'text';
      acc[lang] = (acc[lang] || 0) + 1;
      return acc;
  }, {});
  const topLanguage = Object.keys(languages).sort((a, b) => languages[b] - languages[a])[0] || 'Mixed';

  // --- BROWSER LOGIC ---
  const browserItems = (() => {
      if (selectedFile) return []; 
      const items: any[] = [];
      const processedFolders = new Set();

      files.forEach(file => {
          const path = file.path.replace(/\\/g, '/');
          if (path.startsWith(currentPath ? currentPath + '/' : '')) {
              const relativePath = currentPath ? path.slice(currentPath.length + 1) : path;
              const parts = relativePath.split('/');
              const itemName = parts[0];
              const isFolder = parts.length > 1;

              if (isFolder) {
                  if (!processedFolders.has(itemName)) {
                      items.push({ name: itemName, type: 'folder', path: currentPath ? `${currentPath}/${itemName}` : itemName });
                      processedFolders.add(itemName);
                  }
              } else {
                  items.push({ ...file, name: itemName, type: 'file' });
              }
          }
      });
      return items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
  })();

  // --- ACTIONS ---
  const handleProjectDownload = async () => {
      try {
          const token = getAuthToken();
          
          if (!token) {
              alert("You must be logged in to download.");
              return;
          }

          // 1. Set status to Compressing (Waiting for server)
          setDownloadStatus('compressing');
          setDownloadProgress(0);

          const response = await axios.get(`${import.meta.env.VITE_API_URL}/projects/${id}/download`, {
              headers: { Authorization: `Bearer ${token}` },
              responseType: 'blob',
              onDownloadProgress: (progressEvent) => {
                  // 2. Once bytes start arriving, switch to Downloading
                  if (downloadStatus !== 'downloading') {
                      setDownloadStatus('downloading');
                  }
                  
                  if (progressEvent.total) {
                      const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                      setDownloadProgress(percentCompleted);
                  }
              }
          });

          // 3. Handle File Save
          const url = window.URL.createObjectURL(new Blob([response.data]));
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `${project.name}.zip`);
          document.body.appendChild(link);
          link.click();
          
          // Cleanup
          window.URL.revokeObjectURL(url);
          document.body.removeChild(link);
          
      } catch (e) {
          console.error("Download failed", e);
          alert("Failed to download project.");
      } finally {
          // Reset after a short delay so user sees 100%
          setTimeout(() => {
              setDownloadStatus('idle');
              setDownloadProgress(0);
          }, 1000);
      }
  };

  const handleFileDownload = (file: any) => {
      const blob = new Blob([file.content || ''], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const uploadFiles = e.target.files;
      if (!uploadFiles || uploadFiles.length === 0) return;

      setUploading(true);
      
      // FIX: Check 'auth_token' first
      const token = getAuthToken();

      for (let i = 0; i < uploadFiles.length; i++) {
          const file = uploadFiles[i];
          const formData = new FormData();
          formData.append('file', file);
          if (currentPath) formData.append('parent_path', currentPath);

          try {
              await axios.post(`${import.meta.env.VITE_API_URL}/projects/${id}/files/upload`, formData, {
                  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
              });
          } catch (e) { console.error(`Failed ${file.name}`, e); }
      }
      
      setUploading(false);
      loadData(); 
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- NEW: DELETE HANDLER ---
  const handleDeleteProject = async () => {
      if (!project) return;
      setIsDeleting(true);
      try {
          await projectAPI.delete(project.id);
          // Navigate back to dashboard after successful deletion
          navigate('/dashboard');
      } catch (error) {
          console.error("Failed to delete project:", error);
          alert("Failed to delete project. Please try again.");
          setIsDeleting(false);
          setDeleteModalOpen(false);
      }
  };

  const navigateToPath = (path: string) => {
      setSelectedFile(null); 
      setCurrentPath(path);
  };

  if (loading) return <Layout><div className="text-center py-20 text-slate-500">Loading Project...</div></Layout>;

  return (
    <Layout>
      <div className="h-full overflow-y-auto custom-scrollbar">
        <div className="max-w-7xl mx-auto p-8 space-y-8 pb-20">
            
            {/* HEADER */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                        <Link to="/dashboard" className="hover:text-ubiq-accent flex items-center gap-1"><ArrowLeftIcon className="w-3 h-3" /> Dashboard</Link>
                        <span>/</span>
                        <span>Project Info</span>
                    </div>
                    <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                        {project?.name}
                        <span className="text-xs px-2 py-1 rounded bg-ubiq-800 text-slate-400 font-normal border border-white/10">{project?.visibility}</span>
                    </h1>
                    <p className="text-slate-400 mt-2 max-w-2xl">{project?.description || "No description provided."}</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={() => navigate(`/editor/${id}`)} className="btn-primary shadow-lg shadow-ubiq-accent/20 px-6 py-2.5 flex items-center gap-2">
                        <CodeBracketIcon className="w-5 h-5" /> Open Editor
                    </button>
                </div>
            </div>

            {/* INSIGHTS */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="glass-panel p-5 rounded-xl flex items-center justify-between">
                    <div><p className="text-slate-500 text-xs uppercase mb-1">Total Files</p><p className="text-2xl font-bold text-white">{totalFiles}</p></div>
                    <DocumentTextIcon className="w-8 h-8 text-blue-500/50" />
                </div>
                <div className="glass-panel p-5 rounded-xl flex items-center justify-between">
                    <div><p className="text-slate-500 text-xs uppercase mb-1">Project Size</p><p className="text-2xl font-bold text-white">{formatBytes(totalSize)}</p></div>
                    <CloudArrowUpIcon className="w-8 h-8 text-purple-500/50" />
                </div>
                <div className="glass-panel p-5 rounded-xl flex items-center justify-between">
                    <div><p className="text-slate-500 text-xs uppercase mb-1">Primary Lang</p><p className="text-2xl font-bold text-white capitalize">{topLanguage}</p></div>
                    <CodeBracketIcon className="w-8 h-8 text-emerald-500/50" />
                </div>
                <div className="glass-panel p-5 rounded-xl flex items-center justify-between">
                    <div><p className="text-slate-500 text-xs uppercase mb-1">Last Updated</p><p className="text-sm font-bold text-white">{new Date(project?.updated_at).toLocaleDateString()}</p></div>
                    <ClockIcon className="w-8 h-8 text-orange-500/50" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* LEFT: CONTENT AREA */}
                <div className="lg:col-span-2 space-y-4">
                    
                    {/* Navigation Bar */}
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-white">
                            {selectedFile ? 'File Preview' : 'Source Code'}
                        </h2>
                        
                        <div className="text-sm text-slate-400 flex items-center gap-1 bg-ubiq-900 px-3 py-1 rounded-lg border border-white/5">
                            <button onClick={() => navigateToPath('')} className={`hover:text-white ${currentPath === '' && !selectedFile ? 'text-white font-bold' : ''}`}>root</button>
                            
                            {currentPath.split('/').filter(Boolean).map((part, idx, arr) => (
                                <span key={idx} className="flex items-center gap-1">
                                    <ChevronRightIcon className="w-3 h-3" />
                                    <button onClick={() => navigateToPath(arr.slice(0, idx + 1).join('/'))} className="hover:text-white">{part}</button>
                                </span>
                            ))}

                            {selectedFile && (
                                <span className="flex items-center gap-1">
                                    <ChevronRightIcon className="w-3 h-3" />
                                    <span className="text-white font-bold">{selectedFile.name}</span>
                                </span>
                            )}
                        </div>
                    </div>

                    {/* MAIN CONTENT BOX */}
                    <div className="glass-panel rounded-xl overflow-hidden border border-white/5 flex flex-col min-h-[400px] max-h-[600px]">
                        
                        {selectedFile ? (
                            // --- IN-PAGE VIEWER ---
                            <div className="flex flex-col h-full overflow-auto">
                                <div className="bg-ubiq-900 border-b border-white/5 px-4 py-3 flex items-center justify-between shrink-0">
                                    <div className="flex items-center gap-3">
                                        <DocumentTextIcon className="w-5 h-5 text-ubiq-accent" />
                                        <div>
                                            <p className="text-white font-mono text-sm font-medium">{selectedFile.name}</p>
                                            <p className="text-xs text-slate-500">{formatBytes(selectedFile.size_bytes)} • {selectedFile.language}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => handleFileDownload(selectedFile)} className="px-3 py-1.5 rounded-lg bg-ubiq-950 border border-white/10 hover:border-white/30 text-xs text-slate-300 hover:text-white flex items-center gap-1.5 transition-all">
                                            <ArrowDownTrayIcon className="w-3.5 h-3.5" /> Download
                                        </button>
                                        <button onClick={() => navigate(`/editor/${id}?openFile=${selectedFile.id}`)} className="px-3 py-1.5 rounded-lg bg-ubiq-accent/10 border border-ubiq-accent/20 hover:bg-ubiq-accent/20 text-xs text-ubiq-accent hover:text-white flex items-center gap-1.5 transition-all">
                                            <PencilSquareIcon className="w-3.5 h-3.5" /> Edit
                                        </button>
                                        <button onClick={() => setSelectedFile(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors ml-2" title="Close Viewer">
                                            <XMarkIcon className="w-5 h-5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="bg-[#1e1e1e] w-full min-h-0">
                                    <SyntaxHighlighter 
                                        language={selectedFile.language || 'text'} 
                                        style={vscDarkPlus} 
                                        customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent' }} 
                                        showLineNumbers={true} 
                                        wrapLongLines={false}
                                    >
                                        {selectedFile.content || "// File is empty"}
                                    </SyntaxHighlighter>
                                </div>
                            </div>
                        ) : (
                            // --- FILE BROWSER TABLE ---
                            <>
                                <div className="bg-ubiq-900 border-b border-white/5 text-xs uppercase text-slate-500 px-4 py-3 flex font-medium shrink-0">
                                    <div className="flex-1">Name</div>
                                    <div className="w-24">Size</div>
                                    <div className="w-24 text-right">Actions</div>
                                </div>
                                <div className="overflow-y-auto custom-scrollbar flex-1">
                                    <table className="w-full text-left text-sm text-slate-300">
                                        <tbody className="divide-y divide-white/5">
                                            {currentPath !== '' && (
                                                <tr className="hover:bg-white/5 cursor-pointer" onClick={() => setCurrentPath(currentPath.split('/').slice(0, -1).join('/'))}>
                                                    <td className="px-4 py-3 flex items-center gap-2 text-slate-400"><FolderIcon className="w-5 h-5" /> ..</td>
                                                    <td></td>
                                                    <td></td>
                                                </tr>
                                            )}
                                            {browserItems.map((item: any) => (
                                                <tr key={item.path || item.id} className="hover:bg-white/5 transition-colors group">
                                                    <td 
                                                        className="px-4 py-3 flex items-center gap-3 font-medium text-white cursor-pointer"
                                                        onClick={() => item.type === 'folder' ? setCurrentPath(item.path) : setSelectedFile(item)}
                                                    >
                                                        {item.type === 'folder' ? <FolderIcon className="w-5 h-5 text-blue-400" /> : <DocumentTextIcon className="w-5 h-5 text-slate-400" />}
                                                        {item.name}
                                                    </td>
                                                    <td className="px-4 py-3 text-slate-500 w-24">
                                                        {item.type === 'file' ? formatBytes(item.size_bytes) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right w-24">
                                                        {item.type === 'file' && (
                                                            <button 
                                                                onClick={(e) => { e.stopPropagation(); setSelectedFile(item); }} 
                                                                className="text-ubiq-accent hover:text-white text-xs flex items-center justify-end gap-1 ml-auto"
                                                            >
                                                                <EyeIcon className="w-3.5 h-3.5" /> View
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                            {browserItems.length === 0 && (
                                                <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">This folder is empty.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* RIGHT: SIDEBAR ACTIONS */}
                <div className="space-y-6">
                    <div className="glass-panel p-6 rounded-xl border border-dashed border-ubiq-700 hover:border-ubiq-accent/50 transition-colors text-center">
                        <CloudArrowUpIcon className={`w-10 h-10 mx-auto mb-3 ${uploading ? 'text-ubiq-accent animate-bounce' : 'text-slate-500'}`} />
                        <h3 className="text-white font-medium mb-1">{uploading ? 'Uploading...' : 'Upload Files'}</h3>
                        <p className="text-xs text-slate-500 mb-4">Drag & drop to <span className="text-ubiq-accent">/{currentPath || 'root'}</span></p>
                        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="w-full py-2 bg-ubiq-800 hover:bg-ubiq-700 text-white rounded-lg text-sm transition-colors border border-white/5">Select Files</button>
                        <input type="file" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                    </div>

                    <div className="glass-panel p-5 rounded-xl space-y-3">
                        <h3 className="text-white font-bold text-sm mb-2">Project Actions</h3>
                        
                        {/* UPDATED DOWNLOAD BUTTON */}
                        <button 
                            onClick={handleProjectDownload} 
                            disabled={downloadStatus !== 'idle'}
                            className="w-full flex flex-col justify-center px-4 py-3 bg-ubiq-900 hover:bg-ubiq-800 border border-white/5 rounded-lg text-sm text-slate-300 transition-colors group relative overflow-hidden"
                        >
                            {/* Standard State */}
                            {downloadStatus === 'idle' && (
                                <div className="flex items-center justify-between w-full">
                                    <span className="flex items-center gap-2"><ArrowDownOnSquareIcon className="w-4 h-4 text-blue-400" /> Download ZIP</span>
                                    <ArrowDownTrayIcon className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            )}

                            {/* Compressing State */}
                            {downloadStatus === 'compressing' && (
                                <div className="flex items-center gap-3 w-full animate-pulse">
                                    <ArrowPathIcon className="w-4 h-4 animate-spin text-ubiq-accent" />
                                    <span className="text-ubiq-accent font-medium">Compressing Files...</span>
                                </div>
                            )}

                            {/* Downloading State */}
                            {downloadStatus === 'downloading' && (
                                <div className="w-full">
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className="text-emerald-400 font-bold">Downloading...</span>
                                        <span className="text-white">{downloadProgress}%</span>
                                    </div>
                                    <div className="w-full h-1 bg-ubiq-950 rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-emerald-500 transition-all duration-300 ease-out" 
                                            style={{ width: `${downloadProgress}%` }}
                                        />
                                    </div>
                                </div>
                            )}
                        </button>

                        <button onClick={() => setEditModalOpen(true)} className="w-full flex items-center justify-between px-4 py-3 bg-ubiq-900 hover:bg-ubiq-800 border border-white/5 rounded-lg text-sm text-slate-300 transition-colors group">
                            <span className="flex items-center gap-2"><PencilSquareIcon className="w-4 h-4 text-orange-400" /> Edit Metadata</span>
                        </button>
                        
                        <button 
                            onClick={() => setDeleteModalOpen(true)}
                            className="w-full flex items-center justify-between px-4 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-sm text-red-400 transition-colors group"
                        >
                            <span className="flex items-center gap-2"><TrashIcon className="w-4 h-4" /> Delete Project</span>
                        </button>
                    </div>
                </div>
            </div>

        </div>

        {/* --- DELETE CONFIRMATION MODAL --- */}
        <ConfirmDialog
            isOpen={deleteModalOpen}
            onClose={() => setDeleteModalOpen(false)}
            onConfirm={handleDeleteProject}
            title="Delete Project?"
            message={`Are you sure you want to delete "${project?.name}"? This action cannot be undone and all associated files will be permanently lost.`}
            confirmText={isDeleting ? "Deleting..." : "Delete Project"}
            isDestructive={true}
        />

        <EditProjectDialog 
            isOpen={editModalOpen} 
            onClose={() => setEditModalOpen(false)} 
            project={project}
            onSuccess={() => {
                loadData(); // Refresh data to show new name/desc
                setEditModalOpen(false);
            }} 
        />

      </div>
    </Layout>
  );
}