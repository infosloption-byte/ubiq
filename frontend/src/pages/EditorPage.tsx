import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import CodeEditor from '../components/CodeEditor';
import { projectAPI, fileAPI } from '../services/api';
import { 
  DocumentPlusIcon, 
  FolderIcon, 
  DocumentIcon, 
  ArrowPathIcon,
  CloudArrowUpIcon
} from '@heroicons/react/24/outline';

interface File {
  id: number;
  name: string;
  path: string;
  content: string;
  language: string;
}

interface Project {
  id: number;
  name: string;
  description: string;
  language: string;
  files: File[];
}

export default function EditorPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [code, setCode] = useState('// Select a file to start coding...\n');
  const [language, setLanguage] = useState('javascript');
  const [saving, setSaving] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileLanguage, setNewFileLanguage] = useState('javascript');

  useEffect(() => {
    if (projectId) {
      loadProject();
    }
  }, [projectId]);

  const loadProject = async () => {
    try {
      const response = await projectAPI.get(Number(projectId));
      setProject(response.data.project);
      
      if (response.data.project.files?.length > 0) {
        const firstFile = response.data.project.files[0];
        handleFileSelect(firstFile);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const handleSaveFile = async () => {
    if (!currentFile || !projectId) return;

    setSaving(true);
    try {
      await fileAPI.update(currentFile.id, { content: code });
      console.log('File saved successfully');
    } catch (error) {
      console.error('Failed to save file:', error);
    } finally {
      setTimeout(() => setSaving(false), 500);
    }
  };

  const handleFileSelect = (file: File) => {
    setCurrentFile(file);
    setCode(file.content || '');
    setLanguage(file.language || 'javascript');
  };

  const handleNewFile = async () => {
    if (!projectId || !newFileName) return;

    try {
      const response = await fileAPI.create(Number(projectId), {
        name: newFileName,
        path: newFileName,
        content: '',
        language: newFileLanguage,
      });
      await loadProject();
      handleFileSelect(response.data.file);
      setShowNewFileDialog(false);
      setNewFileName('');
    } catch (error) {
      console.error('Failed to create file:', error);
    }
  };

  return (
    <Layout>
      <div className="h-full flex flex-col md:flex-row overflow-hidden bg-ubiq-950">
        {/* Sidebar - File Explorer */}
        <div className="w-full md:w-64 bg-ubiq-900 border-r border-ubiq-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-ubiq-800">
            <h2 className="text-white font-semibold truncate flex items-center gap-2">
              <FolderIcon className="w-5 h-5 text-ubiq-accent" />
              {project?.name || 'Loading...'}
            </h2>
            <p className="text-slate-500 text-xs mt-1 truncate">
              {project?.description || 'Project Workspace'}
            </p>
          </div>

          <div className="p-3">
            <button
              onClick={() => setShowNewFileDialog(true)}
              className="w-full flex items-center justify-center gap-2 bg-ubiq-800 hover:bg-ubiq-700 text-slate-200 text-xs font-medium py-2 px-3 rounded-lg transition-colors border border-ubiq-700"
            >
              <DocumentPlusIcon className="w-4 h-4" />
              New File
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
             <div className="px-2 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
               Explorer
             </div>
            {project?.files && project.files.length > 0 ? (
                project.files.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => handleFileSelect(file)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center gap-2 group ${
                      currentFile?.id === file.id
                        ? 'bg-ubiq-accent/10 text-ubiq-accent border border-ubiq-accent/20'
                        : 'text-slate-400 hover:bg-ubiq-800 hover:text-slate-200'
                    }`}
                  >
                    <DocumentIcon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{file.name}</span>
                  </button>
                ))
            ) : (
              <div className="text-slate-600 text-xs text-center py-8 italic">
                No files created yet
              </div>
            )}
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor Toolbar */}
          <div className="h-12 bg-ubiq-950 border-b border-ubiq-800 px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
               {currentFile ? (
                 <div className="flex items-center gap-2 text-sm text-slate-300">
                    <DocumentIcon className="w-4 h-4 text-slate-500" />
                    <span>{currentFile.name}</span>
                 </div>
               ) : (
                 <span className="text-sm text-slate-500 italic">No file selected</span>
               )}
            </div>
            
            <div className="flex items-center gap-3">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-ubiq-900 text-slate-300 text-xs px-2 py-1 rounded border border-ubiq-800 focus:outline-none focus:border-ubiq-accent"
              >
                {['javascript', 'typescript', 'python', 'java', 'html', 'css', 'json', 'php'].map(lang => (
                   <option key={lang} value={lang}>{lang.toUpperCase()}</option>
                ))}
              </select>

              <button
                onClick={handleSaveFile}
                disabled={saving || !currentFile}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                   saving 
                     ? 'text-green-400 bg-green-400/10' 
                     : 'text-white bg-ubiq-accent hover:bg-ubiq-accent-hover'
                }`}
              >
                {saving ? (
                   <ArrowPathIcon className="w-3.5 h-3.5 animate-spin" />
                ) : (
                   <CloudArrowUpIcon className="w-3.5 h-3.5" />
                )}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Editor Component */}
          <div className="flex-1 relative bg-ubiq-950 overflow-hidden">
            <CodeEditor
              initialCode={code}
              language={language}
              onCodeChange={setCode}
            />
          </div>
        </div>

        {/* New File Dialog */}
        {showNewFileDialog && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-panel p-6 rounded-xl w-full max-w-sm shadow-2xl">
              <h3 className="text-white text-lg font-semibold mb-4">Create New File</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 ml-1">Filename</label>
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="script.js"
                    className="input-primary w-full mt-1"
                    autoFocus
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowNewFileDialog(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-ubiq-700 text-slate-300 hover:bg-ubiq-800 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleNewFile}
                    disabled={!newFileName}
                    className="flex-1 btn-primary text-sm"
                  >
                    Create
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