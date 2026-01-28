import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { useAuthStore } from '../stores/authStore';
import { userAPI, aiAPI } from '../services/api';

interface Preferences {
  preferred_model: string;
  theme: string;
  editor_settings: {
    fontSize: number;
    tabSize: number;
    wordWrap: string;
    minimap: { enabled: boolean };
    lineNumbers: string;
    formatOnSave: boolean;
  };
  auto_complete: boolean;
  code_suggestions: boolean;
}

interface Model {
  name: string;
  display_name: string;
  size: string;
  tier_required: string;
  description: string;
  is_active: boolean;
}

interface UsageStats {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_tokens: number;
  avg_latency_ms: number;
}

export default function SettingsPage() {
  const { user } = useAuthStore();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [activeTab, setActiveTab] = useState<'general' | 'editor' | 'usage'>('general');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [prefsRes, modelsRes, usageRes] = await Promise.all([
        userAPI.getPreferences(),
        aiAPI.getModels(),
        userAPI.getUsage(7),
      ]);
      
      setPreferences(prefsRes.data.preferences);
      setModels(modelsRes.data.models);
      setUsageStats(usageRes.data.summary);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage({ type: 'error', text: 'Failed to load settings' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!preferences) return;
    
    setSaving(true);
    setMessage({ type: '', text: '' });
    
    try {
      await userAPI.updatePreferences({
        preferred_model: preferences.preferred_model,
        theme: preferences.theme,
        editor_settings: preferences.editor_settings,
        auto_complete: preferences.auto_complete,
        code_suggestions: preferences.code_suggestions,
      });
      
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setMessage({ type: '', text: '' }), 3000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const updatePreference = (key: string, value: any) => {
    if (!preferences) return;
    setPreferences({ ...preferences, [key]: value });
  };

  const updateEditorSetting = (key: string, value: any) => {
    if (!preferences) return;
    setPreferences({
      ...preferences,
      editor_settings: {
        ...preferences.editor_settings,
        [key]: value,
      },
    });
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-slate-400">Loading settings...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6">Settings</h1>

        {message.text && (
          <div className={`mb-6 p-4 rounded-lg ${
            message.type === 'success' 
              ? 'bg-green-500/10 border border-green-500 text-green-500' 
              : 'bg-red-500/10 border border-red-500 text-red-500'
          }`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-slate-800 p-1 rounded-lg border border-slate-700">
          <button
            onClick={() => setActiveTab('general')}
            className={`flex-1 py-2 px-4 rounded font-medium transition-colors ${
              activeTab === 'general'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('editor')}
            className={`flex-1 py-2 px-4 rounded font-medium transition-colors ${
              activeTab === 'editor'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            Editor
          </button>
          <button
            onClick={() => setActiveTab('usage')}
            className={`flex-1 py-2 px-4 rounded font-medium transition-colors ${
              activeTab === 'usage'
                ? 'bg-blue-600 text-white'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            Usage
          </button>
        </div>

        {/* General Tab */}
        {activeTab === 'general' && preferences && (
          <div className="space-y-6">
            {/* Account Info */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Account Information</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Username</span>
                  <span className="text-white font-medium">{user?.username}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Email</span>
                  <span className="text-white font-medium">{user?.email}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Subscription</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase ${
                    user?.subscription_tier === 'premium'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {user?.subscription_tier}
                  </span>
                </div>
              </div>
            </div>

            {/* AI Model Selection */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">AI Model</h2>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Preferred Model
              </label>
              <select
                value={preferences.preferred_model}
                onChange={(e) => updatePreference('preferred_model', e.target.value)}
                className="w-full bg-slate-700 text-white px-4 py-2 rounded border border-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {models
                  .filter(m => m.tier_required === user?.subscription_tier || m.tier_required === 'free')
                  .map(model => (
                    <option key={model.name} value={model.name}>
                      {model.display_name} - {model.size}
                    </option>
                  ))}
              </select>
              <p className="text-sm text-slate-400 mt-2">
                Choose your default AI model for code generation and chat
              </p>

              {/* Model List */}
              <div className="mt-4 space-y-2">
                <div className="text-sm font-medium text-slate-300 mb-2">Available Models:</div>
                {models
                  .filter(m => m.tier_required === user?.subscription_tier || m.tier_required === 'free')
                  .map(model => (
                    <div key={model.name} className="bg-slate-700/50 p-3 rounded border border-slate-600">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium">{model.display_name}</span>
                        <span className="text-xs text-slate-400">{model.size}</span>
                      </div>
                      <p className="text-xs text-slate-400">{model.description}</p>
                    </div>
                  ))}
              </div>
            </div>

            {/* Theme */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Appearance</h2>
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Theme
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => updatePreference('theme', 'dark')}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    preferences.theme === 'dark'
                      ? 'border-blue-500 bg-slate-700'
                      : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
                  }`}
                >
                  <div className="text-3xl mb-2">🌙</div>
                  <div className="text-white font-medium">Dark</div>
                  <div className="text-xs text-slate-400 mt-1">Easier on the eyes</div>
                </button>
                <button
                  onClick={() => updatePreference('theme', 'light')}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    preferences.theme === 'light'
                      ? 'border-blue-500 bg-slate-700'
                      : 'border-slate-600 bg-slate-700/50 hover:border-slate-500'
                  }`}
                >
                  <div className="text-3xl mb-2">☀️</div>
                  <div className="text-white font-medium">Light</div>
                  <div className="text-xs text-slate-400 mt-1">Classic look</div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Editor Tab */}
        {activeTab === 'editor' && preferences && (
          <div className="space-y-6">
            {/* Code Assistance */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Code Assistance</h2>
              <div className="space-y-4">
                <label className="flex items-center justify-between py-3 border-b border-slate-700">
                  <div>
                    <div className="text-white font-medium">Auto Complete</div>
                    <div className="text-sm text-slate-400">Enable automatic code completion suggestions</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.auto_complete}
                    onChange={(e) => updatePreference('auto_complete', e.target.checked)}
                    className="w-5 h-5 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                  />
                </label>
                <label className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-white font-medium">Code Suggestions</div>
                    <div className="text-sm text-slate-400">Show AI-powered code suggestions while typing</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.code_suggestions}
                    onChange={(e) => updatePreference('code_suggestions', e.target.checked)}
                    className="w-5 h-5 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                  />
                </label>
              </div>
            </div>

            {/* Editor Settings */}
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Editor Configuration</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Font Size: {preferences.editor_settings.fontSize}px
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="24"
                    value={preferences.editor_settings.fontSize}
                    onChange={(e) => updateEditorSetting('fontSize', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Tab Size: {preferences.editor_settings.tabSize} spaces
                  </label>
                  <input
                    type="range"
                    min="2"
                    max="8"
                    step="2"
                    value={preferences.editor_settings.tabSize}
                    onChange={(e) => updateEditorSetting('tabSize', parseInt(e.target.value))}
                    className="w-full"
                  />
                </div>

                <label className="flex items-center justify-between py-3 border-t border-slate-700">
                  <div>
                    <div className="text-white font-medium">Word Wrap</div>
                    <div className="text-sm text-slate-400">Wrap long lines automatically</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.editor_settings.wordWrap === 'on'}
                    onChange={(e) => updateEditorSetting('wordWrap', e.target.checked ? 'on' : 'off')}
                    className="w-5 h-5 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between py-3 border-t border-slate-700">
                  <div>
                    <div className="text-white font-medium">Minimap</div>
                    <div className="text-sm text-slate-400">Show code overview minimap</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.editor_settings.minimap.enabled}
                    onChange={(e) => updateEditorSetting('minimap', { enabled: e.target.checked })}
                    className="w-5 h-5 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between py-3 border-t border-slate-700">
                  <div>
                    <div className="text-white font-medium">Format on Save</div>
                    <div className="text-sm text-slate-400">Automatically format code when saving</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={preferences.editor_settings.formatOnSave}
                    onChange={(e) => updateEditorSetting('formatOnSave', e.target.checked)}
                    className="w-5 h-5 text-blue-600 bg-slate-700 border-slate-600 rounded focus:ring-blue-500"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Usage Tab */}
        {activeTab === 'usage' && usageStats && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="text-slate-400 text-sm mb-1">Total Requests</div>
                <div className="text-3xl font-bold text-white">{usageStats.total_requests}</div>
                <div className="text-xs text-slate-500 mt-1">Last 7 days</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="text-slate-400 text-sm mb-1">Success Rate</div>
                <div className="text-3xl font-bold text-green-400">
                  {usageStats.total_requests > 0 
                    ? Math.round((usageStats.successful_requests / usageStats.total_requests) * 100)
                    : 0}%
                </div>
                <div className="text-xs text-slate-500 mt-1">{usageStats.successful_requests} successful</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="text-slate-400 text-sm mb-1">Total Tokens</div>
                <div className="text-3xl font-bold text-blue-400">{usageStats.total_tokens.toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">Generated</div>
              </div>

              <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
                <div className="text-slate-400 text-sm mb-1">Avg Response Time</div>
                <div className="text-3xl font-bold text-purple-400">{Math.round(usageStats.avg_latency_ms)}ms</div>
                <div className="text-xs text-slate-500 mt-1">Latency</div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <h2 className="text-xl font-semibold text-white mb-4">Subscription Details</h2>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Current Plan</span>
                  <span className={`px-4 py-1 rounded-full text-sm font-semibold uppercase ${
                    user?.subscription_tier === 'premium'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {user?.subscription_tier}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Requests per hour</span>
                  <span className="text-white font-medium">
                    {user?.subscription_tier === 'premium' ? '100' : '30'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Available Models</span>
                  <span className="text-white font-medium">
                    {models.filter(m => m.tier_required === user?.subscription_tier || m.tier_required === 'free').length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        {(activeTab === 'general' || activeTab === 'editor') && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-semibold py-3 px-4 rounded-lg transition-colors flex items-center justify-center"
          >
            {saving ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Save Settings'
            )}
          </button>
        )}
      </div>
    </Layout>
  );
}