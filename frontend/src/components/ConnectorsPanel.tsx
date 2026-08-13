import { useState, useEffect } from 'react';
import { githubAuthAPI } from '../services/api';
import { CodeBracketIcon, LinkIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

interface GithubStatus {
  connected: boolean;
  username?: string;
  avatar_url?: string | null;
  connected_at?: string | null;
  last_used_at?: string | null;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Settings → Connectors (new tab, this file). Account-level place to
 * connect/disconnect third-party services to a Ubiq account — GitHub
 * is the first and only one today, but the tab (and this panel's
 * shape: status → connect/disconnect, no project or dialog context
 * needed) is deliberately generic so a future connector doesn't need
 * a new pattern invented, just a new card here.
 *
 * Distinct from ConnectedAccountsPanel ("Login Methods" in the Account
 * tab): that panel is about how you sign IN to Ubiq (email/Google).
 * This is about what Ubiq can access ON YOUR BEHALF once you're
 * already signed in — same underlying OAuth idea as GitHub, Slack, or
 * Google Drive connectors in other products, just scoped to repo
 * access here. Two different concepts that happen to both use OAuth
 * under the hood; kept as two separate panels rather than merging them,
 * since conflating "how I log in" with "what I've granted access to"
 * is exactly the kind of thing that gets confusing to audit later.
 *
 * Previously the ONLY place to connect GitHub was buried inside
 * SourceControlPanel.tsx (only reachable from inside an already-open
 * project) or CreateProjectDialog.tsx's GitHub tab (only reachable
 * mid-project-creation). Neither is a natural place to look for
 * "what have I connected to my account" — this tab is. Those two
 * entry points are left exactly as they were (both still work, both
 * still call the same connect()/status() endpoints) — this doesn't
 * replace them, it adds the one place that was actually missing.
 */
export default function ConnectorsPanel() {
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const loadStatus = () => {
    setLoading(true);
    githubAuthAPI.status()
      .then(res => setGithub(res.data))
      .catch(() => setGithub({ connected: false }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStatus();
    // Coming back from the GitHub OAuth redirect lands here with
    // ?github_connected=1 or ?github_error=... on the URL (see
    // GithubOAuthController::callback()'s redirect targets) — neither
    // was ever read anywhere in the frontend before this panel
    // existed, so a failed connect (expired state ticket, GitHub
    // itself rejecting the callback, etc.) silently landed back on
    // Settings with no explanation at all. Re-check status on success
    // in case this panel was already mounted before the redirect
    // completed, and surface the specific failure reason on error
    // rather than leaving the user to guess why nothing happened.
    const params = new URLSearchParams(window.location.search);
    if (params.get('github_connected')) {
      loadStatus();
    } else if (params.get('github_error')) {
      const reasons: Record<string, string> = {
        missing_state: 'The connection attempt was missing required data. Please try connecting again.',
        expired_or_invalid_state: 'That connection attempt expired or was already used. Please try connecting again.',
        connection_failed: 'GitHub could not complete the connection. Please try again.',
      };
      setErrorMsg(reasons[params.get('github_error')!] || 'Could not connect your GitHub account. Please try again.');
    }
    if (params.get('github_connected') || params.get('github_error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    setErrorMsg('');
    try {
      const res = await githubAuthAPI.connect();
      window.location.href = res.data.redirect_url;
    } catch (err: any) {
      setConnecting(false);
      setErrorMsg(err.response?.data?.message || 'Could not start GitHub connection. Please try again.');
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect GitHub? You\'ll need to reconnect (or paste a repository URL and token manually) to import or push to repos again.')) return;
    setDisconnecting(true);
    try {
      await githubAuthAPI.disconnect();
      setGithub({ connected: false });
    } catch {
      setErrorMsg('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-2">Connectors</h2>
        <p className="text-sm text-slate-400">
          Connect third-party accounts so Ubiq can act on your behalf — browse and import your repos, and push commits back — without pasting tokens by hand.
        </p>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-300 text-xs">
          {errorMsg}
        </div>
      )}

      <div className="p-6 bg-white/5 rounded-xl border border-white/10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <CodeBracketIcon className="w-6 h-6 text-white" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white">GitHub</h3>
              <p className="text-xs text-slate-500">
                Repo import, the repo picker in New Project, and pushing commits from the editor's Source Control panel.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="w-4 h-4 border-2 border-slate-600 border-t-slate-300 rounded-full animate-spin shrink-0" />
          ) : github?.connected ? (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 px-2.5 py-1.5 rounded shrink-0">
              <CheckCircleIcon className="w-3.5 h-3.5" /> Connected
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 bg-white/5 px-2.5 py-1.5 rounded shrink-0">
              <XCircleIcon className="w-3.5 h-3.5" /> Not connected
            </span>
          )}
        </div>

        {!loading && github?.connected && (
          <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              {github.avatar_url ? (
                <img src={github.avatar_url} alt={github.username} className="w-8 h-8 rounded-full shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {github.username?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <div className="min-w-0 text-xs">
                <p className="text-slate-200 font-medium truncate">@{github.username}</p>
                <p className="text-slate-500">
                  Connected {formatDate(github.connected_at)}
                  {github.last_used_at && <> · Last used {formatDate(github.last_used_at)}</>}
                </p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-medium transition-all disabled:opacity-50 shrink-0"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        )}

        {!loading && !github?.connected && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {connecting ? <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <LinkIcon className="w-3.5 h-3.5" />}
              Connect GitHub
            </button>
            <p className="text-[10px] text-slate-600 mt-2">
              Requests read/write access to your repositories (the <code className="text-slate-500">repo</code> scope) — needed to import private repos and push commits on your behalf. You can review or revoke this anytime from GitHub's own Settings → Applications page, in addition to disconnecting here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
