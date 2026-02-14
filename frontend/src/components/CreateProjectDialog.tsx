import { useState } from 'react';
import { projectAPI } from '../services/api';
import axios from 'axios';
import { 
  FolderPlusIcon, 
  CommandLineIcon, 
  CodeBracketIcon,
  XMarkIcon,
  CloudArrowUpIcon,
  LockClosedIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateProjectDialog({ isOpen, onClose, onSuccess }: CreateProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'import' | 'github'>('manual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  
  // GitHub Specific
  const [repoUrl, setRepoUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  
  // Zip Import Specific
  const [importFile, setImportFile] = useState<File | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (activeTab === 'import') {
          // --- ZIP IMPORT FLOW ---
          if (!importFile) { 
            setError("Please select a ZIP file."); 
            setLoading(false); 
            return; 
          }
          
          const formData = new FormData();
          formData.append('name', name);
          formData.append('description', description);
          formData.append('visibility', visibility);
          formData.append('file', importFile);

          // Get token for direct Axios call (bypassing JSON wrapper)
          const token = localStorage.getItem('token') || 
                        JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.token;

          await axios.post(`${import.meta.env.VITE_API_URL}/projects/import`, formData, {
              headers: { 
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data'
              }
          });

      } else {
          // --- MANUAL & GITHUB FLOW ---
          const payload: any = {
            name,
            description,
            visibility,
            source: activeTab,
            language: 'mixed'
          };

          if (activeTab === 'github') {
            if (!repoUrl) {
                setError("Repository URL is required");
                setLoading(false);
                return;
            }
            payload.repository_url = repoUrl;
            // Send token if provided (Backend will use it for cloning but won't store it)
            if (githubToken) payload.github_token = githubToken;
          }

          await projectAPI.create(payload);
      }

      onSuccess();
      onClose();
      // Reset form
      setName(''); setDescription(''); setRepoUrl(''); setGithubToken('');
    } catch (err: any) {
      console.error("Failed to create project:", err);
      setError(err.response?.data?.error || "Failed to create project. Check your inputs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
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
          <TabButton 
            active={activeTab === 'manual'} 
            onClick={() => setActiveTab('manual')} 
            icon={<FolderPlusIcon className="w-4 h-4"/>} 
            label="Blank" 
          />
          <TabButton 
            active={activeTab === 'import'} 
            onClick={() => setActiveTab('import')} 
            icon={<CloudArrowUpIcon className="w-4 h-4"/>} 
            label="Import .ZIP" 
          />
          <TabButton 
            active={activeTab === 'github'} 
            onClick={() => setActiveTab('github')} 
            icon={<CodeBracketIcon className="w-4 h-4"/>} 
            label="GitHub" 
          />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar bg-ubiq-900">
          
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                {error}
            </div>
          )}

          {/* Common Fields */}
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Project Name</label>
            <input 
                type="text" required 
                className="input-primary w-full" 
                placeholder="e.g. My Awesome App" 
                value={name} 
                onChange={e => setName(e.target.value)} 
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Description (Optional)</label>
            <textarea 
                className="input-primary w-full h-20 resize-none" 
                placeholder="What is this project about?" 
                value={description} 
                onChange={e => setDescription(e.target.value)} 
            />
          </div>

          {/* IMPORT TAB SPECIFIC */}
          {activeTab === 'import' && (
             <div className="border-2 border-dashed border-white/10 rounded-lg p-8 text-center hover:bg-white/5 transition-colors cursor-pointer relative bg-ubiq-950/30 group">
                <input 
                    type="file" accept=".zip" 
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)} 
                    className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                />
                <CloudArrowUpIcon className="w-10 h-10 text-slate-500 mx-auto mb-3 group-hover:text-ubiq-accent transition-colors" />
                <p className="text-sm text-slate-300 font-medium">{importFile ? importFile.name : "Click to upload .ZIP file"}</p>
                <p className="text-xs text-slate-500 mt-1">Max 20MB</p>
             </div>
          )}

          {/* GITHUB TAB SPECIFIC */}
          {activeTab === 'github' && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs leading-relaxed">
                <strong>GitHub Integration:</strong> We will clone the repository to your workspace. 
                Use a Token if the repo is private.
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Repository URL</label>
                <input 
                    type="url" required 
                    className="input-primary w-full font-mono text-xs" 
                    placeholder="https://github.com/username/repo" 
                    value={repoUrl} 
                    onChange={e => setRepoUrl(e.target.value)} 
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Personal Access Token (Optional)</label>
                <input 
                    type="password" 
                    className="input-primary w-full font-mono text-xs" 
                    placeholder="ghp_xxxxxxxxxxxx" 
                    value={githubToken} 
                    onChange={e => setGithubToken(e.target.value)} 
                />
                <p className="text-[10px] text-slate-500 mt-1">Required for private repositories. Not stored permanently.</p>
              </div>
            </div>
          )}

          {/* Visibility */}
          <div>
             <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Visibility</label>
             <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input type="radio" name="visibility" value="private" checked={visibility === 'private'} onChange={e => setVisibility(e.target.value)} className="accent-ubiq-accent" />
                   <div className="flex items-center gap-1.5 text-sm text-slate-300 group-hover:text-white">
                      <LockClosedIcon className="w-3.5 h-3.5" /> Private
                   </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={e => setVisibility(e.target.value)} className="accent-ubiq-accent" />
                   <div className="flex items-center gap-1.5 text-sm text-slate-300 group-hover:text-white">
                      <GlobeAltIcon className="w-3.5 h-3.5" /> Public
                   </div>
                </label>
             </div>
          </div>

        </form>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-ubiq-950/30 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary px-6 py-2 text-sm shadow-lg shadow-ubiq-accent/20 flex items-center gap-2">
            {loading ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : activeTab === 'import' ? (
                <CloudArrowUpIcon className="w-4 h-4" />
            ) : activeTab === 'github' ? (
                <CommandLineIcon className="w-4 h-4" />
            ) : (
                <FolderPlusIcon className="w-4 h-4" />
            )}
            {activeTab === 'import' ? 'Upload & Create' : activeTab === 'github' ? 'Clone Project' : 'Create Project'}
          </button>
        </div>

      </div>
    </div>
  );
}

const TabButton = ({ active, onClick, icon, label }: any) => (
    <button 
        type="button"
        onClick={onClick} 
        className={`flex-1 py-3 text-xs font-medium transition-colors flex items-center justify-center gap-2 ${
            active 
            ? 'text-ubiq-accent border-b-2 border-ubiq-accent bg-ubiq-900' 
            : 'text-slate-400 hover:text-white'
        }`}
    >
        {icon} {label}
    </button>
);