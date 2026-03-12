import { useState, useEffect } from 'react';
import { X, Key, Eye, EyeOff, Save, ExternalLink, Sparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useNavigate } from 'react-router-dom';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [keys, setKeys] = useState({ openrouter: '', grok: '', mistral: '', google: '' });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('ubiq_api_keys');
      if (stored) { try { setKeys(JSON.parse(stored)); } catch (e) {} }
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('ubiq_api_keys', JSON.stringify(keys));
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-[#0B0B10] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl ring-1 ring-white/10">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-500" /> 
            Cloud Keys
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Upgrade CTA if not Pro */}
          {user?.subscription_status !== 'active' && (
              <button 
                onClick={() => { onClose(); navigate('/settings'); }}
                className="w-full p-3 rounded-xl bg-gradient-to-r from-indigo-600/20 to-ubiq-accent/20 border border-indigo-500/30 flex items-center justify-between group"
              >
                  <div className="flex items-center gap-2 text-left">
                      <Sparkles className="w-4 h-4 text-ubiq-accent" />
                      <div>
                          <p className="text-[11px] font-bold text-white uppercase">Upgrade to Pro</p>
                          <p className="text-[10px] text-slate-400">Get 20GB storage & unlimited AI</p>
                      </div>
                  </div>
                  <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-white transition" />
              </button>
          )}

          <div className="text-[10px] text-slate-400 bg-white/5 p-3 rounded-lg leading-relaxed border border-white/5">
            <strong>Privacy:</strong> Keys are stored in your browser's LocalStorage.
          </div>

          {['openrouter', 'mistral', 'google', 'grok'].map((id) => (
            <div key={id}>
              <div className="flex justify-between items-end mb-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{id}</label>
              </div>
              <div className="relative">
                <input 
                  type={showKey[id] ? "text" : "password"} 
                  className="w-full bg-[#050509] border border-white/10 rounded-lg py-2 pl-3 pr-10 text-xs text-slate-200 focus:border-indigo-500 outline-none font-mono"
                  value={keys[id as keyof typeof keys]}
                  onChange={(e) => setKeys({...keys, [id]: e.target.value})}
                />
                <button onClick={() => setShowKey(p => ({...p, [id]: !p[id]}))} className="absolute right-3 top-2 text-slate-500 hover:text-slate-300">
                  {showKey[id] ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3 bg-[#050509]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white">
            Cancel
          </button>
          <button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all">
            Save Keys
          </button>
        </div>
      </div>
    </div>
  );
}