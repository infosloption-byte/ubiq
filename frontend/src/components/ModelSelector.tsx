import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { aiAPI, userAPI, authAPI, aiKeysAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { 
  ChevronUpIcon, ChevronDownIcon, CheckIcon, CpuChipIcon, ArrowPathIcon, 
  CloudIcon, BoltIcon, ServerIcon, LockClosedIcon,
  Cog6ToothIcon 
} from '@heroicons/react/24/outline';

interface Model {
  name: string; 
  provider: string; 
  size?: string;
  parameter_size?: string;
}

interface ModelSelectorProps {
    aiMode: string; // 'cloud' or 'local'
    selectedModel: string;
    onSelectModel: (model: string) => void;
    menuPosition?: 'top' | 'bottom'; // NEW: Controls which way the dropdown opens
}

export default function ModelSelector({ aiMode, selectedModel, onSelectModel, menuPosition = 'top' }: ModelSelectorProps) {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const [models, setModels] = useState<Model[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  // D8 fix (PLAN_SYSTEM_TASKS.md Phase D): previously held the *raw* key
  // values read straight out of localStorage, just to check `!!value`. Now
  // holds only which providers are configured — fetched from the masked
  // backend endpoint, which never returns the actual secret at all. This
  // component never needed the real value, only a yes/no per provider.
  const [configuredProviders, setConfiguredProviders] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // D8 fix: fetches only which providers are configured (masked list),
  // reloaded every time the dropdown opens to catch changes made in
  // Settings since it was last opened — same refresh trigger as before.
  useEffect(() => {
    if (!isOpen) return;
    aiKeysAPI.list()
      .then(res => {
        const providers = new Set<string>((res.data?.keys || []).map((k: any) => k.provider));
        setConfiguredProviders(providers);
      })
      .catch(e => console.error('Failed to load AI key status', e));
  }, [isOpen]);

  // Fetch models whenever aiMode changes
  useEffect(() => {
    // Debounce: if the user toggles mode rapidly, only the last one fires
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Cancel any in-flight request from a previous mode
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = new AbortController();
      loadModels(abortRef.current.signal);
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [aiMode]);

  const loadModels = async (signal?: AbortSignal) => {
    setLoading(true);
    setModels([]);
    setOllamaError(null);

    try {
        if (aiMode === 'local' || aiMode === 'remote') {
            // --- OLLAMA FETCH (local or remote) ---
            // Always proxied through Laravel to avoid Mixed-Content HTTPS→HTTP block.
            const ollamaBase = aiMode === 'remote'
                ? (localStorage.getItem('ubiq_ollama_url') || '').trim()
                : (localStorage.getItem('ubiq_local_url') || 'http://localhost:11434').trim();

            if (aiMode === 'remote' && !ollamaBase) {
                setOllamaError('Remote Ollama URL not configured. Click the ⚙ gear icon to set it.');
                setLoading(false);
                return;
            }

            try {
                const apiUrl = import.meta.env.VITE_API_URL;
                const authRaw = localStorage.getItem('auth-storage');
                const token = authRaw ? (JSON.parse(authRaw)?.state?.token || '') :
                              (localStorage.getItem('auth_token') || localStorage.getItem('token') || '');
                const response = await axios.get(`${apiUrl}/ollama/tags`, {
                    params: { url: ollamaBase },
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    signal, // pass abort signal
                });

                if (response.data && Array.isArray(response.data.models)) {
                    const ollamaModels: Model[] = response.data.models.map((m: any) => ({
                        name: m.name,
                        provider: 'Ollama',
                        size: m.size ? `${(m.size / 1024 / 1024 / 1024).toFixed(1)}GB` : undefined,
                        parameter_size: m.details?.parameter_size || 'Unknown'
                    }));
                    setModels(ollamaModels);

                    if (ollamaModels.length > 0 && (!selectedModel || !ollamaModels.find(m => m.name === selectedModel))) {
                        onSelectModel(ollamaModels[0].name);
                    }
                }
            } catch (err: any) {
                const serverMsg = err?.response?.data?.error;
                const msg = serverMsg || (err instanceof Error ? err.message : String(err));
                console.error(`Failed to connect to ${aiMode} Ollama:`, msg);
                const hint = aiMode === 'remote'
                    ? `Cannot reach remote Ollama at ${ollamaBase}. Check the server is running and the port is open.`
                    : 'Cannot reach Ollama at localhost:11434. Make sure Ollama is running.';
                setOllamaError(hint);
                setModels([]);
            }
        } else {
            // --- CLOUD BACKEND FETCH ---
            const response = await aiAPI.getModels();
            if (response.data && Array.isArray(response.data.models)) {
                const cloudModels = response.data.models;
                setModels(cloudModels);

                const pref = user?.preferences?.preferred_model;
                if (pref && cloudModels.find((m: any) => m.name === pref)) {
                     if (!selectedModel) onSelectModel(pref);
                } else if (cloudModels.length > 0 && !selectedModel) {
                     onSelectModel(cloudModels[0].name);
                }
            }
        }
    } catch (error) {
      // AbortError means a newer request superseded this one — not an error
      if (axios.isCancel(error) || (error as any)?.name === 'AbortError') return;
      console.error('Failed to load models:', error);
      setModels([]);
    } finally {
        setLoading(false);
    }
  };

  const handleSelectClick = async (model: Model, keyMissing: boolean) => {
    // If key is missing, redirect to settings instead of selecting
    if (aiMode === 'cloud' && keyMissing) {
        setIsOpen(false);
        navigate('/settings');
        return;
    }

    onSelectModel(model.name);

    if (aiMode === 'cloud') {
        try {
            await userAPI.updatePreferences({ preferred_model: model.name });
            const meResponse = await authAPI.me();
            if (meResponse.data.user) setUser(meResponse.data.user);
        } catch (e) { console.error("Failed to save preference", e); }
    }
    
    setIsOpen(false);
  };

  const getDisplayName = (id: string) => {
      if (!id) return 'Select Model';
      const parts = id.split('/');
      return parts.length > 1 ? parts[parts.length - 1] : id; 
  };

  const displayLabel = getDisplayName(selectedModel || 'Select Model');
  const displayModels = models; 

  const isKeyMissing = (provider: string) => {
      if (aiMode === 'local') return false;
      // D8 fix: was `{ 'xAI': 'grok', ... }` — 'grok' was removed from the
      // settings UI (see SettingsPage.tsx D8 note) since it was never wired
      // to any backend provider support in CompletionController; there's no
      // key concept for it to check, so 'xAI' is intentionally left out of
      // this map now. Net effect for an 'xAI'-provider model (if one is
      // ever actually returned by aiAPI.getModels()) is unchanged from
      // before: it renders as "not missing" either way, since the old grok
      // field never gated anything real either.
      const keyMap: Record<string, string> = {
          'Mistral': 'mistral',
          'OpenRouter': 'openrouter',
          'Google': 'google'
      };
      const keyName = keyMap[provider];
      return !!keyName && !configuredProviders.has(keyName);
  };

  const ModelOption = ({ model }: { model: Model }) => {
      const isSelected = selectedModel === model.name;
      const isCloud = aiMode === 'cloud';
      const keyMissing = isCloud && isKeyMissing(model.provider);

      return (
        <button
          onClick={() => handleSelectClick(model, keyMissing)}
          disabled={loading}
          className={`w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors group relative ${
            isSelected 
                ? 'bg-ubiq-accent/10 border border-ubiq-accent/20' 
                : 'hover:bg-white/5 border border-transparent'
          } ${keyMissing ? 'opacity-80' : ''}`}
        >
          {/* Icon Status */}
          <div className={`p-1.5 rounded-md flex-shrink-0 ${
             keyMissing ? 'bg-red-500/10 text-red-400' : 
             isSelected ? 'bg-ubiq-accent text-white' : 'bg-ubiq-800 text-slate-400 group-hover:text-slate-300'
          }`}>
            {keyMissing ? <LockClosedIcon className="w-4 h-4" /> : 
             isCloud ? <CloudIcon className="w-4 h-4" /> : <CpuChipIcon className="w-4 h-4" />}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold truncate ${
                keyMissing ? 'text-slate-400' : isSelected ? 'text-ubiq-accent' : 'text-slate-200'
              }`}>
                {getDisplayName(model.name)}
              </span>
              {isSelected && !keyMissing && <CheckIcon className="w-3.5 h-3.5 text-ubiq-accent" />}
            </div>
            
            <div className="flex items-center justify-between mt-0.5">
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${isCloud ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                  {model.provider}
              </span>
              
              {/* ACTION CALL TO ACTION or SIZE */}
              {keyMissing ? (
                  <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded flex items-center gap-1 hover:bg-red-500/20 transition-colors">
                      Setup Key &rarr;
                  </span>
              ) : (
                  <span className="text-[10px] text-slate-600">
                      {model.parameter_size !== 'Unknown' ? model.parameter_size : model.size}
                  </span>
              )}
            </div>
          </div>
        </button>
      );
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
        className="w-full flex items-center justify-between gap-2 bg-ubiq-900 hover:bg-ubiq-800 border border-white/10 rounded-lg px-3 py-2 text-xs font-medium transition-all text-slate-300 hover:text-white group min-w-[180px]"
        title="Change AI Model"
      >
        <div className="flex items-center gap-2 overflow-hidden">
            {loading ? (
               <ArrowPathIcon className="w-3.5 h-3.5 animate-spin text-ubiq-accent shrink-0" />
            ) : aiMode === 'cloud' ? (
               <CloudIcon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            ) : (
               <CpuChipIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            )}
            
            <span className="truncate text-left">{loading ? 'Loading...' : displayLabel}</span>
        </div>
        
        {/* Dynamic Chevron based on menu position */}
        {menuPosition === 'top' ? (
            <ChevronUpIcon className={`w-3 h-3 shrink-0 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        ) : (
            <ChevronDownIcon className={`w-3 h-3 shrink-0 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {/* Dynamic Dropdown Menu Positioning */}
      {isOpen && (
        <div className={`absolute left-0 w-full min-w-[280px] bg-ubiq-950/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-[100] animate-fade-in overflow-hidden ring-1 ring-black/50 ${
            menuPosition === 'top' ? 'bottom-full mb-2 origin-bottom-left' : 'top-full mt-2 origin-top-left'
        }`}>
          
          <div className="px-4 py-3 border-b border-white/5 bg-white/5 flex justify-between items-center">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <ServerIcon className="w-3 h-3" /> Select Model
            </h3>
            <span className="text-[10px] text-slate-500">{models.length} Ready</span>
          </div>
          
          {/* Scrollable Model List */}
          <div className="max-h-[350px] overflow-y-auto custom-scrollbar p-2 space-y-1">
            {models.length === 0 ? (
              <div className="px-4 py-8 text-sm text-slate-500 text-center flex flex-col items-center gap-2">
                  {aiMode === 'local' ? (
                      ollamaError ? (
                          <>
                              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center mb-1">
                                  <ServerIcon className="w-4 h-4 text-red-400" />
                              </div>
                              <p className="text-red-400 font-medium text-xs">Ollama Not Reachable</p>
                              <p className="text-[10px] text-slate-500 max-w-[200px] leading-relaxed">{ollamaError}</p>
                              <code className="mt-1 bg-black/40 border border-white/10 px-2 py-1 rounded text-[10px] text-emerald-400">ollama serve</code>
                              <button onClick={loadModels} className="mt-2 flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
                                  <ArrowPathIcon className="w-3 h-3" /> Retry
                              </button>
                          </>
                      ) : (
                          <>
                              <p className="text-slate-400">No local models found</p>
                              <p className="text-[10px]">Pull a model first: <code className="bg-black/30 px-1 rounded">ollama pull llama3</code></p>
                          </>
                      )
                  ) : (
                      <><ArrowPathIcon className="w-5 h-5 animate-spin"/> Loading available models...</>
                  )}
              </div>
            ) : (
              <div>
                <div className={`px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${aiMode === 'cloud' ? 'text-indigo-400' : 'text-emerald-400'}`}>
                    {aiMode === 'cloud' ? <><BoltIcon className="w-3 h-3" /> Cloud Intelligence</> : <><CpuChipIcon className="w-3 h-3" /> Local Models</>}
                </div>
                <div className="space-y-1">
                    {displayModels.map(m => <ModelOption key={m.name} model={m} />)}
                </div>
              </div>
            )}
          </div>

          {/* Footer for Cloud Mode */}
          {aiMode === 'cloud' && (
              <div className="border-t border-white/5 bg-black/20 p-2">
                  <button 
                    onClick={() => { setIsOpen(false); navigate('/settings'); }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-slate-300 hover:text-white transition-colors"
                  >
                      <Cog6ToothIcon className="w-3.5 h-3.5" /> Configure API Keys
                  </button>
              </div>
          )}
        </div>
      )}
    </div>
  );
}