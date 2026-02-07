import { useState, useEffect } from 'react';
import { projectAPI } from '../services/api';
import { XMarkIcon } from '@heroicons/react/24/outline';

interface EditProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  project: any;
  onSuccess: () => void;
}

export default function EditProjectDialog({ isOpen, onClose, project, onSuccess }: EditProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setDescription(project.description || '');
      setVisibility(project.visibility || 'private');
    }
  }, [project, isOpen]);

  if (!isOpen || !project) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await projectAPI.update(project.id, { name, description, visibility });
      onSuccess();
      onClose();
    } catch (error) {
      console.error("Failed to update project", error);
      alert("Failed to update project details.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-ubiq-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h3 className="text-lg font-semibold text-white">Edit Project</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Project Name</label>
            <input 
              type="text" 
              required 
              className="input-primary w-full" 
              value={name} 
              onChange={e => setName(e.target.value)} 
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">Description</label>
            <textarea 
              className="input-primary w-full h-24 resize-none" 
              value={description} 
              onChange={e => setDescription(e.target.value)} 
            />
          </div>

          <div>
             <label className="block text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Visibility</label>
             <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input type="radio" name="edit-visibility" value="private" checked={visibility === 'private'} onChange={e => setVisibility(e.target.value)} className="text-ubiq-accent focus:ring-ubiq-accent bg-ubiq-950 border-white/20" />
                   <span className="text-sm text-slate-300 group-hover:text-white">Private</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer group">
                   <input type="radio" name="edit-visibility" value="public" checked={visibility === 'public'} onChange={e => setVisibility(e.target.value)} className="text-ubiq-accent focus:ring-ubiq-accent bg-ubiq-950 border-white/20" />
                   <span className="text-sm text-slate-300 group-hover:text-white">Public</span>
                </label>
             </div>
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary px-6 py-2 text-sm shadow-lg shadow-ubiq-accent/20">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}