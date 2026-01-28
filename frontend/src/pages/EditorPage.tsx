import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import CodeEditor from '../components/CodeEditor';
import { projectAPI, fileAPI } from '../services/api';

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
  const [code, setCode] = useState('// Start coding with AI assistance...\n\n');
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
      
      // Load first file if available
      if (response.data.project.files && response.data.project.files.length > 0) {
        const firstFile = response.data.project.files[0];
        setCurrentFile(firstFile);
        setCode(firstFile.content || '');
        setLanguage(firstFile.language || 'javascript');
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
  };

  const handleSaveFile = async () => {
    if (!currentFile || !projectId) return;

    setSaving(true);
    try {
      await fileAPI.update(currentFile.id, {
        content: code,
      });
      console.log('File saved successfully');
    } catch (error) {
      console.error('Failed to save file:', error);
    } finally {
      setSaving(false);
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

      // Reload project to get updated file list
      await loadProject();
      
      // Select the new file
      handleFileSelect(response.data.file);
      
      setShowNewFileDialog(false);
      setNewFileName('');
    } catch (error) {
      console.error('Failed to create file:', error);
    }
  };

  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
  };

  return (
    <Layout>
      <div className="h-full flex">
        {/* Sidebar - File Explorer */}
        <div className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <h2 className="text-white font-semibold text-lg">
              {project?.name || 'New Project'}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              {project?.description || 'No description'}
            </p>
          </div>

          <div className="p-2 border-b border-slate-700">
            <button
              onClick={() => setShowNewFileDialog(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded transition-colors"
            >
              + New File
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <div className="text-xs text-slate-400 uppercase font-semibold mb-2 px-2">
              Files
            </div>
            {project?.files && project.files.length > 0 ? (
              <div className="space-y-1">
                {project.files.map((file) => (
                  <button
                    key={file.id}
                    onClick={() => handleFileSelect(file)}
                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                      currentFile?.id === file.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <div className="flex items-center">
                      <span className="mr-2">📄</span>
                      <span className="truncate">{file.name}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm text-center py-8">
                No files yet
              </div>
            )}
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col">
          {/* Toolbar */}
          <div className="bg-slate-800 border-b border-slate-700 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <span className="text-slate-400 text-sm">Language:</span>
                <select
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className="bg-slate-700 text-white px-3 py-1 rounded border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="javascript">JavaScript</option>
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="java">Java</option>
                  <option value="cpp">C++</option>
                  <option value="csharp">C#</option>
                  <option value="go">Go</option>
                  <option value="rust">Rust</option>
                  <option value="php">PHP</option>
                  <option value="ruby">Ruby</option>
                  <option value="swift">Swift</option>
                  <option value="kotlin">Kotlin</option>
                  <option value="html">HTML</option>
                  <option value="css">CSS</option>
                  <option value="json">JSON</option>
                  <option value="markdown">Markdown</option>
                </select>
              </div>

              {currentFile && (
                <div className="text-slate-400 text-sm">
                  Current: <span className="text-white">{currentFile.name}</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              {saving && (
                <span className="text-green-400 text-sm">Saving...</span>
              )}
              {currentFile && (
                <button
                  onClick={handleSaveFile}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white px-4 py-1 rounded text-sm font-medium transition-colors"
                >
                  {saving ? 'Saving...' : 'Save (Ctrl+S)'}
                </button>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1">
            <CodeEditor
              initialCode={code}
              language={language}
              onCodeChange={handleCodeChange}
            />
          </div>
        </div>

        {/* New File Dialog */}
        {showNewFileDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md border border-slate-700">
              <h3 className="text-white text-xl font-semibold mb-4">Create New File</h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-slate-300 text-sm mb-2">
                    File Name
                  </label>
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="example.js"
                    className="w-full bg-slate-700 text-white px-3 py-2 rounded border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-slate-300 text-sm mb-2">
                    Language
                  </label>
                  <select
                    value={newFileLanguage}
                    onChange={(e) => setNewFileLanguage(e.target.value)}
                    className="w-full bg-slate-700 text-white px-3 py-2 rounded border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="java">Java</option>
                    <option value="cpp">C++</option>
                    <option value="go">Go</option>
                    <option value="php">PHP</option>
                    <option value="html">HTML</option>
                    <option value="css">CSS</option>
                  </select>
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={() => setShowNewFileDialog(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewFile}
                  disabled={!newFileName}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white py-2 rounded font-medium transition-colors"
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