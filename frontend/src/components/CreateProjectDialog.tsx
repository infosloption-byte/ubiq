import { useState } from 'react';
import { projectAPI, getAuthToken } from '../services/api';
import axios from 'axios';
import { 
  FolderPlusIcon, 
  CommandLineIcon, 
  CodeBracketIcon,
  XMarkIcon,
  CloudArrowUpIcon,
  LockClosedIcon,
  GlobeAltIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

const MAX_ZIP_MB = 20;
const MAX_ZIP_BYTES = MAX_ZIP_MB * 1024 * 1024;

// Parse the most useful message out of a backend error response
function parseError(err: any): string {
  const data = err.response?.data;
  if (!data) return err.message || 'Request failed. Please try again.';

  // Direct error string
  if (typeof data.error === 'string') return data.error;

  // Laravel validation messages object
  if (data.messages && typeof data.messages === 'object') {
    const first = Object.values(data.messages)[0];
    return Array.isArray(first) ? first[0] as string : String(first);
  }

  if (typeof data.message === 'string') return data.message;
  return 'Something went wrong. Please try again.';
}

// Parse GitHub-specific clone error into a human readable message
function parseGithubError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('repository not found') || lower.includes('not found'))
    return 'Repository not found. Check the URL or make sure it\'s public (or provide a token for private repos).';
  if (lower.includes('authentication failed') || lower.includes('could not read username'))
    return 'Authentication failed. The repository is private — please provide a Personal Access Token.';
  if (lower.includes('already exists'))
    return 'A project folder already exists for this. Please try again.';
  if (lower.includes('empty repository'))
    return 'Repository cloned but appears to be empty.';
  if (lower.includes('timed out') || lower.includes('timeout'))
    return 'Clone timed out. The repository may be too large or the server is unreachable.';
  return raw; // fallback to raw if unrecognised
}

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
          if (!importFile) {
            setError('Please select a ZIP file.');
            setLoading(false);
            return;
          }

          if (importFile.size > MAX_ZIP_BYTES) {
            setError(`File too large (${(importFile.size / 1048576).toFixed(1)} MB). Maximum is ${MAX_ZIP_MB} MB.`);
            setLoading(false);
            return;
          }

          const formData = new FormData();
          formData.append('name', name);
          formData.append('description', description);
          formData.append('visibility', visibility);
          formData.append('file', importFile);

          const token = getAuthToken();

          await axios.post(`${import.meta.env.VITE_API_URL}/projects/import`, formData, {
              headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'multipart/form-data'
              }
          });

      } else {
          const payload: any = {
            name,
            description,
            visibility,
            source: activeTab,
            language: 'mixed'
          };

          if (activeTab === 'github') {
            if (!repoUrl) {
                setError('Repository URL is required');
                setLoading(false);
                return;
            }
            payload.repository_url = repoUrl;
            if (githubToken) payload.github_token = githubToken;
          }

          await projectAPI.create(payload);
      }

      onSuccess();
      onClose();
      setName(''); setDescription(''); setRepoUrl(''); setGithubToken(''); setImportFile(null);

    } catch (err: any) {
      console.error('Failed to create project:', err);
      let msg = parseError(err);
      if (activeTab === 'github' && msg.toLowerCase().includes('git clone failed')) {
        msg = parseGithubError(msg.replace(/^.*git clone failed:\s*/i, ''));
      }
      setError(msg);
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
            <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
              error.toLowerCase().includes('storage') || error.toLowerCase().includes('limit')
                ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              <ExclamationTriangleIcon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
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
                {importFile ? (
                  <p className={`text-xs mt-1 ${importFile.size > MAX_ZIP_BYTES ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
                    {(importFile.size / 1048576).toFixed(1)} MB {importFile.size > MAX_ZIP_BYTES ? `— exceeds ${MAX_ZIP_MB} MB limit` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">Max {MAX_ZIP_MB} MB</p>
                )}
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