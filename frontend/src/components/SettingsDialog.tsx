import { useState, useEffect } from 'react';
import { X, Key, Eye, EyeOff, Save, ExternalLink, Sparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useNavigate } from 'react-router-dom';
import { aiKeysAPI } from '../services/api';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

// D8 fix (PLAN_SYSTEM_TASKS.md Phase D): same provider list as
// SettingsPage.tsx's AI_KEY_PROVIDERS — `grok` dropped (never wired to any
// backend support), no `openai` field added (pre-existing gap, not this
// fix's job to add). Kept as a plain array here rather than importing from
// SettingsPage.tsx since that page isn't set up as a shared module today —
// if a third consumer needs this list, that's the point to extract it.
const AI_KEY_PROVIDERS: Array<'openrouter' | 'mistral' | 'google'> = ['openrouter', 'mistral', 'google'];

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // D8 fix: `configuredKeys` is masked-only, fetched from the server;
  // `keyInputs` is draft text only, never pre-filled with a real secret.
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, { masked: string }>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({ openrouter: '', mistral: '', google: '' });
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setKeyInputs({ openrouter: '', mistral: '', google: '' });
      aiKeysAPI.list()
        .then(res => {
          const byProvider: Record<string, { masked: string }> = {};
          (res.data?.keys || []).forEach((k: any) => { byProvider[k.provider] = k; });
          setConfiguredKeys(byProvider);
        })
        .catch(e => console.error('Failed to load AI key status', e));
    }
  }, [isOpen]);

  // D8 fix: previously a single localStorage.setItem of the whole `keys`
  // object. Now PUTs only the providers with a non-empty draft value —
  // fields the user didn't touch stay exactly as they were server-side.
  const handleSave = async () => {
    const toSave = Object.entries(keyInputs).filter(([, value]) => value.trim().length > 0);
    if (toSave.length === 0) { onClose(); return; }

    setSaving(true);
    try {
      await Promise.all(
        toSave.map(([provider, value]) => aiKeysAPI.update(provider as 'openrouter' | 'mistral' | 'google', value.trim()))
      );
      onClose();
    } catch (e) {
      console.error('Failed to save AI keys', e);
      alert('Failed to save one or more keys. Double-check the value and try again.');
    } finally {
      setSaving(false);
    }
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
            {/* D8 fix: was "Keys are stored in your browser's LocalStorage" —
                no longer true. Encrypted server-side now; never sent back
                to the browser after saving. */}
            <strong>Privacy:</strong> Keys are encrypted and stored on our servers — never sent back to your browser after you save them.
          </div>

          {AI_KEY_PROVIDERS.map((id) => {
            const existing = configuredKeys[id];
            return (
              <div key={id}>
                <div className="flex justify-between items-end mb-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{id}</label>
                    {existing && <span className="text-[10px] text-slate-500 font-mono">{existing.masked}</span>}
                </div>
                <div className="relative">
                  <input 
                    type={showKey[id] ? "text" : "password"} 
                    className="w-full bg-[#050509] border border-white/10 rounded-lg py-2 pl-3 pr-10 text-xs text-slate-200 focus:border-indigo-500 outline-none font-mono"
                    value={keyInputs[id] ?? ''}
                    placeholder={existing ? "Enter a new key to replace it" : ""}
                    onChange={(e) => setKeyInputs({...keyInputs, [id]: e.target.value})}
                  />
                  <button onClick={() => setShowKey(p => ({...p, [id]: !p[id]}))} className="absolute right-3 top-2 text-slate-500 hover:text-slate-300">
                    {showKey[id] ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3 bg-[#050509]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-400 hover:text-white">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60">
            {saving ? 'Saving…' : 'Save Keys'}
          </button>
        </div>
      </div>
    </div>
  );
}