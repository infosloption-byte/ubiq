import { useState, useEffect, useRef } from 'react';
import { aiAPI, userAPI, authAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { ChevronUpIcon, CheckIcon, CpuChipIcon, ArrowPathIcon } from '@heroicons/react/24/outline';

interface Model {
  id: string;
  name: string;
  display_name: string;
  size: string;
  parameter_size?: string;
}

export default function ModelSelector() {
  const { user, setUser } = useAuthStore();
  const [models, setModels] = useState<Model[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
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
  }, []);

  const loadModels = async () => {
    try {
      const response = await aiAPI.getModels();
      setModels(response.data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    if (loading) return;
    setLoading(true);
    
    try {
      await userAPI.updatePreferences({ preferred_model: modelId });
      
      // Fetch fresh user data to ensure authStore is in sync
      const meResponse = await authAPI.me();
      
      if (meResponse.data.user) {
        setUser(meResponse.data.user);
      }

      setIsOpen(false);
    } catch (error) {
      console.error('Failed to update model preference:', error);
    } finally {
      setLoading(false);
    }
  };

  // Determine current display name safely
  const currentModelId = user?.preferences?.preferred_model;
  const currentModel = models.find(m => m.id === currentModelId) || models[0];
  const displayName = currentModel ? currentModel.display_name : (currentModelId || 'Select Model');

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all text-slate-300 hover:text-white group"
        title="Change AI Model"
      >
        {loading ? (
           <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-ubiq-accent" />
        ) : (
           <CpuChipIcon className="w-3.5 h-3.5 text-ubiq-accent" />
        )}
        
        <span className="max-w-[120px] truncate">
          {loading ? 'Switching...' : displayName}
        </span>
        
        <ChevronUpIcon className={`w-3 h-3 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu (Fixed: Opens Upwards) */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-3 w-72 bg-ubiq-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 animate-fade-in origin-bottom-left overflow-hidden">
          
          <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex justify-between items-center">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select AI Model</h3>
            <span className="text-[10px] text-slate-500">{models.length} Available</span>
          </div>
          
          <div className="max-h-[250px] overflow-y-auto custom-scrollbar p-1">
            {models.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-500 text-center">Loading models...</div>
            ) : (
              models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => handleSelectModel(model.id)}
                  disabled={loading}
                  className={`w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition-colors ${
                    currentModelId === model.id
                      ? 'bg-ubiq-accent/10 border border-ubiq-accent/20'
                      : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className={`mt-0.5 p-1 rounded-md ${
                     currentModelId === model.id ? 'bg-ubiq-accent text-white' : 'bg-ubiq-800 text-slate-400'
                  }`}>
                    <CpuChipIcon className="w-3.5 h-3.5" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className={`text-xs font-semibold truncate ${
                        currentModelId === model.id ? 'text-ubiq-accent' : 'text-slate-200'
                      }`}>
                        {model.display_name}
                      </span>
                      {currentModelId === model.id && (
                        <CheckIcon className="w-3.5 h-3.5 text-ubiq-accent" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span>{model.parameter_size || 'Unknown'} Params</span>
                      <span className="w-0.5 h-0.5 rounded-full bg-slate-700" />
                      <span>{model.size}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
          
          <div className="px-4 py-2 border-t border-white/5 bg-ubiq-950/50 text-[10px] text-slate-500 text-center">
            Powered by Local Ollama
          </div>
        </div>
      )}
    </div>
  );
}