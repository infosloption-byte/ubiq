import { useState, useEffect } from 'react';
import { projectAPI, githubAuthAPI, getAuthToken } from '../services/api';
import axios from 'axios';
import { 
  FolderPlusIcon, 
  CommandLineIcon, 
  CodeBracketIcon,
  XMarkIcon,
  CloudArrowUpIcon,
  LockClosedIcon,
  GlobeAltIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  PencilSquareIcon,
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

// Compact "3d ago" / "2mo ago" style relative time for the repo picker list
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

interface GithubRepo {
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  owner_login: string | null;
  owner_avatar_url: string | null;
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

  // F3e: repo picker state — separate from the manual-paste fields
  // above, which stay as the fallback path (unlisted repos, or no
  // GitHub connection at all). `githubConnected === null` means "not
  // checked yet"; only fetched lazily once the GitHub tab is actually
  // opened, not on dialog mount, since most project creations never
  // touch this tab at all.
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [githubRepos, setGithubRepos] = useState<GithubRepo[] | null>(null);
  const [repoLoadError, setRepoLoadError] = useState('');
  const [reposLoading, setReposLoading] = useState(false);
  const [repoMode, setRepoMode] = useState<'picker' | 'manual'>('picker');
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepoFullName, setSelectedRepoFullName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  
  // Zip Import Specific
  const [importFile, setImportFile] = useState<File | null>(null);

  if (!isOpen) return null;

  // F3e: lazily check GitHub connection + load repos the first time the
  // GitHub tab is opened, not on every dialog mount — most project
  // creations never touch this tab, so checking eagerly would add an
  // extra round-trip to a flow that doesn't need it.
  useEffect(() => {
    if (activeTab !== 'github' || githubConnected !== null) return;

    githubAuthAPI.status()
      .then(res => {
        setGithubConnected(res.data.connected);
        if (res.data.connected) loadRepos();
        else setRepoMode('manual');
      })
      .catch(() => {
        // Status check failing shouldn't block project creation — fall
        // back to the manual-paste path the same as "not connected".
        setGithubConnected(false);
        setRepoMode('manual');
      });
  }, [activeTab]);

  const loadRepos = () => {
    setReposLoading(true);
    setRepoLoadError('');
    githubAuthAPI.repos()
      .then(res => setGithubRepos(res.data.repos || []))
      .catch(err => {
        const code = err.response?.data?.error;
        if (code === 'token_invalid') {
          setGithubConnected(false);
          setRepoMode('manual');
          setRepoLoadError('Your GitHub connection expired. Reconnect below, or paste a repository URL manually.');
        } else {
          setRepoLoadError('Could not load your repositories. You can still paste a repository URL manually below.');
        }
      })
      .finally(() => setReposLoading(false));
  };

  const handleConnectGithub = async () => {
    setConnecting(true);
    try {
      const res = await githubAuthAPI.connect();
      // Full-page navigation, not an axios call — this has to actually
      // leave the SPA and land on github.com (see githubAuthAPI's own
      // comment in services/api.ts).
      window.location.href = res.data.redirect_url;
    } catch {
      setConnecting(false);
      setRepoLoadError('Could not start GitHub connection. Please try again.');
    }
  };

  const filteredRepos = (githubRepos || []).filter(r =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    (r.description || '').toLowerCase().includes(repoSearch.toLowerCase())
  );

  const selectRepo = (repo: GithubRepo) => {
    setSelectedRepoFullName(repo.full_name);
    setRepoUrl(repo.clone_url);
  };

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
      setSelectedRepoFullName(null); setRepoSearch(''); setRepoMode('picker');

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

              {/* Not connected yet — offer Connect, manual paste stays available below */}
              {githubConnected === false && (
                <div className="p-3 bg-ubiq-accent/10 border border-ubiq-accent/20 rounded-lg text-xs leading-relaxed space-y-2">
                  <p className="text-slate-300">
                    <strong className="text-white">Connect your GitHub account</strong> to browse and pick a repo directly, instead of pasting a URL and token by hand.
                  </p>
                  <button
                    type="button"
                    onClick={handleConnectGithub}
                    disabled={connecting}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-ubiq-accent text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {connecting ? <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <CodeBracketIcon className="w-3.5 h-3.5" />}
                    Connect GitHub
                  </button>
                </div>
              )}

              {githubConnected === null && (
                <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                  <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin" />
                  Checking GitHub connection...
                </div>
              )}

              {repoLoadError && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-300 text-xs">
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{repoLoadError}</span>
                </div>
              )}

              {/* Connected: picker <-> manual toggle */}
              {githubConnected === true && (
                <div className="flex items-center gap-1 p-1 bg-ubiq-950/50 rounded-lg border border-white/5 w-fit">
                  <button
                    type="button"
                    onClick={() => setRepoMode('picker')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${repoMode === 'picker' ? 'bg-ubiq-accent/15 text-ubiq-accent' : 'text-slate-400 hover:text-white'}`}
                  >
                    <CodeBracketIcon className="w-3.5 h-3.5" /> Browse repos
                  </button>
                  <button
                    type="button"
                    onClick={() => setRepoMode('manual')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${repoMode === 'manual' ? 'bg-ubiq-accent/15 text-ubiq-accent' : 'text-slate-400 hover:text-white'}`}
                  >
                    <PencilSquareIcon className="w-3.5 h-3.5" /> Paste URL
                  </button>
                </div>
              )}

              {/* Repo picker */}
              {githubConnected === true && repoMode === 'picker' && (
                <div className="space-y-2">
                  <div className="relative">
                    <MagnifyingGlassIcon className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search your repositories..."
                      value={repoSearch}
                      onChange={e => setRepoSearch(e.target.value)}
                      className="input-primary w-full pl-8 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={loadRepos}
                      title="Refresh list"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                    >
                      <ArrowPathIcon className={`w-3.5 h-3.5 ${reposLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="border border-white/5 rounded-lg max-h-52 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                    {reposLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="w-5 h-5 border-2 border-ubiq-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : filteredRepos.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-8 px-4">
                        {githubRepos === null ? 'Loading...' : githubRepos.length === 0 ? "No repositories found for this account." : "No repos match your search."}
                      </p>
                    ) : (
                      filteredRepos.map(repo => {
                        const isSelected = selectedRepoFullName === repo.full_name;
                        return (
                          <button
                            type="button"
                            key={repo.full_name}
                            onClick={() => selectRepo(repo)}
                            className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-ubiq-accent/10' : 'hover:bg-white/5'}`}
                          >
                            <div className="mt-0.5 shrink-0">
                              {isSelected ? (
                                <CheckCircleIcon className="w-4 h-4 text-ubiq-accent" />
                              ) : repo.private ? (
                                <LockClosedIcon className="w-4 h-4 text-slate-500" />
                              ) : (
                                <GlobeAltIcon className="w-4 h-4 text-slate-500" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-white truncate">{repo.full_name}</span>
                                {repo.private && (
                                  <span className="text-[9px] uppercase tracking-wide text-slate-500 border border-white/10 rounded px-1 py-0.5 shrink-0">Private</span>
                                )}
                              </div>
                              {repo.description && (
                                <p className="text-[11px] text-slate-500 truncate mt-0.5">{repo.description}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-600">
                                {repo.language && <span>{repo.language}</span>}
                                <span>Updated {timeAgo(repo.updated_at)}</span>
                              </div>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  {selectedRepoFullName && (
                    <p className="text-[10px] text-slate-500">
                      Selected <span className="text-slate-300 font-mono">{selectedRepoFullName}</span> — private repos import automatically using your connected account, no token needed.
                    </p>
                  )}
                </div>
              )}

              {/* Manual paste — default when not connected, or explicitly chosen when connected */}
              {(githubConnected !== true || repoMode === 'manual') && (
                <div className="space-y-4">
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs leading-relaxed">
                    <strong>GitHub Integration:</strong> We will clone the repository to your workspace.
                    Use a Token if the repo is private.
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Repository URL</label>
                    <input
                        type="url" required={repoMode === 'manual' || githubConnected !== true}
                        className="input-primary w-full font-mono text-xs"
                        placeholder="https://github.com/username/repo"
                        value={repoUrl}
                        onChange={e => { setRepoUrl(e.target.value); setSelectedRepoFullName(null); }}
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
                    <p className="text-[10px] text-slate-500 mt-1">Required for private repositories not visible to a connected GitHub account. Not stored permanently.</p>
                  </div>
                </div>
              )}
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