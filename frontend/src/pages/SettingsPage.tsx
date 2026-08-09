import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuthStore } from '../stores/authStore';
import api, { userAPI, authAPI, subscriptionApi, aiKeysAPI } from '../services/api';
import PricingGrid from '../components/PricingGrid';
// Sub-part 2 (PLAN_SYSTEM_TASKS.md Phase E): StorageUsage import removed —
// storage is now rendered as a row inside PlanUsageWidget instead of its
// own separate card here. This leaves StorageUsage.tsx with zero consumers
// anywhere in the app (confirmed via repo-wide grep) — flagged as now-dead
// code, left in place since deleting files wasn't asked for.
import PlanUsageWidget from '../components/PlanUsageWidget';
import ActiveSessionsPanel from '../components/ActiveSessionsPanel';
import PasswordPanel from '../components/PasswordPanel';
import ConnectedAccountsPanel from '../components/ConnectedAccountsPanel';
import DeleteAccountPanel from '../components/DeleteAccountPanel';
import PrivacyPanel from '../components/PrivacyPanel';
import { 
  User, Key, Monitor, Save, 
  CheckCircle2, Loader2,
  Eye, EyeOff, CreditCard, Calendar, Clock,
  ShieldCheck, AlertTriangle, XCircle, LogOut, Lock
} from 'lucide-react';

// D8 fix (PLAN_SYSTEM_TASKS.md Phase D): the three providers this UI has
// ever actually collected and that the backend supports. `grok` used to be
// listed here too but was never wired to anything server-side — Completion
// Controller has no xAI/Grok branch — so it was a decoy field that silently
// did nothing; removed rather than "migrated" to a backend that doesn't
// exist. OpenAI IS supported server-side (CompletionController checks
// `apiKeys['openai']`) but was never collectible from any settings UI in
// this codebase — a pre-existing gap, not something this fix invents;
// flagging it rather than quietly adding a new provider as a side effect
// of a security fix.
const AI_KEY_PROVIDERS: Array<{ id: 'openrouter' | 'mistral' | 'google'; label: string; link: string }> = [
  { id: 'openrouter', label: 'OpenRouter',    link: 'https://openrouter.ai/keys' },
  { id: 'mistral',    label: 'Mistral AI',    link: 'https://console.mistral.ai/' },
  { id: 'google',     label: 'Google Gemini', link: 'https://aistudio.google.com/app/apikey' },
];

export default function SettingsPage() {
  const { user, setUser, logout } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'ai' | 'editor' | 'billing' | 'general' | 'privacy'>('ai');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // D8 fix: `configuredKeys` holds only what the server is willing to give
  // back — a masked preview per provider, never the real value. `keyInputs`
  // holds draft text the user is currently typing, kept entirely separate
  // so there's no path (accidental or otherwise) for a real secret to end
  // up echoed back into a text field after being saved.
  const [configuredKeys, setConfiguredKeys] = useState<Record<string, { masked: string; updated_at?: string; last_used_at?: string | null }>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({ openrouter: '', mistral: '', google: '' });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [editorSettings, setEditorSettings] = useState({
    fontSize: 14, theme: 'vs-dark', wordWrap: 'on',
    minimap: true, formatOnSave: true, code_suggestions: true
  });

  // ── Derived subscription state ─────────────────────────────────────────────
  // E2a fix (PLAN_SYSTEM_TASKS.md Phase E): was `user?.subscription_tier
  // === 'pro'` on every one of these — meaning a paying Starter or Creator
  // subscriber had NO "Manage Subscription" section at all (gated on the
  // old `isPro`) and was always shown the full pricing grid as if
  // unsubscribed. This was compounded by a deeper backend bug just fixed
  // in the same migration set: `subscription_tier` was a 2-value
  // ENUM('free','pro') that couldn't even store 'starter'/'creator' until
  // 2026_08_08_000001_expand_users_subscription_tier_enum — so this frontend
  // fix only actually works correctly once that migration has run.
  // Renamed `isPro` → `isSubscribed` since it now correctly covers any paid
  // tier, not literally Pro — keeping the old name would itself become a
  // footgun for the next person reading this file.
  const PAID_TIERS = ['starter', 'creator', 'pro'];
  const isOnPaidTier = !!user?.subscription_tier && PAID_TIERS.includes(user.subscription_tier);
  const isTrialing   = isOnPaidTier && user?.subscription_status === 'trialing';
  const isActive     = isOnPaidTier && user?.subscription_status === 'active';
  const isPastDue    = isOnPaidTier && user?.subscription_status === 'past_due';
  const isSubscribed = isTrialing || isActive || isPastDue;
  const isCanceled   = user?.subscription_status === 'canceled';

  // E2a/E2b fix: previously hardcoded "$9.00/month" in the trial/billing
  // copy below — the old single-tier Pro price, wrong for Starter ($5),
  // Creator ($12), and even Pro itself (which is $22, not $9, per
  // PlanSeeder). Fetches the real plan list (same `/plans` endpoint
  // PricingGrid already uses) and looks up the current tier's actual price
  // instead of a stale literal. Also sets up E2c (upgrade grid filtered to
  // tiers above the current one), which needs this same plan list.
  const [plans, setPlans] = useState<Array<{ key: string; name: string; price_cents: number; sort_order: number }>>([]);
  useEffect(() => {
    api.get('/plans')
      .then(res => setPlans(res.data?.plans || []))
      .catch(e => console.error('Failed to load plans', e));
  }, []);
  const currentPlan = plans.find(p => p.key === user?.subscription_tier);
  const currentPlanPriceLabel = currentPlan
    ? (currentPlan.price_cents === 0 ? 'Free' : `$${(currentPlan.price_cents / 100).toFixed(2)}/month`)
    : null; // null while /plans hasn't resolved yet, or tier genuinely unmatched — copy below handles this by simply omitting the price rather than showing a wrong one

  // E2c (PLAN_SYSTEM_TASKS.md Phase E): derived from the same `plans` list
  // already fetched above — computed from the data (max sort_order seen)
  // rather than hardcoding 'pro' as "the top tier," so this stays correct
  // if a 5th tier is ever added without needing a matching code change here.
  const topSortOrder = plans.length > 0 ? Math.max(...plans.map(p => p.sort_order)) : null;
  const isOnTopTier = !!currentPlan && topSortOrder !== null && currentPlan.sort_order >= topSortOrder;

  const trialEndsAt = user?.trial_ends_at
    ? new Date(user.trial_ends_at) : null;
  const subEndsAt = (user as any)?.subscription_ends_at
    ? new Date((user as any).subscription_ends_at) : null;

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000))
    : 0;

  // D8 fix: fetches masked previews only — see aiKeysAPI/AiKeyController.
  // Pulled out as its own function (not inline in the effect) so
  // handleSaveKeys/handleRemoveKey can re-call it after a change without
  // duplicating the fetch-and-index logic.
  const loadAiKeys = async () => {
    try {
      const res = await aiKeysAPI.list();
      const byProvider: Record<string, { masked: string; updated_at?: string; last_used_at?: string | null }> = {};
      (res.data?.keys || []).forEach((k: any) => { byProvider[k.provider] = k; });
      setConfiguredKeys(byProvider);
    } catch (e) {
      console.error('Failed to load AI key status', e);
    }
  };

  useEffect(() => {
    loadAiKeys();
  }, []);

  useEffect(() => {
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

  // D8 fix: previously wrote the raw `apiKeys` object straight into
  // localStorage. Now PUTs each non-empty draft to the encrypted backend
  // (one request per changed provider — most saves are a single key
  // anyway, and Promise.all keeps a multi-key save no slower than before).
  // Drafts are cleared and configuredKeys re-fetched afterward, so the
  // input immediately reflects the new masked value rather than the raw
  // text the user just typed.
  const handleSaveKeys = async () => {
    const toSave = Object.entries(keyInputs).filter(([, value]) => value.trim().length > 0);
    if (toSave.length === 0) return;

    setSaving(true);
    try {
      await Promise.all(
        toSave.map(([provider, value]) => aiKeysAPI.update(provider as 'openrouter' | 'mistral' | 'google', value.trim()))
      );
      setKeyInputs({ openrouter: '', mistral: '', google: '' });
      await loadAiKeys();
      showSuccess('API keys saved securely.');
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed to save one or more keys. Double-check the value and try again.');
    } finally {
      setSaving(false);
    }
  };

  // D8 fix: actual revocation (DELETE, not a soft-delete) — nothing lingers
  // server-side once removed here.
  const handleRemoveKey = async (provider: 'openrouter' | 'mistral' | 'google') => {
    if (!window.confirm(`Remove your ${provider} key? AI requests using this provider will stop working until you add a new one.`)) return;
    setSaving(true);
    try {
      await aiKeysAPI.remove(provider);
      await loadAiKeys();
      showSuccess('Key removed.');
    } catch (e) {
      alert('Failed to remove key.');
    } finally {
      setSaving(false);
    }
  };

  // E3c fix (PLAN_SYSTEM_TASKS.md Phase E): revokes every Sanctum token for
  // this account server-side, then clears the client-side auth state and
  // navigates to /login — this also signs out the session that clicked the
  // button, matching what "Log Out All Devices" actually says it does.
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const handleLogoutAllDevices = async () => {
    if (!window.confirm('Log out of all devices, including this one? You\'ll need to sign in again everywhere.')) return;
    setLoggingOutAll(true);
    try {
      await authAPI.logoutAllDevices();
    } catch (e) {
      console.error('Failed to revoke all sessions server-side', e);
      // Proceed with the client-side logout regardless — if the server
      // call failed (e.g. network blip), leaving the person stuck signed
      // in on THIS device with no way to log out at all would be worse
      // than a logout that maybe didn't reach every other device.
    } finally {
      logout();
      navigate('/login');
    }
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

  // E1 fix (PLAN_SYSTEM_TASKS.md Phase E): was `w-full` unconditionally —
  // fine in the vertical desktop sidebar (buttons should fill that column),
  // but on the mobile horizontal pill bar `w-full` would make each button
  // try to fill the entire row's width, stacking them ugly rather than
  // sitting side-by-side. `md:w-full` scopes the full-width behavior back
  // to desktop only; `shrink-0 whitespace-nowrap` keep each pill sized to
  // its own label on mobile instead of shrinking/wrapping mid-word.
  const TabButton = ({ id, label, icon: Icon }: any) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`shrink-0 whitespace-nowrap md:w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all rounded-lg ${
        activeTab === id
          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/20'
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );

  const KeyInput = ({ id, label, link }: { id: 'openrouter' | 'mistral' | 'google'; label: string; link: string }) => {
    const existing = configuredKeys[id];
    return (
      <div className="group">
        <div className="flex justify-between items-baseline mb-1.5">
          <label className="text-xs font-bold text-slate-400 uppercase tracking-wide">{label}</label>
          <a href={link} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-500 hover:text-indigo-300 hover:underline">Get Key ↗</a>
        </div>
        {existing && (
          <div className="flex items-center justify-between mb-1.5 text-xs font-mono">
            <span className="text-slate-500">Configured: <span className="text-slate-300">{existing.masked}</span></span>
            <button onClick={() => handleRemoveKey(id)} className="text-red-400 hover:text-red-300 text-[10px] font-bold uppercase tracking-wide">Remove</button>
          </div>
        )}
        <div className="relative">
          <input
            type={showKeys[id] ? "text" : "password"}
            value={keyInputs[id] ?? ''}
            onChange={(e) => setKeyInputs({ ...keyInputs, [id]: e.target.value })}
            placeholder={existing ? "Enter a new key to replace it" : "sk-..."}
            className="w-full bg-[#050509] border border-white/10 rounded-lg pl-3 pr-10 py-2.5 text-sm text-slate-200 focus:border-indigo-500 outline-none font-mono transition-all"
          />
          <button onClick={() => setShowKeys(prev => ({ ...prev, [id]: !prev[id] }))}
            className="absolute right-3 top-2.5 text-slate-500 hover:text-white transition-colors">
            {showKeys[id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
    );
  };

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
            {/* E1 fix (PLAN_SYSTEM_TASKS.md Phase E): was `flex flex-col
                gap-2` unconditionally — already vertical on mobile, which
                was the reported problem (a tall stack of full-width tab
                buttons pushes all actual tab content below the fold on a
                phone). Now `flex-row overflow-x-auto` below `md:`, so the
                4 tabs sit in one horizontally-scrollable pill bar instead —
                the `-mx-6 px-6` / `md:mx-0 md:px-0` pair lets that scroll
                region bleed out to the same edges as the page's own outer
                padding on mobile (so pills can be dragged flush to the
                screen edge) without affecting the desktop layout at all,
                where it reverts to the original fixed-width vertical
                sidebar untouched. (5 tabs as of the Privacy tab added
                later in this same phase — the layout doesn't care how
                many there are.) */}
            <div className="flex flex-row md:flex-col gap-2 overflow-x-auto -mx-6 px-6 pb-1 md:mx-0 md:px-0 md:pb-0 md:overflow-visible md:w-64 shrink-0">
              <TabButton id="ai"      label="AI Models (BYOK)"  icon={Key} />
              <TabButton id="editor"  label="Editor Config"      icon={Monitor} />
              <TabButton id="billing" label="Billing & Plan"     icon={CreditCard} />
              <TabButton id="general" label="Account"            icon={User} />
              <TabButton id="privacy" label="Privacy"            icon={Lock} />
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
                      {/* D8 fix: was "Keys are stored locally in your browser" —
                          no longer true, and no longer the safer claim anyway.
                          Keys are now encrypted at rest server-side and never
                          sent back to the browser after you save them. */}
                      <p className="text-xs text-slate-400 leading-relaxed">Keys are encrypted and stored on our servers for AI features — never sent back to your browser after you save them.</p>
                    </div>
                  </div>
                  <div className="space-y-5">
                    {AI_KEY_PROVIDERS.map(({ id, label, link }) => (
                      <KeyInput key={id} id={id} label={label} link={link} />
                    ))}
                  </div>
                  <div className="pt-6 border-t border-white/5">
                    <button onClick={handleSaveKeys} disabled={saving} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-all">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Keys
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

                  {/* ── Status Cards ──
                      E2b sub-part 2 (PLAN_SYSTEM_TASKS.md Phase E) — per
                      feedback, dropped the two-column grid entirely in
                      favor of a single stacked column (the earlier
                      two-column attempt fixed the auto-placement bug but
                      wasn't the layout actually wanted). Also removed the
                      separate <StorageUsage/> card — storage is now its own
                      row inside PlanUsageWidget, since storage IS plan
                      usage and reads better grouped with the rest of it
                      rather than sitting in its own card alongside. */}
                  <div className="space-y-4">
                      <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Current Plan</p>
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-2xl font-black text-white capitalize">
                            {user?.subscription_tier || 'free'}
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
                              {/* E2b fix: was hardcoded "$9.00/month" — the old
                                  single-tier Pro price, wrong for every tier
                                  including Pro itself (which is $22, not $9).
                                  Falls back to generic wording if /plans hasn't
                                  resolved yet rather than showing a guess. */}
                              {currentPlanPriceLabel
                                ? <>After trial ends, you'll be charged {currentPlanPriceLabel} automatically unless you cancel.</>
                                : <>After trial ends, you'll be charged automatically at your plan's rate unless you cancel.</>}
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
                            {/* E2b fix: same hardcoded-$9 issue as the trial
                                copy above. */}
                            <p className="text-slate-400 text-xs mt-1">
                              {currentPlanPriceLabel ? <>{currentPlanPriceLabel} · Renews automatically</> : 'Renews automatically'}
                            </p>
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
                              {/* E2a fix: was hardcoded "Pro access until" —
                                  wrong for a canceled Starter/Creator
                                  subscriber, who isn't losing Pro access. */}
                              Access until {subEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                        )}
                      </div>

                      <PlanUsageWidget />
                  </div>

                  {/* ── Upgrade — E2c fix (PLAN_SYSTEM_TASKS.md Phase E):
                      previously `!isSubscribed && !isCanceled` hid this
                      section completely for ANY active paid subscriber,
                      Starter/Creator included — meaning someone already
                      paying for Starter had no way to see or start an
                      upgrade to Creator/Pro from this page at all. Now
                      shown for unsubscribed users (full grid, unchanged)
                      AND for subscribers not yet on the top tier (grid
                      filtered to tiers above their own via minSortOrder,
                      so they don't see their own tier or anything below
                      it as if it were a fresh choice). Still hidden
                      entirely for canceled subscriptions (unchanged) and
                      for anyone already on the top tier — correctly
                      nothing to upgrade to there. ── */}
                  {!isCanceled && (!isSubscribed || !isOnTopTier) && (
                    <div className="mt-4">
                      <div className="mb-4">
                        <h3 className="text-lg font-bold text-white">{isSubscribed ? 'Upgrade Your Plan' : 'Plans'}</h3>
                        <p className="text-sm text-slate-400">
                          {isSubscribed ? 'Get more capacity and features with a higher tier.' : "Pick the plan that fits how you're building."}
                        </p>
                      </div>
                      <PricingGrid minSortOrder={isSubscribed ? currentPlan?.sort_order : undefined} />
                    </div>
                  )}

                  {/* ── Manage / Cancel — show for any active paid tier, not just Pro ── */}
                  {isSubscribed && (
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
                    {/* E3a fix (PLAN_SYSTEM_TASKS.md Phase E): `user.avatar`
                        already existed on the User model and is populated
                        for Google OAuth signups, but nothing ever rendered
                        it — this was always just the initial-letter circle,
                        even when a real profile picture was sitting right
                        there in the API response. Falls back to the
                        initial circle when there's no avatar (email/
                        password signups, or a Google avatar URL that
                        fails to load — onError swaps in the fallback
                        rather than showing a broken image icon). */}
                    {user?.avatar ? (
                      <img
                        src={user.avatar}
                        alt={user.username}
                        className="w-20 h-20 rounded-full object-cover shrink-0 shadow-2xl"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-3xl font-bold text-white shadow-2xl shrink-0">
                        {user?.username?.[0].toUpperCase()}
                      </div>
                    )}
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

                  <ActiveSessionsPanel />

                  <PasswordPanel />

                  <ConnectedAccountsPanel />

                  {/* E3c fix (PLAN_SYSTEM_TASKS.md Phase E): revokes every
                      Sanctum token for this user (not just the current
                      session) — see AuthController::logoutAllDevices().
                      Deliberately no "except this device" variant; the
                      button says all devices, so it signs this one out
                      too rather than a quietly-different actual behavior. */}
                  <div className="p-6 bg-white/5 rounded-xl border border-white/10">
                    <h3 className="text-sm font-bold text-white mb-1">Log Out All Devices</h3>
                    <p className="text-xs text-slate-400 mb-4">Signs you out everywhere, including this device — useful if you suspect a session was left open somewhere you don't recognize.</p>
                    <button
                      onClick={handleLogoutAllDevices}
                      disabled={loggingOutAll}
                      className="flex items-center gap-2 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/30 text-slate-300 hover:text-red-300 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-60"
                    >
                      {loggingOutAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                      Log Out All Devices
                    </button>
                  </div>

                  {/* E3d — Delete Account. Deliberately built and placed
                      last in the Account tab, per the "build/test this
                      last, once the rest of the tab is solid" plan note. */}
                  <DeleteAccountPanel />
                </div>
              )}

              {/* ── PRIVACY TAB ───────────────────────────────────────────── */}
              {activeTab === 'privacy' && (
                <PrivacyPanel onGoToAccount={() => setActiveTab('general')} />
              )}

            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}