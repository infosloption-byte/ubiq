import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authAPI, projectAPI, userAPI } from '../services/api';
import Layout from '../components/Layout';
import CreateProjectDialog from '../components/CreateProjectDialog';
import AiGeneratorModal from '../components/AiGeneratorModal';
import {
  FolderIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  PlusIcon,
  ClockIcon,
  SparklesIcon,
  CircleStackIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

interface Project {
  id: number;
  name: string;
  description: string;
  language: string;
  files_count: number;
  storage_bytes: number;
  updated_at: string;
  created_at: string;
}

interface Stats {
  total_projects: number;
  total_files: number;
  total_chats: number;
  subscription_tier: string;
}

interface StorageStats {
  used_bytes: number;
  used_mb: number;
  limit_bytes: number;
  limit_mb: number;
  percent: number;
}

export default function DashboardPage() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<{ projects?: string; stats?: string; storage?: string }>({});

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);

  // Detect 402 / payment_required responses from the backend
  const isSubscriptionError = (err: any) =>
    err?.response?.status === 402 ||
    err?.response?.data?.action === 'payment_required';

  const isBlocked =
    errors.stats === '__subscription__' || errors.projects === '__subscription__';

  const loadData = async () => {
    const [userResult, projectsResult, statsResult, storageResult] = await Promise.allSettled([
      authAPI.me(),
      projectAPI.getAll(),
      userAPI.getStats(),
      userAPI.getStorageStats(),
    ]);

    const newErrors: typeof errors = {};

    if (userResult.status === 'fulfilled') {
      setUser(userResult.value.data.user);
    }

    if (projectsResult.status === 'fulfilled') {
      setProjects(projectsResult.value.data.projects);
    } else {
      newErrors.projects = isSubscriptionError(projectsResult.reason)
        ? '__subscription__'
        : 'Could not load projects.';
    }

    if (statsResult.status === 'fulfilled') {
      setStats(statsResult.value.data.stats);
    } else {
      newErrors.stats = isSubscriptionError(statsResult.reason)
        ? '__subscription__'
        : 'Could not load stats.';
    }

    if (storageResult.status === 'fulfilled') {
      setStorageStats(storageResult.value.data);
    }

    setErrors(newErrors);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const StatCard = ({ title, value, icon: Icon, color }: any) => (
    <div className="glass-panel p-5 rounded-xl flex items-center justify-between group hover:bg-ubiq-800/50 transition-colors">
      <div>
        <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">{title}</p>
        <p className="text-2xl font-bold text-white">{value}</p>
      </div>
      <div className={`p-3 rounded-lg ${color} bg-opacity-10 text-opacity-80`}>
        <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="p-8 max-w-7xl mx-auto space-y-6">

        {/* ── Subscription Expired Banner ─────────────────────────────────── */}
        {isBlocked && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 border border-amber-500/30 rounded-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-amber-300 font-bold text-sm">Your subscription has expired</h3>
                <p className="text-amber-200/70 text-xs mt-0.5 leading-relaxed max-w-md">
                  Activate a Pro plan to access your projects, AI features, and cloud storage.
                  All your existing data is safe and waiting for you.
                </p>
              </div>
            </div>
            <Link
              to="/settings?tab=billing"
              className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-amber-500/20"
            >
              <SparklesIcon className="w-4 h-4" />
              Activate Pro
            </Link>
          </div>
        )}

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-1">Overview of your activity and projects</p>
          </div>

          <div className="flex gap-3">
            {/* Generate with AI — disabled + tooltip when blocked */}
            <div className="relative group/btn">
              <button
                onClick={() => !isBlocked && setIsAiModalOpen(true)}
                disabled={isBlocked}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-lg
                  ${isBlocked
                    ? 'bg-purple-600/40 text-white/40 cursor-not-allowed shadow-none'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/20'
                  }`}
              >
                {isBlocked ? <LockClosedIcon className="w-4 h-4" /> : <SparklesIcon className="w-5 h-5" />}
                <span>Generate with AI</span>
              </button>
              {isBlocked && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-max max-w-[200px] text-center px-3 py-1.5 bg-ubiq-900 border border-white/10 rounded-lg text-[11px] text-slate-300 opacity-0 group-hover/btn:opacity-100 pointer-events-none transition-opacity z-10 shadow-xl">
                  Activate Pro to use this feature
                </div>
              )}
            </div>

            {/* New Project — disabled + tooltip when blocked */}
            <div className="relative group/btn2">
              <button
                onClick={() => !isBlocked && setIsCreateDialogOpen(true)}
                disabled={isBlocked}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg
                  ${isBlocked
                    ? 'bg-ubiq-accent/40 text-white/40 cursor-not-allowed shadow-none'
                    : 'bg-ubiq-accent hover:bg-ubiq-accent-hover text-white shadow-ubiq-accent/20'
                  }`}
              >
                {isBlocked ? <LockClosedIcon className="w-4 h-4" /> : <PlusIcon className="w-5 h-5" />}
                <span>New Project</span>
              </button>
              {isBlocked && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-max max-w-[200px] text-center px-3 py-1.5 bg-ubiq-900 border border-white/10 rounded-lg text-[11px] text-slate-300 opacity-0 group-hover/btn2:opacity-100 pointer-events-none transition-opacity z-10 shadow-xl">
                  Activate Pro to use this feature
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats Grid ─────────────────────────────────────────────────── */}
        {stats && !errors.stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Projects" value={stats.total_projects} icon={FolderIcon} color="bg-blue-500" />
            <StatCard title="Source Files" value={stats.total_files} icon={DocumentTextIcon} color="bg-emerald-500" />
            <StatCard title="AI Chats" value={stats.total_chats} icon={ChatBubbleLeftRightIcon} color="bg-purple-500" />
            <div className="glass-panel p-5 rounded-xl flex flex-col justify-center">
              <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Current Plan</p>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-white capitalize">{stats.subscription_tier}</span>
                {stats.subscription_tier === 'pro' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-ubiq-accent/20 text-ubiq-accent border border-ubiq-accent/20">PRO</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stats error — only show for non-subscription errors */}
        {errors.stats && errors.stats !== '__subscription__' && (
          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            Could not load stats — {errors.stats}
          </p>
        )}

        {/* ── Storage Usage ──────────────────────────────────────────────── */}
        {storageStats && (
          <div className="glass-panel p-5 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CircleStackIcon className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-medium text-slate-300">Storage Usage</span>
              </div>
              <span className="text-xs text-slate-500">
                {storageStats.used_mb < 1024
                  ? `${storageStats.used_mb.toFixed(1)} MB`
                  : `${(storageStats.used_mb / 1024).toFixed(2)} GB`}
                {' '}of{' '}
                {storageStats.limit_mb >= 1024
                  ? `${(storageStats.limit_mb / 1024).toFixed(0)} GB`
                  : `${storageStats.limit_mb} MB`}
                {' '}used
              </span>
            </div>
            <div className="w-full h-2 bg-ubiq-950 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  storageStats.percent > 90 ? 'bg-red-500' :
                  storageStats.percent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${storageStats.percent}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className={`text-xs font-medium ${
                storageStats.percent > 90 ? 'text-red-400' :
                storageStats.percent > 70 ? 'text-amber-400' : 'text-emerald-400'
              }`}>
                {storageStats.percent}% used
              </span>
              <span className="text-xs text-slate-600">
                {storageStats.limit_mb >= 1024
                  ? `${((storageStats.limit_mb - storageStats.used_mb) / 1024).toFixed(2)} GB`
                  : `${(storageStats.limit_mb - storageStats.used_mb).toFixed(0)} MB`}
                {' '}remaining
              </span>
            </div>
            {storageStats.percent > 80 && (
              <p className="text-xs text-amber-400 mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                ⚠ You're running low on storage. Consider deleting unused projects or upgrading your plan.
              </p>
            )}
          </div>
        )}

        {/* ── Recent Projects ────────────────────────────────────────────── */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Recent Projects</h2>

          {loading ? (
            <div className="text-center py-20 text-slate-500 animate-pulse">Loading workspace...</div>

          ) : errors.projects === '__subscription__' ? (
            /* Subscription expired — locked projects state */
            <div className="glass-panel rounded-xl p-12 text-center border border-amber-500/20 bg-amber-500/5">
              <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <LockClosedIcon className="w-8 h-8 text-amber-400" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Your projects are locked</h3>
              <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto leading-relaxed">
                Activate a Pro subscription to access your projects and continue building.
                All your data is safe and will be restored instantly.
              </p>
              <Link
                to="/settings?tab=billing"
                className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold text-sm rounded-xl transition-all shadow-lg shadow-amber-500/20"
              >
                <SparklesIcon className="w-4 h-4" />
                Activate Pro — $9/month
              </Link>
            </div>

          ) : errors.projects ? (
            /* Generic error */
            <div className="text-center py-12 text-amber-400 text-sm border border-amber-500/20 rounded-xl bg-amber-500/5">
              {errors.projects}
              <button onClick={loadData} className="underline ml-2 hover:text-amber-300">Retry</button>
            </div>

          ) : projects.length === 0 ? (
            /* Empty state */
            <div className="glass-panel rounded-xl p-12 text-center border-dashed border-ubiq-700">
              <FolderIcon className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <h3 className="text-white font-medium mb-1">No projects found</h3>
              <p className="text-slate-500 text-sm mb-4">Get started by creating your first AI-powered project.</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => setIsCreateDialogOpen(true)} className="text-ubiq-accent hover:text-white text-sm font-medium">
                  Create Project
                </button>
                <span className="text-slate-600">|</span>
                <button onClick={() => setIsAiModalOpen(true)} className="text-purple-400 hover:text-white text-sm font-medium flex items-center gap-1">
                  <SparklesIcon className="w-4 h-4" /> Generate with AI
                </button>
              </div>
            </div>

          ) : (
            /* Project grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="glass-panel p-5 rounded-xl hover:border-ubiq-accent/50 hover:bg-ubiq-900 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-2 bg-ubiq-950 rounded-lg border border-ubiq-800 group-hover:border-ubiq-700">
                      <FolderIcon className="w-6 h-6 text-ubiq-accent" />
                    </div>
                    {project.language && project.language !== 'mixed' && (
                      <span className="text-[10px] font-mono px-2 py-1 rounded bg-ubiq-950 border border-ubiq-800 text-slate-400">
                        {project.language}
                      </span>
                    )}
                  </div>

                  <h3 className="text-white font-medium mb-1 truncate">{project.name}</h3>
                  <p className="text-slate-500 text-xs mb-4 line-clamp-2 h-8">
                    {project.description || 'No description provided.'}
                  </p>
                  <span className="text-[10px] text-slate-500 mt-1">
                    Created: {new Date(project.created_at).toLocaleString('en-US', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>

                  <div className="flex items-center text-xs text-slate-600 pt-4 border-t border-white/5 justify-between">
                    <div className="flex items-center gap-1">
                      <ClockIcon className="w-3.5 h-3.5 mr-1.5" />
                      <span>Updated {new Date(project.updated_at).toLocaleDateString()}</span>
                    </div>
                    {project.storage_bytes > 0 && (
                      <span className="text-slate-600">
                        {project.storage_bytes < 1048576
                          ? `${(project.storage_bytes / 1024).toFixed(0)} KB`
                          : `${(project.storage_bytes / 1048576).toFixed(1)} MB`}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ── Modals ─────────────────────────────────────────────────────── */}
        <CreateProjectDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onSuccess={() => { loadData(); setIsCreateDialogOpen(false); }}
        />

        <AiGeneratorModal
          isOpen={isAiModalOpen}
          onClose={() => setIsAiModalOpen(false)}
        />

      </div>
    </Layout>
  );
}