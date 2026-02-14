import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../stores/authStore';
import { userAPI, authAPI } from '../services/api';
import { 
  User, Key, Monitor, Save, 
  CheckCircle2, AlertCircle, Loader2,
  Eye, EyeOff, BarChart3, CreditCard
} from 'lucide-react';

export default function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'general' | 'editor' | 'ai' | 'usage'>('ai');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // --- BYOK STATE (LocalStorage) ---
  const [apiKeys, setApiKeys] = useState({
    openrouter: '',
    grok: '',
    mistral: '',
    google: ''
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  // --- EDITOR PREFS STATE (Database) ---
  const [editorSettings, setEditorSettings] = useState({
    fontSize: 14,
    theme: 'vs-dark',
    wordWrap: 'on',
    minimap: true,
    formatOnSave: true,
    code_suggestions: true
  });

  useEffect(() => {
    // 1. Load Keys from Browser Storage
    const storedKeys = localStorage.getItem('ubiq_api_keys');
    if (storedKeys) {
        try { setApiKeys({ ...apiKeys, ...JSON.parse(storedKeys) }); } catch (e) {}
    }

    // 2. Load Editor Prefs from User Object
    if (user?.preferences) {
        const prefs = user.preferences.editor_settings || {};
        setEditorSettings(prev => ({
            ...prev,
            fontSize: prefs.fontSize || 14,
            wordWrap: prefs.wordWrap || 'on',
            minimap: prefs.minimap?.enabled !== false, 
            formatOnSave: prefs.formatOnSave !== false,
            code_suggestions: user.preferences.code_suggestions !== false
        }));
    }
  }, [user]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleSaveKeys = () => {
    setSaving(true);
    setTimeout(() => {
        localStorage.setItem('ubiq_api_keys', JSON.stringify(apiKeys));
        showSuccess("API Keys saved securely to browser.");
        setSaving(false);
    }, 500);
  };

  const handleSaveEditor = async () => {
    setSaving(true);
    try {
        await userAPI.updatePreferences({
            code_suggestions: editorSettings.code_suggestions,
            editor_settings: {
                fontSize: Number(editorSettings.fontSize),
                wordWrap: editorSettings.wordWrap,
                minimap: { enabled: editorSettings.minimap },
                formatOnSave: editorSettings.formatOnSave
            }
        });
        // Refresh User Store to apply changes immediately
        const res = await authAPI.me();
        if (res.data.user) setUser(res.data.user);
        showSuccess("Editor preferences synced to cloud.");
    } catch (e) {
        alert("Failed to save settings");
    } finally {
        setSaving(false);
    }
  };

  const toggleKeyVisibility = (provider: string) => {
    setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  // --- SUB COMPONENTS ---
  const TabButton = ({ id, label, icon: Icon }: any) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all rounded-lg ${
        activeTab === id
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20'
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  const KeyInput = ({ id, label, link }: any) => (
    <div className="group">
        <div className="flex justify-between items-baseline mb-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wide group-hover:text-indigo-400 transition-colors">{label}</label>
            <a href={link} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-500 hover:text-indigo-300 hover:underline">Get Key ↗</a>
        </div>
        <div className="relative">
            <input 
                type={showKeys[id] ? "text" : "password"} 
                value={apiKeys[id as keyof typeof apiKeys]}
                onChange={(e) => setApiKeys({...apiKeys, [id]: e.target.value})}
                placeholder="sk-..."
                className="w-full bg-[#050509] border border-white/10 rounded-lg pl-3 pr-10 py-2.5 text-sm text-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none font-mono transition-all"
            />
            <button 
                onClick={() => toggleKeyVisibility(id)}
                className="absolute right-3 top-2.5 text-slate-500 hover:text-white transition-colors"
            >
                {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
        </div>
    </div>
  );

  if (!user && loading) return <Layout><div className="flex h-full items-center justify-center text-slate-500"><Loader2 className="animate-spin w-6 h-6"/></div></Layout>;

  return (
    <Layout>
      <div className="min-h-full bg-ubiq-950 p-6 md:p-12 text-slate-300">
        <div className="max-w-5xl mx-auto">
          
          <h1 className="text-3xl font-bold text-white mb-8">Settings</h1>

          <div className="flex flex-col md:flex-row gap-8">
            
            {/* Sidebar Tabs */}
            <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
              <TabButton id="ai" label="AI Models (BYOK)" icon={Key} />
              <TabButton id="editor" label="Editor Config" icon={Monitor} />
              <TabButton id="general" label="Account" icon={User} />
              <TabButton id="usage" label="Usage Stats" icon={BarChart3} />
            </div>

            {/* Main Content Panel */}
            <div className="flex-1 bg-[#0B0B10] border border-white/10 rounded-xl p-6 md:p-8 relative min-h-[500px]">
              
              {/* Success Toast */}
              {successMsg && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-green-500/10 text-green-400 px-4 py-2 rounded-lg text-xs font-bold border border-green-500/20 animate-fade-in z-20">
                    <CheckCircle2 className="w-4 h-4" /> {successMsg}
                </div>
              )}

              {/* --- AI MODELS TAB --- */}
              {activeTab === 'ai' && (
                <div className="space-y-8 animate-fade-in">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">Manage API Keys</h2>
                        <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
                            <h3 className="text-blue-400 font-bold text-sm mb-1 flex items-center gap-2"><Key className="w-4 h-4"/> Bring Your Own Key</h3>
                            <p className="text-xs text-slate-400 leading-relaxed">
                                Keys are stored <strong>locally in your browser</strong> (LocalStorage). They are sent directly to the model provider via our secure proxy. We never store them in our database.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-5">
                        <KeyInput id="openrouter" label="OpenRouter (Recommended)" link="https://openrouter.ai/keys" />
                        <KeyInput id="mistral" label="Mistral AI" link="https://console.mistral.ai/" />
                        <KeyInput id="google" label="Google Gemini" link="https://aistudio.google.com/app/apikey" />
                        <KeyInput id="grok" label="xAI (Grok)" link="https://console.x.ai/" />
                    </div>

                    <div className="pt-6 border-t border-white/5">
                        <button onClick={handleSaveKeys} disabled={saving} className="btn-primary flex items-center gap-2 px-6">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />} 
                            Save Keys Locally
                        </button>
                    </div>
                </div>
              )}

              {/* --- EDITOR TAB --- */}
              {activeTab === 'editor' && (
                <div className="space-y-8 animate-fade-in">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">Editor Preferences</h2>
                        <p className="text-sm text-slate-400">Settings sync across your devices.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Font Size</label>
                            <div className="flex items-center gap-4 bg-white/5 p-3 rounded-lg border border-white/5">
                                <span className="text-white font-mono">{editorSettings.fontSize}px</span>
                                <input 
                                    type="range" min="10" max="24" step="1"
                                    value={editorSettings.fontSize} 
                                    onChange={(e) => setEditorSettings({...editorSettings, fontSize: Number(e.target.value)})}
                                    className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Word Wrap</label>
                            <select 
                                value={editorSettings.wordWrap} 
                                onChange={(e) => setEditorSettings({...editorSettings, wordWrap: e.target.value})}
                                className="w-full bg-[#050509] border border-white/10 rounded-lg px-3 py-3 text-sm text-white focus:border-indigo-500 outline-none"
                            >
                                <option value="on">On</option>
                                <option value="off">Off</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:border-indigo-500/30 transition-colors cursor-pointer">
                            <span className="text-sm text-slate-300">Show Minimap</span>
                            <input 
                                type="checkbox" 
                                checked={editorSettings.minimap}
                                onChange={(e) => setEditorSettings({...editorSettings, minimap: e.target.checked})}
                                className="w-4 h-4 rounded border-white/20 bg-black/30 text-indigo-500 focus:ring-offset-0"
                            />
                        </label>
                        <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:border-indigo-500/30 transition-colors cursor-pointer">
                            <span className="text-sm text-slate-300">Format on Save</span>
                            <input 
                                type="checkbox" 
                                checked={editorSettings.formatOnSave}
                                onChange={(e) => setEditorSettings({...editorSettings, formatOnSave: e.target.checked})}
                                className="w-4 h-4 rounded border-white/20 bg-black/30 text-indigo-500 focus:ring-offset-0"
                            />
                        </label>
                        <label className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:border-indigo-500/30 transition-colors cursor-pointer">
                            <div>
                                <span className="block text-sm text-slate-300">AI Ghost Text</span>
                                <span className="text-[10px] text-slate-500">Show inline completions while typing</span>
                            </div>
                            <input 
                                type="checkbox" 
                                checked={editorSettings.code_suggestions}
                                onChange={(e) => setEditorSettings({...editorSettings, code_suggestions: e.target.checked})}
                                className="w-4 h-4 rounded border-white/20 bg-black/30 text-indigo-500 focus:ring-offset-0"
                            />
                        </label>
                    </div>

                    <div className="pt-6 border-t border-white/5">
                        <button onClick={handleSaveEditor} disabled={saving} className="btn-primary flex items-center gap-2 px-6">
                            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />} 
                            Sync Preferences
                        </button>
                    </div>
                </div>
              )}

              {/* --- ACCOUNT TAB --- */}
              {activeTab === 'general' && (
                <div className="space-y-8 animate-fade-in">
                    <div>
                        <h2 className="text-xl font-bold text-white mb-2">Account</h2>
                        <p className="text-sm text-slate-400">Manage your profile.</p>
                    </div>
                    <div className="p-6 bg-white/5 rounded-xl border border-white/10 flex items-center gap-6">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-2xl font-bold text-white shadow-xl">
                            {user?.username?.[0].toUpperCase()}
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-white">{user?.username}</h3>
                            <p className="text-sm text-slate-400">{user?.email}</p>
                            <div className="mt-3 flex gap-2">
                                <span className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-300 text-xs border border-indigo-500/30 uppercase font-bold flex items-center gap-1">
                                    <CreditCard className="w-3 h-3"/> {user?.subscription_tier} Plan
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
              )}

              {/* --- USAGE TAB --- */}
              {activeTab === 'usage' && (
                 <div className="flex flex-col items-center justify-center h-64 text-center animate-fade-in">
                    <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                        <BarChart3 className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-white font-medium mb-1">Detailed Analytics</h3>
                    <p className="text-slate-500 text-sm max-w-xs">
                        We are building a breakdown of your token usage and latency. Check back soon.
                    </p>
                 </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}