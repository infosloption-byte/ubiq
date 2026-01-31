import { useState } from 'react';
import { projectAPI } from '../services/api';
import { 
  FolderPlusIcon, 
  CommandLineIcon, 
  CodeBracketIcon,
  XMarkIcon 
} from '@heroicons/react/24/outline';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateProjectDialog({ isOpen, onClose, onSuccess }: CreateProjectDialogProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'github'>('manual');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    language: 'javascript',
    visibility: 'private',
    repository_url: '',
    github_token: ''
  });

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Prepare payload matches backend expectation
      const payload: any = {
        name: formData.name,
        description: formData.description,
        visibility: formData.visibility,
        source: activeTab, // 'manual' or 'github'
      };

      if (activeTab === 'manual') {
        payload.language = formData.language;
      } else {
        payload.repository_url = formData.repository_url;
        if (formData.github_token) payload.github_token = formData.github_token;
      }

      await projectAPI.create(payload);
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
        <div className="flex border-b border-white/5">
          <button
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'manual' 
                ? 'bg-ubiq-accent/10 text-ubiq-accent border-b-2 border-ubiq-accent' 
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <FolderPlusIcon className="w-4 h-4" /> Blank Project
          </button>
          <button
            onClick={() => setActiveTab('github')}
            className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'github' 
                ? 'bg-ubiq-accent/10 text-ubiq-accent border-b-2 border-ubiq-accent' 
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <CodeBracketIcon className="w-4 h-4" /> Import from GitHub
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          
          {/* Common Fields */}
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Project Name</label>
            <input
              type="text"
              required
              className="input-primary w-full"
              placeholder="e.g. My Awesome App"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Description (Optional)</label>
            <textarea
              className="input-primary w-full h-20 resize-none"
              placeholder="What is this project about?"
              value={formData.description}
              onChange={e => setFormData({...formData, description: e.target.value})}
            />
          </div>

          {/* Conditional Fields: Manual */}
          {activeTab === 'manual' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Primary Language</label>
              <select 
                className="input-primary w-full appearance-none"
                value={formData.language}
                onChange={e => setFormData({...formData, language: e.target.value})}
              >
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="php">PHP</option>
                <option value="html">HTML/CSS</option>
                <option value="java">Java</option>
                <option value="go">Go</option>
              </select>
            </div>
          )}

          {/* Conditional Fields: GitHub */}
          {activeTab === 'github' && (
            <div className="space-y-5 animate-fade-in">
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs leading-relaxed">
                <strong className="block mb-1 font-semibold">🔗 GitHub Integration</strong>
                We will clone your repository into a secure sandbox environment. This allows the AI to read your codebase and propose changes.
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Repository URL</label>
                <input
                  type="url"
                  required
                  className="input-primary w-full"
                  placeholder="https://github.com/username/repo"
                  value={formData.repository_url}
                  onChange={e => setFormData({...formData, repository_url: e.target.value})}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
                  Personal Access Token (Private Repos Only)
                </label>
                <input
                  type="password"
                  className="input-primary w-full"
                  placeholder="ghp_xxxxxxxxxxxx"
                  value={formData.github_token}
                  onChange={e => setFormData({...formData, github_token: e.target.value})}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Required only if the repository is private. Token is encrypted safely.
                </p>
              </div>
            </div>
          )}

          {/* Visibility */}
          <div>
             <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Visibility</label>
             <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input 
                      type="radio" 
                      name="visibility" 
                      value="private"
                      checked={formData.visibility === 'private'}
                      onChange={e => setFormData({...formData, visibility: e.target.value})}
                      className="text-ubiq-accent focus:ring-ubiq-accent bg-ubiq-950 border-white/20" 
                   />
                   <span className="text-sm text-slate-300 group-hover:text-white">Private</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input 
                      type="radio" 
                      name="visibility" 
                      value="public" 
                      checked={formData.visibility === 'public'}
                      onChange={e => setFormData({...formData, visibility: e.target.value})}
                      className="text-ubiq-accent focus:ring-ubiq-accent bg-ubiq-950 border-white/20" 
                   />
                   <span className="text-sm text-slate-300 group-hover:text-white">Public</span>
                </label>
             </div>
          </div>

        </form>

        {/* Footer */}
        <div className="p-6 border-t border-white/5 bg-white/5 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary px-6 py-2 text-sm shadow-lg shadow-ubiq-accent/20 flex items-center gap-2"
          >
            {loading && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {activeTab === 'github' ? 'Import Project' : 'Create Project'}
          </button>
        </div>

      </div>
    </div>
  );
}