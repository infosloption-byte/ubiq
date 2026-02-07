import { useState } from 'react';
import { projectAPI } from '../services/api';
import axios from 'axios'; // We might need direct axios for FormData if api wrapper doesn't support it easily yet
import { 
  FolderPlusIcon, 
  CommandLineIcon, 
  CodeBracketIcon,
  XMarkIcon,
  CloudArrowUpIcon // NEW
} from '@heroicons/react/24/outline';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateProjectDialog({ isOpen, onClose, onSuccess }: CreateProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'import' | 'github'>('manual');
  const [loading, setLoading] = useState(false);
  
  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [repoUrl, setRepoUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (activeTab === 'import') {
          // --- ZIP IMPORT ---
          if (!importFile) { alert("Please select a ZIP file."); setLoading(false); return; }
          
          const formData = new FormData();
          formData.append('name', name);
          formData.append('description', description);
          formData.append('visibility', visibility);
          formData.append('file', importFile);

          // Assuming you add 'import' to projectAPI, otherwise use axios directly:
          // await axios.post('/api/v1/projects/import', formData, { headers: { ...authHeaders } });
          // For now, let's assume projectAPI has a .create method that can handle this or we extend it.
          // Since standard JSON api calls don't handle FormData well, let's use a dedicated import call.
          
          // NOTE: You need to implement `projectAPI.import(formData)` in your api.ts services file.
          // If you haven't, use this direct axios call (update URL/token retrieval as needed):
          const token = localStorage.getItem('token') || JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.token;
          await axios.post('http://localhost:8000/api/v1/projects/import', formData, {
              headers: { 
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data'
              }
          });

      } else {
          // --- MANUAL / GITHUB ---
          const payload: any = {
            name,
            description,
            visibility,
            source: activeTab,
            language: 'mixed' // Default since we removed selection
          };

          if (activeTab === 'github') {
            payload.repository_url = repoUrl;
            if (githubToken) payload.github_token = githubToken;
          }

          await projectAPI.create(payload);
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to create project:", error);
      alert("Failed to create project. Please check your inputs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-ubiq-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h3 className="text-lg font-semibold text-white">Create New Project</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/5 bg-ubiq-950/50">
          <button onClick={() => setActiveTab('manual')} className={`flex-1 py-3 text-xs font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'manual' ? 'text-ubiq-accent border-b-2 border-ubiq-accent bg-ubiq-900' : 'text-slate-400 hover:text-white'}`}>
            <FolderPlusIcon className="w-4 h-4" /> Blank
          </button>
          <button onClick={() => setActiveTab('import')} className={`flex-1 py-3 text-xs font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'import' ? 'text-ubiq-accent border-b-2 border-ubiq-accent bg-ubiq-900' : 'text-slate-400 hover:text-white'}`}>
            <CloudArrowUpIcon className="w-4 h-4" /> Import .ZIP
          </button>
          <button onClick={() => setActiveTab('github')} className={`flex-1 py-3 text-xs font-medium transition-colors flex items-center justify-center gap-2 ${activeTab === 'github' ? 'text-ubiq-accent border-b-2 border-ubiq-accent bg-ubiq-900' : 'text-slate-400 hover:text-white'}`}>
            <CodeBracketIcon className="w-4 h-4" /> GitHub
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar bg-ubiq-900">
          
          {/* Common Fields */}
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Project Name</label>
            <input type="text" required className="input-primary w-full" placeholder="e.g. My Awesome App" value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Description (Optional)</label>
            <textarea className="input-primary w-full h-20 resize-none" placeholder="What is this project about?" value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          {/* IMPORT TAB SPECIFIC */}
          {activeTab === 'import' && (
             <div className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center hover:bg-white/5 transition-colors cursor-pointer relative bg-ubiq-950/30">
                <input type="file" accept=".zip" onChange={(e) => setImportFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                <CloudArrowUpIcon className="w-10 h-10 text-slate-500 mx-auto mb-3" />
                <p className="text-sm text-slate-300 font-medium">{importFile ? importFile.name : "Click to upload .ZIP file"}</p>
                <p className="text-xs text-slate-500 mt-1">Max 10MB</p>
             </div>
          )}

          {/* GITHUB TAB SPECIFIC */}
          {activeTab === 'github' && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs leading-relaxed">
                <strong>GitHub Integration:</strong> Provide the URL to clone your repository.
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Repository URL</label>
                <input type="url" required className="input-primary w-full" placeholder="https://github.com/username/repo" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Personal Access Token (Optional)</label>
                <input type="password" className="input-primary w-full" placeholder="ghp_xxxxxxxxxxxx" value={githubToken} onChange={e => setGithubToken(e.target.value)} />
              </div>
            </div>
          )}

          {/* Visibility */}
          <div>
             <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Visibility</label>
             <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input type="radio" name="visibility" value="private" checked={visibility === 'private'} onChange={e => setVisibility(e.target.value)} className="text-ubiq-accent focus:ring-ubiq-accent bg-ubiq-950 border-white/20" />
                   <span className="text-sm text-slate-300 group-hover:text-white">Private</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={e => setVisibility(e.target.value)} className="text-ubiq-accent focus:ring-ubiq-accent bg-ubiq-950 border-white/20" />
                   <span className="text-sm text-slate-300 group-hover:text-white">Public</span>
                </label>
             </div>
          </div>

        </form>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-ubiq-950/30 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary px-6 py-2 text-sm shadow-lg shadow-ubiq-accent/20 flex items-center gap-2">
            {loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {activeTab === 'import' ? 'Upload & Create' : activeTab === 'github' ? 'Clone Project' : 'Create Project'}
          </button>
        </div>

      </div>
    </div>
  );
}