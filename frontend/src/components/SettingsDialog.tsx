import { useState, useEffect } from 'react';
import { XMarkIcon, KeyIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

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
      if (stored) setKeys(JSON.parse(stored));
    }
  }, [isOpen]);

  const handleSave = () => {
    localStorage.setItem('ubiq_api_keys', JSON.stringify(keys));
    onClose();
    // Optional: Trigger a toast notification here
    alert("Keys saved securely to your browser.");
  };

  const toggleShow = (provider: string) => {
    setShowKey(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  if (!isOpen) return null;

  const providers = [
    { id: 'openrouter', label: 'OpenRouter (Claude/GPT)', link: 'https://openrouter.ai/keys' },
    { id: 'grok', label: 'xAI (Grok)', link: 'https://console.x.ai/' },
    { id: 'mistral', label: 'Mistral AI', link: 'https://console.mistral.ai/' },
    { id: 'google', label: 'Google Gemini', link: 'https://aistudio.google.com/app/apikey' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-ubiq-900 border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/5">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <KeyIcon className="w-5 h-5 text-ubiq-accent" /> 
            Bring Your Own Key (BYOK)
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        
        {/* Body */}
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto custom-scrollbar">
          <p className="text-xs text-slate-400 bg-blue-500/10 border border-blue-500/20 p-3 rounded-lg">
            <strong>Privacy Note:</strong> Your API keys are stored 100% locally in your browser. They are sent directly to the inference server only when you make a request.
          </p>

          {providers.map((p) => (
            <div key={p.id}>
              <div className="flex justify-between items-end mb-1.5">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">{p.label}</label>
                  <a href={p.link} target="_blank" rel="noreferrer" className="text-[10px] text-ubiq-accent hover:underline">Get Key ↗</a>
              </div>
              <div className="relative">
                <input 
                  type={showKey[p.id] ? "text" : "password"} 
                  placeholder={`sk-...`}
                  className="w-full bg-ubiq-950 border border-white/10 rounded-lg py-2 pl-3 pr-10 text-xs text-slate-200 focus:outline-none focus:border-ubiq-accent font-mono transition-colors"
                  value={keys[p.id as keyof typeof keys]}
                  onChange={(e) => setKeys({...keys, [p.id]: e.target.value})}
                />
                <button 
                  onClick={() => toggleShow(p.id)}
                  className="absolute right-3 top-2 text-slate-500 hover:text-slate-300"
                >
                  {showKey[p.id] ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3 bg-white/5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-all">Cancel</button>
          <button onClick={handleSave} className="btn-primary px-6 py-2 text-sm shadow-lg shadow-ubiq-accent/20">Save Keys</button>
        </div>
      </div>
    </div>
  );
}