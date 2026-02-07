import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiAPI, userAPI, authAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { 
  ChevronUpIcon, CheckIcon, CpuChipIcon, ArrowPathIcon, 
  CloudIcon, BoltIcon, ServerIcon, LockClosedIcon 
} from '@heroicons/react/24/outline';

interface Model {
  name: string; 
  provider: string; 
  size?: string;
  parameter_size?: string;
}

export default function ModelSelector() {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [models, setModels] = useState<Model[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    loadModels();
    loadKeys();
  }, []);

  const loadKeys = () => {
    const stored = localStorage.getItem('ubiq_api_keys');
    if (stored) {
        try { setApiKeys(JSON.parse(stored)); } catch (e) {}
    }
  };

  const loadModels = async () => {
    try {
      const response = await aiAPI.getModels();
      // Ensure we set the array correctly
      if (response.data && Array.isArray(response.data.models)) {
          setModels(response.data.models);
      } else {
          setModels([]);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
      // Optional: Set fallback models if API completely fails
      setModels([]); 
    }
  };

  const handleSelectModel = async (model: Model) => {
    // API Key Check Logic
    if (model.provider !== 'Ollama') {
        const keyMap: Record<string, string> = {
            'xAI': 'grok', 'Mistral': 'mistral', 'OpenRouter': 'openrouter', 'Google': 'google'
        };
        const keyName = keyMap[model.provider];
        if (keyName && (!apiKeys[keyName] || apiKeys[keyName].trim() === '')) {
            if (confirm(`${model.provider} API Key missing. Configure it now?`)) {
                navigate('/settings');
            }
            setIsOpen(false);
            return;
        }
    }

    if (loading) return;
    setLoading(true);
    
    try {
      await userAPI.updatePreferences({ preferred_model: model.name });
      const meResponse = await authAPI.me();
      if (meResponse.data.user) setUser(meResponse.data.user);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to update model:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDisplayName = (id: string) => {
      if (!id) return 'Select Model';
      const parts = id.split('/');
      return parts.length > 1 ? parts[parts.length - 1] : id; 
  };

  const currentModelId = user?.preferences?.preferred_model;
  // Fallback to finding the model object, or creating a temporary one for display
  const currentModel = models.find(m => m.name === currentModelId) 
      || { name: currentModelId || '', provider: 'Unknown' };
      
  const displayLabel = getDisplayName(currentModel.name || 'Select Model');

  // --- GROUPING LOGIC ---
  const localModels = models.filter(m => m.provider === 'Ollama');
  const cloudModels = models.filter(m => m.provider !== 'Ollama');

  const isKeyMissing = (provider: string) => {
      const keyMap: Record<string, string> = { 'xAI': 'grok', 'Mistral': 'mistral', 'OpenRouter': 'openrouter', 'Google': 'google' };
      const keyName = keyMap[provider];
      return keyName && (!apiKeys[keyName] || apiKeys[keyName].trim() === '');
  };

  const ModelOption = ({ model }: { model: Model }) => {
      const isSelected = currentModelId === model.name;
      const isCloud = model.provider !== 'Ollama';
      const keyMissing = isCloud && isKeyMissing(model.provider);

      return (
        <button
          onClick={() => handleSelectModel(model)}
          disabled={loading}
          className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors group relative ${
            isSelected ? 'bg-ubiq-accent/10 border border-ubiq-accent/20' : 'hover:bg-white/5 border border-transparent'
          } ${keyMissing ? 'opacity-70' : ''}`}
        >
          <div className={`p-1.5 rounded-md flex-shrink-0 ${
             isSelected ? 'bg-ubiq-accent text-white' : 'bg-ubiq-800 text-slate-400 group-hover:text-slate-300'
          }`}>
            {keyMissing ? <LockClosedIcon className="w-4 h-4 text-red-400" /> : 
             isCloud ? <CloudIcon className="w-4 h-4" /> : <CpuChipIcon className="w-4 h-4" />}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold truncate ${
                isSelected ? 'text-ubiq-accent' : keyMissing ? 'text-slate-400' : 'text-slate-200'
              }`}>
                {getDisplayName(model.name)}
              </span>
              {isSelected && <CheckIcon className="w-3.5 h-3.5 text-ubiq-accent" />}
            </div>
            
            <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
              <span className={`px-1.5 py-0.5 rounded ${isCloud ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                  {model.provider}
              </span>
              {model.parameter_size && model.parameter_size !== 'Unknown' && (
                  <span className="text-slate-600">{model.parameter_size}</span>
              )}
            </div>
          </div>
        </button>
      );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className="flex items-center gap-2 bg-ubiq-900 hover:bg-ubiq-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-medium transition-all text-slate-300 hover:text-white group min-w-[180px]"
        title="Change AI Model"
      >
        {loading ? (
           <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-ubiq-accent" />
        ) : currentModel?.provider !== 'Ollama' && currentModel?.provider !== 'Unknown' ? (
           <CloudIcon className="w-3.5 h-3.5 text-indigo-400" />
        ) : (
           <CpuChipIcon className="w-3.5 h-3.5 text-emerald-400" />
        )}
        
        <div className="flex flex-col items-start flex-1 min-w-0">
            <span className="truncate w-full text-left">{loading ? 'Switching...' : displayLabel}</span>
        </div>
        
        <ChevronUpIcon className={`w-3 h-3 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-80 bg-ubiq-950/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 animate-fade-in origin-bottom-left overflow-hidden ring-1 ring-black/50">
          
          <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex justify-between items-center">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <ServerIcon className="w-3 h-3" /> Select Model
            </h3>
            <span className="text-[10px] text-slate-500">{models.length} Ready</span>
          </div>
          
          <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-2 space-y-4">
            {models.length === 0 ? (
              <div className="px-4 py-8 text-sm text-slate-500 text-center flex flex-col items-center gap-2">
                  <ArrowPathIcon className="w-5 h-5 animate-spin"/> Loading available models...
              </div>
            ) : (
              <>
                {/* --- CLOUD MODELS GROUP --- */}
                {cloudModels.length > 0 && (
                    <div>
                        <div className="px-2 pb-1.5 pt-1 text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                            <BoltIcon className="w-3 h-3" /> Cloud Intelligence
                        </div>
                        <div className="space-y-1">
                            {cloudModels.map(m => <ModelOption key={m.name} model={m} />)}
                        </div>
                    </div>
                )}

                {/* --- LOCAL MODELS GROUP --- */}
                {localModels.length > 0 && (
                    <div className={cloudModels.length > 0 ? "pt-2 border-t border-white/5" : ""}>
                        <div className="px-2 pb-1.5 pt-2 text-[10px] font-bold text-emerald-500/80 uppercase tracking-wider flex items-center gap-1.5">
                            <CpuChipIcon className="w-3 h-3" /> Local Free Models
                        </div>
                        <div className="space-y-1">
                            {localModels.map(m => <ModelOption key={m.name} model={m} />)}
                        </div>
                    </div>
                )}
              </>
            )}
          </div>
          
          <div className="px-4 py-2 border-t border-white/5 bg-ubiq-900/50 text-[10px] text-slate-500 flex justify-between">
            <span>Server: <strong>Online</strong></span>
            <button onClick={() => navigate('/settings')} className="hover:text-white transition-colors">Manage Keys &rarr;</button>
          </div>
        </div>
      )}
    </div>
  );
}