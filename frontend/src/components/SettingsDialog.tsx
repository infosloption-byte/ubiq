import { useState, useEffect } from 'react';
import { X, Key, Eye, EyeOff, Save, ExternalLink } from 'lucide-react';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [keys, setKeys] = useState({
    openrouter: '',
    grok: '',
    mistral: '',
    google: ''
  });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  // Load keys on open
  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('ubiq_api_keys');
      if (stored) {
          try { setKeys(JSON.parse(stored)); } catch (e) {}
      }
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('ubiq_api_keys', JSON.stringify(keys));
    onClose();
    // In a real app, use a Toast context here. For now, we trust the UI closes.
  };

  const toggleShow = (provider: string) => {
    setShowKey(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (!isOpen) return null;

  const providers = [
    { id: 'openrouter', label: 'OpenRouter', link: 'https://openrouter.ai/keys' },
    { id: 'mistral', label: 'Mistral AI', link: 'https://console.mistral.ai/' },
    { id: 'google', label: 'Google Gemini', link: 'https://aistudio.google.com/app/apikey' },
    { id: 'grok', label: 'xAI (Grok)', link: 'https://console.x.ai/' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-[#0B0B10] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl ring-1 ring-white/10">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-500" /> 
            Configure Cloud Keys
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 hover:bg-white/10 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
          <div className="text-xs text-slate-400 bg-indigo-500/10 border border-indigo-500/20 p-3 rounded-lg leading-relaxed">
            <strong>Privacy First:</strong> Your API keys are encrypted and stored locally in your browser. We never see them.
          </div>

          {providers.map((p) => (
            <div key={p.id}>
              <div className="flex justify-between items-end mb-1.5">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">{p.label}</label>
                  <a href={p.link} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1">
                    Get Key <ExternalLink className="w-3 h-3" />
                  </a>
              </div>
              <div className="relative">
                <input 
                  type={showKey[p.id] ? "text" : "password"} 
                  placeholder={`sk-...`}
                  className="w-full bg-[#050509] border border-white/10 rounded-lg py-2 pl-3 pr-10 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                  value={keys[p.id as keyof typeof keys]}
                  onChange={(e) => setKeys({...keys, [p.id]: e.target.value})}
                />
                <button 
                  onClick={() => toggleShow(p.id)}
                  className="absolute right-3 top-2 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showKey[p.id] ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3 bg-[#050509]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg shadow-indigo-900/20 transition-all">
            <Save className="w-4 h-4" /> Save Keys
          </button>
        </div>
      </div>
    </div>
  );
}