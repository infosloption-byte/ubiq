import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../stores/authStore';
import { userAPI } from '../services/api';
import { 
  UserCircleIcon, 
  CommandLineIcon, 
  ChartBarIcon, 
  KeyIcon, // New Icon
  EyeIcon, 
  EyeSlashIcon 
} from '@heroicons/react/24/outline';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'general' | 'editor' | 'usage' | 'ai'>('general');
  const [preferences, setPreferences] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // --- BYOK State ---
  const [apiKeys, setApiKeys] = useState({
    openrouter: '',
    grok: '',
    mistral: '',
    google: ''
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
    loadApiKeys(); // Load keys from local storage
  }, []);

  const loadData = async () => {
    try {
      const res = await userAPI.getPreferences();
      setPreferences(res.data.preferences);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadApiKeys = () => {
    const stored = localStorage.getItem('ubiq_api_keys');
    if (stored) {
      try {
        setApiKeys(JSON.parse(stored));
      } catch (e) { console.error("Failed to parse keys", e); }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Save Backend Preferences
      if (preferences) {
        await userAPI.updatePreferences(preferences);
      }
      
      // 2. Save Local API Keys
      localStorage.setItem('ubiq_api_keys', JSON.stringify(apiKeys));

      setMsg('Settings saved successfully');
      setTimeout(() => setMsg(''), 3000);
    } catch (e) {
      setMsg('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleKeyVisibility = (provider: string) => {
    setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  const TabButton = ({ id, label, icon: Icon }: any) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex items-center gap-2 px-6 py-3 text-sm font-medium transition-all border-b-2 ${
        activeTab === id
          ? 'border-ubiq-accent text-ubiq-accent'
          : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  if (loading) return <Layout><div className="p-10 text-center text-slate-500">Loading settings...</div></Layout>;

  const providers = [
    { id: 'openrouter', label: 'OpenRouter (Claude/GPT)', link: 'https://openrouter.ai/keys' },
    { id: 'grok', label: 'xAI (Grok)', link: 'https://console.x.ai/' },
    { id: 'mistral', label: 'Mistral AI', link: 'https://console.mistral.ai/' },
    { id: 'google', label: 'Google Gemini', link: 'https://aistudio.google.com/app/apikey' },
  ];

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-2xl font-bold text-white mb-8">Settings</h1>

        {/* Tabs */}
        <div className="flex border-b border-ubiq-800 mb-8 overflow-x-auto">
          <TabButton id="general" label="General" icon={UserCircleIcon} />
          <TabButton id="editor" label="Editor" icon={CommandLineIcon} />
          <TabButton id="ai" label="AI Models" icon={KeyIcon} /> {/* NEW TAB */}
          <TabButton id="usage" label="Usage" icon={ChartBarIcon} />
        </div>

        {/* Content */}
        <div className="space-y-6">
          {msg && (
            <div className={`p-3 rounded-lg text-sm text-center border ${msg.includes('Error') ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20'}`}>
              {msg}
            </div>
          )}

          {/* --- GENERAL TAB --- */}
          {activeTab === 'general' && (
            <div className="glass-panel p-6 rounded-xl space-y-6">
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Username</label>
                <div className="mt-1 text-white font-medium bg-ubiq-950/50 p-3 rounded-lg border border-ubiq-800">
                  {user?.username}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wide">Subscription</label>
                <div className="mt-1 flex items-center gap-2">
                   <span className="px-3 py-1 rounded bg-ubiq-accent/20 text-ubiq-accent text-sm font-bold border border-ubiq-accent/30 uppercase">
                     {user?.subscription_tier}
                   </span>
                </div>
              </div>
            </div>
          )}

          {/* --- EDITOR TAB --- */}
          {activeTab === 'editor' && preferences && (
            <div className="glass-panel p-6 rounded-xl space-y-8">
               <div className="flex items-center justify-between">
                 <div>
                   <h3 className="text-white font-medium">Font Size</h3>
                   <p className="text-slate-500 text-xs">Control the size of the text in the editor</p>
                 </div>
                 <div className="flex items-center gap-3">
                   <span className="text-slate-300 font-mono text-sm">{preferences.editor_settings.fontSize}px</span>
                   <input 
                     type="range" min="10" max="24" 
                     value={preferences.editor_settings.fontSize}
                     onChange={(e) => setPreferences({...preferences, editor_settings: {...preferences.editor_settings, fontSize: parseInt(e.target.value)}})}
                     className="accent-ubiq-accent"
                   />
                 </div>
               </div>

               <div className="flex items-center justify-between border-t border-ubiq-800 pt-6">
                 <div>
                   <h3 className="text-white font-medium">AI Autocomplete</h3>
                   <p className="text-slate-500 text-xs">Show AI suggestions while you type</p>
                 </div>
                 <button 
                   onClick={() => setPreferences({...preferences, code_suggestions: !preferences.code_suggestions})}
                   className={`w-12 h-6 rounded-full p-1 transition-colors ${preferences.code_suggestions ? 'bg-ubiq-accent' : 'bg-ubiq-800'}`}
                 >
                   <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-transform ${preferences.code_suggestions ? 'translate-x-6' : 'translate-x-0'}`} />
                 </button>
               </div>
               
               <div className="pt-4">
                 <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
                   {saving ? 'Saving...' : 'Save Changes'}
                 </button>
               </div>
            </div>
          )}

          {/* --- AI MODELS TAB (NEW) --- */}
          {activeTab === 'ai' && (
            <div className="glass-panel p-6 rounded-xl space-y-6">
                <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
                    <h3 className="text-blue-400 font-bold text-sm mb-1">Bring Your Own Key (BYOK)</h3>
                    <p className="text-xs text-slate-400">
                        Add your personal API keys to access premium cloud models. 
                        Keys are stored <strong>locally in your browser</strong> and are never saved to our database.
                    </p>
                </div>

                <div className="space-y-5">
                    {providers.map((p) => (
                        <div key={p.id}>
                            <div className="flex justify-between items-end mb-1.5">
                                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wide">{p.label}</label>
                                <a href={p.link} target="_blank" rel="noreferrer" className="text-[10px] text-ubiq-accent hover:underline">Get Key ↗</a>
                            </div>
                            <div className="relative">
                                <input 
                                    type={showKeys[p.id] ? "text" : "password"} 
                                    placeholder={`sk-...`}
                                    className="input-primary w-full text-xs font-mono pr-10"
                                    value={apiKeys[p.id as keyof typeof apiKeys]}
                                    onChange={(e) => setApiKeys({...apiKeys, [p.id]: e.target.value})}
                                />
                                <button 
                                    onClick={() => toggleKeyVisibility(p.id)}
                                    className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 transition-colors"
                                >
                                    {showKeys[p.id] ? <EyeSlashIcon className="w-4 h-4"/> : <EyeIcon className="w-4 h-4"/>}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="pt-4 border-t border-ubiq-800">
                    <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
                        {saving ? 'Saving Keys...' : 'Save API Keys'}
                    </button>
                </div>
            </div>
          )}
          
          {/* --- USAGE TAB --- */}
          {activeTab === 'usage' && (
             <div className="glass-panel p-12 text-center rounded-xl">
                <ChartBarIcon className="w-12 h-12 text-ubiq-accent mx-auto mb-4 opacity-50" />
                <h3 className="text-white font-medium">Usage Statistics</h3>
                <p className="text-slate-500 text-sm mt-1">Detailed usage metrics coming in the next update.</p>
             </div>
          )}
        </div>
      </div>
    </Layout>
  );
}