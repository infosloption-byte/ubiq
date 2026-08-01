import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuthStore } from '../stores/authStore';
import { userAPI, authAPI, subscriptionApi } from '../services/api';
import PricingCard from '../components/PricingCard';
import StorageUsage from '../components/StorageUsage';
import PlanUsageWidget from '../components/PlanUsageWidget';
import { 
  User, Key, Monitor, Save, 
  CheckCircle2, Loader2,
  Eye, EyeOff, CreditCard, Calendar, Clock,
  ShieldCheck, AlertTriangle, XCircle
} from 'lucide-react';

export default function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'ai' | 'editor' | 'billing' | 'general'>('ai');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const [apiKeys, setApiKeys] = useState({ openrouter: '', grok: '', mistral: '', google: '' });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [editorSettings, setEditorSettings] = useState({
    fontSize: 14, theme: 'vs-dark', wordWrap: 'on',
    minimap: true, formatOnSave: true, code_suggestions: true
  });

  // ── Derived subscription state ─────────────────────────────────────────────
  const isTrialing  = user?.subscription_tier === 'pro' && user?.subscription_status === 'trialing';
  const isActive    = user?.subscription_tier === 'pro' && user?.subscription_status === 'active';
  const isPastDue   = user?.subscription_tier === 'pro' && user?.subscription_status === 'past_due';
  const isPro       = isTrialing || isActive || isPastDue;
  const isCanceled  = user?.subscription_status === 'canceled';

  const trialEndsAt = user?.trial_ends_at
    ? new Date(user.trial_ends_at) : null;
  const subEndsAt = (user as any)?.subscription_ends_at
    ? new Date((user as any).subscription_ends_at) : null;

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000))
    : 0;

  useEffect(() => {
    const storedKeys = localStorage.getItem('ubiq_api_keys');
    if (storedKeys) {
      try { setApiKeys(prev => ({ ...prev, ...JSON.parse(storedKeys) })); } catch (e) {}
    }
    if (user?.preferences) {
      const prefs = user.preferences.editor_settings || {};
      setEditorSettings({
        fontSize: prefs.fontSize || 14,
        theme: prefs.theme || 'vs-dark',
        wordWrap: prefs.wordWrap || 'on',
        minimap: prefs.minimap?.enabled !== false,
        formatOnSave: prefs.formatOnSave !== false,
        code_suggestions: user.preferences.code_suggestions !== false
      });
    }
  }, [user]);

  // ── Check for ?tab=billing in URL (e.g. from Sidebar UPGRADE link) ─────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'billing') setActiveTab('billing');
  }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleCancel = async () => {
    if (!window.confirm("Are you sure? You'll keep Pro access until the end of your current billing period.")) return;
    setSaving(true);
    try {
      // PayPal has no self-serve customer portal like Paddle — cancellation
      // goes straight through our own API, which calls PayPal's Subscriptions
      // API server-side.
      const response = await subscriptionApi.cancelSubscription();
      if (response.data?.user) setUser(response.data.user);
      showSuccess("Subscription canceled. You'll keep Pro access until the end of your current billing period.");
    } catch (error) {
      alert("Failed to cancel subscription. Please contact support.");
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshStatus = async () => {
    setSaving(true);
    try {
      const res = await authAPI.me();
      if (res.data.user) setUser(res.data.user);
      showSuccess("Subscription status refreshed.");
    } catch (e) {
      alert("Failed to refresh status.");
    } finally {
      setSaving(false);
    }
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
      const res = await authAPI.me();
      if (res.data.user) setUser(res.data.user);
      showSuccess("Editor preferences synced to cloud.");
    } catch (e) {
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

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
        <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">{label}</label>
        <a href={link} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-500 hover:text-indigo-300 hover:underline">Get Key ↗</a>
      </div>
      <div className="relative">
        <input
          type={showKeys[id] ? "text" : "password"}
          value={apiKeys[id as keyof typeof apiKeys]}
          onChange={(e) => setApiKeys({ ...apiKeys, [id]: e.target.value })}
          placeholder="sk-..."
          className="w-full bg-[#050509] border border-white/10 rounded-lg pl-3 pr-10 py-2.5 text-sm text-slate-200 focus:border-indigo-500 outline-none font-mono transition-all"
        />
        <button onClick={() => setShowKeys(prev => ({ ...prev, [id]: !prev[id] }))}
          className="absolute right-3 top-2.5 text-slate-500 hover:text-white transition-colors">
          {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  // ── Billing Section subcomponents ──────────────────────────────────────────
  const ProStatusBadge = () => {
    if (isTrialing) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300 text-[10px] font-bold uppercase border border-blue-500/25">
        <Clock className="w-3 h-3" /> Trial Active
      </span>
    );
    if (isActive) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/15 text-green-300 text-[10px] font-bold uppercase border border-green-500/25">
        <ShieldCheck className="w-3 h-3" /> Active
      </span>
    );
    if (isPastDue) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-300 text-[10px] font-bold uppercase border border-yellow-500/25">
        <AlertTriangle className="w-3 h-3" /> Payment Due
      </span>
    );
    if (isCanceled) return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/15 text-red-300 text-[10px] font-bold uppercase border border-red-500/25">
        <XCircle className="w-3 h-3" /> Canceled
      </span>
    );
    return null;
  };

  return (
    <Layout>
      <div className="overflow-y-auto bg-ubiq-950 p-6 md:p-12 text-slate-300">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-8">Settings</h1>

          <div className="flex flex-col md:flex-row gap-8">
            <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
              <TabButton id="ai"      label="AI Models (BYOK)"  icon={Key} />
              <TabButton id="editor"  label="Editor Config"      icon={Monitor} />
              <TabButton id="billing" label="Billing & Plan"     icon={CreditCard} />
              <TabButton id="general" label="Account"            icon={User} />
            </div>

            <div className="flex-1 bg-[#0B0B10] border border-white/10 rounded-xl p-6 md:p-8 relative min-h-[550px]">

              {successMsg && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-green-500/10 text-green-400 px-4 py-2 rounded-lg text-xs font-bold border border-green-500/20 z-20">
                  <CheckCircle2 className="w-4 h-4" /> {successMsg}
                </div>
              )}

              {/* ── AI MODELS TAB ─────────────────────────────────────────── */}
              {activeTab === 'ai' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-2">Manage API Keys</h2>
                    <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
                      <h3 className="text-blue-400 font-bold text-sm mb-1 flex items-center gap-2"><Key className="w-4 h-4"/> Bring Your Own Key</h3>
                      <p className="text-xs text-slate-400 leading-relaxed">Keys are stored locally in your browser for AI features.</p>
                    </div>
                  </div>
                  <div className="space-y-5">
                    <KeyInput id="openrouter" label="OpenRouter"   link="https://openrouter.ai/keys" />
                    <KeyInput id="mistral"    label="Mistral AI"   link="https://console.mistral.ai/" />
                    <KeyInput id="google"     label="Google Gemini" link="https://aistudio.google.com/app/apikey" />
                    <KeyInput id="grok"       label="xAI (Grok)"   link="https://console.x.ai/" />
                  </div>
                  <div className="pt-6 border-t border-white/5">
                    <button onClick={handleSaveKeys} disabled={saving} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-all">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Keys Locally
                    </button>
                  </div>
                </div>
              )}

              {/* ── EDITOR TAB ────────────────────────────────────────────── */}
              {activeTab === 'editor' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-2">Editor Preferences</h2>
                    <p className="text-sm text-slate-400">Personalize your coding experience across all projects.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Font Size</label>
                      <div className="flex items-center gap-4 bg-white/5 p-3 rounded-lg border border-white/5">
                        <span className="text-white font-mono w-10">{editorSettings.fontSize}px</span>
                        <input type="range" min="10" max="24" value={editorSettings.fontSize}
                          onChange={(e) => setEditorSettings({ ...editorSettings, fontSize: Number(e.target.value) })}
                          className="w-full accent-indigo-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Word Wrap</label>
                      <select value={editorSettings.wordWrap}
                        onChange={(e) => setEditorSettings({ ...editorSettings, wordWrap: e.target.value })}
                        className="w-full bg-[#050509] border border-white/10 rounded-lg px-3 py-3 text-sm text-white focus:border-indigo-500 outline-none">
                        <option value="on">On</option>
                        <option value="off">Off</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      { label: 'Show Minimap',       key: 'minimap' },
                      { label: 'Format on Save',     key: 'formatOnSave' },
                      { label: 'AI Code Suggestions', key: 'code_suggestions', sub: 'Ghost text completions' }
                    ].map((item) => (
                      <label key={item.key} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 hover:border-indigo-500/30 cursor-pointer">
                        <div>
                          <span className="block text-sm text-slate-300">{item.label}</span>
                          {item.sub && <span className="text-[10px] text-slate-500">{item.sub}</span>}
                        </div>
                        <input type="checkbox" checked={(editorSettings as any)[item.key]}
                          onChange={(e) => setEditorSettings({ ...editorSettings, [item.key]: e.target.checked })}
                          className="w-4 h-4 rounded border-white/20 bg-black/30 text-indigo-500 focus:ring-0" />
                      </label>
                    ))}
                  </div>
                  <div className="pt-6 border-t border-white/5">
                    <button onClick={handleSaveEditor} disabled={saving} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-all">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Sync Preferences
                    </button>
                  </div>
                </div>
              )}

              {/* ── BILLING TAB ───────────────────────────────────────────── */}
              {activeTab === 'billing' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1">Billing & Plan</h2>
                    <p className="text-sm text-slate-400">Manage your subscription and billing details.</p>
                  </div>

                  {/* ── Status Cards ── */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Plan card */}
                    <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Current Plan</p>
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-2xl font-black text-white capitalize">
                          {isPro ? 'Pro' : 'Free'}
                        </h3>
                        <ProStatusBadge />
                      </div>

                      {/* Trial info */}
                      {isTrialing && trialEndsAt && (
                        <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                          <div className="flex items-center gap-2 text-blue-300 text-xs font-bold mb-1">
                            <Clock className="w-3.5 h-3.5" />
                            Trial Period
                          </div>
                          <p className="text-white font-bold text-lg">{trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining</p>
                          <p className="text-slate-400 text-xs mt-1">
                            Ends {trialEndsAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="text-slate-500 text-[11px] mt-2">
                            After trial ends, you'll be charged $9.00/month automatically unless you cancel.
                          </p>
                        </div>
                      )}

                      {/* Active subscription info */}
                      {isActive && subEndsAt && (
                        <div className="mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                          <div className="flex items-center gap-2 text-green-300 text-xs font-bold mb-1">
                            <Calendar className="w-3.5 h-3.5" />
                            Next Billing Date
                          </div>
                          <p className="text-white text-sm">
                            {subEndsAt.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}
                          </p>
                          <p className="text-slate-400 text-xs mt-1">$9.00/month · Renews automatically</p>
                        </div>
                      )}

                      {/* Past due warning */}
                      {isPastDue && (
                        <div className="mt-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                          <p className="text-yellow-300 text-xs font-bold mb-1">⚠️ Payment Failed</p>
                          <p className="text-slate-400 text-xs">PayPal will retry the payment automatically. Update your payment method on PayPal to avoid interruption.</p>
                        </div>
                      )}

                      {/* Canceled notice */}
                      {isCanceled && subEndsAt && (
                        <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                          <p className="text-red-300 text-xs font-bold mb-1">Subscription Canceled</p>
                          <p className="text-slate-400 text-xs">
                            Pro access until {subEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                      )}
                    </div>

                    <StorageUsage />
                    <div className="mt-4">
                      <PlanUsageWidget />
                    </div>
                  </div>

                  {/* ── Upgrade Card — only show when NOT pro ── */}
                  {!isPro && !isCanceled && (
                    <div className="mt-4">
                      <div className="mb-4">
                        <h3 className="text-lg font-bold text-white">Upgrade to Pro</h3>
                        <p className="text-sm text-slate-400">Start your 1-day free trial, then $9/month.</p>
                      </div>
                      <div className="max-w-md">
                        <PricingCard />
                      </div>
                    </div>
                  )}

                  {/* ── Manage / Cancel — show for all pro states ── */}
                  {isPro && (
                    <div className="pt-6 border-t border-white/5 flex flex-col gap-3">
                      <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Manage Subscription</h3>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={handleRefreshStatus}
                          disabled={saving}
                          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 rounded-lg text-sm font-medium transition-all"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          Refresh Status
                        </button>
                        <button
                          onClick={handleCancel}
                          disabled={saving}
                          className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium transition-all"
                        >
                          <XCircle className="w-4 h-4" />
                          {isTrialing ? 'Cancel Trial' : 'Cancel Subscription'}
                        </button>
                      </div>
                      <p className="text-xs text-slate-600">
                        Cancellation takes effect at the end of your {isTrialing ? 'trial' : 'billing'} period. You keep access until then.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── ACCOUNT TAB ───────────────────────────────────────────── */}
              {activeTab === 'general' && (
                <div className="space-y-8">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-2">Account</h2>
                    <p className="text-sm text-slate-400">Your personal profile and security.</p>
                  </div>
                  <div className="p-6 bg-white/5 rounded-xl border border-white/10 flex items-center gap-6">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl font-bold text-white shadow-2xl shrink-0">
                      {user?.username?.[0].toUpperCase()}
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <h3 className="text-xl font-bold text-white truncate">{user?.username}</h3>
                      <p className="text-sm text-slate-400 truncate mb-4">{user?.email}</p>
                      <div className="flex gap-2">
                        <span className="px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 text-[10px] border border-indigo-500/30 uppercase font-bold flex items-center gap-1.5">
                          <CreditCard className="w-3 h-3" /> {user?.subscription_tier || 'Free'} Plan
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}