import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authAPI, projectAPI, userAPI } from '../services/api';
import Layout from '../components/Layout';

interface Project {
  id: number;
  name: string;
  description: string;
  language: string;
  files_count: number;
  updated_at: string;
}

interface Stats {
  total_projects: number;
  total_files: number;
  total_chats: number;
  subscription_tier: string;
  member_since: string;
}

export default function DashboardPage() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      // Load user data
      const userResponse = await authAPI.me();
      setUser(userResponse.data.user);

      // Load projects
      const projectsResponse = await projectAPI.getAll();
      setProjects(projectsResponse.data.projects);

      // Load stats
      const statsResponse = await userAPI.getStats();
      setStats(statsResponse.data.stats);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewProject = () => {
    navigate('/editor');
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
            <p className="text-slate-400">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        {/* Welcome Section */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg p-6 text-white">
          <h1 className="text-3xl font-bold mb-2">
            Welcome back, {user?.username}! 👋
          </h1>
          <p className="text-blue-100">
            Ready to build something amazing with AI assistance?
          </p>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">Projects</p>
                  <p className="text-3xl font-bold text-white mt-1">{stats.total_projects}</p>
                </div>
                <div className="text-4xl">📁</div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">Files</p>
                  <p className="text-3xl font-bold text-white mt-1">{stats.total_files}</p>
                </div>
                <div className="text-4xl">📄</div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">Chat Sessions</p>
                  <p className="text-3xl font-bold text-white mt-1">{stats.total_chats}</p>
                </div>
                <div className="text-4xl">💬</div>
              </div>
            </div>

            <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-400 text-sm">Tier</p>
                  <p className="text-2xl font-bold text-white mt-1 capitalize">{stats.subscription_tier}</p>
                </div>
                <div className="text-4xl">{stats.subscription_tier === 'premium' ? '⭐' : '🆓'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={handleNewProject}
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg p-6 text-left transition-colors"
          >
            <div className="text-3xl mb-3">➕</div>
            <h3 className="text-lg font-semibold mb-1">New Project</h3>
            <p className="text-blue-100 text-sm">Start coding with AI assistance</p>
          </button>

          <Link
            to="/chat"
            className="bg-green-600 hover:bg-green-700 text-white rounded-lg p-6 text-left transition-colors"
          >
            <div className="text-3xl mb-3">💬</div>
            <h3 className="text-lg font-semibold mb-1">AI Chat</h3>
            <p className="text-green-100 text-sm">Ask coding questions</p>
          </Link>

          <Link
            to="/settings"
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg p-6 text-left transition-colors"
          >
            <div className="text-3xl mb-3">⚙️</div>
            <h3 className="text-lg font-semibold mb-1">Settings</h3>
            <p className="text-purple-100 text-sm">Customize your experience</p>
          </Link>
        </div>

        {/* Recent Projects */}
        <div className="bg-slate-800 rounded-lg border border-slate-700">
          <div className="p-6 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-white">Recent Projects</h2>
            <button
              onClick={handleNewProject}
              className="text-blue-400 hover:text-blue-300 text-sm font-medium"
            >
              + New Project
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-6xl mb-4">📂</div>
              <h3 className="text-xl font-semibold text-white mb-2">No projects yet</h3>
              <p className="text-slate-400 mb-4">Create your first project to get started</p>
              <button
                onClick={handleNewProject}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                Create Project
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {projects.slice(0, 5).map((project) => (
                <Link
                  key={project.id}
                  to={`/editor/${project.id}`}
                  className="p-6 hover:bg-slate-700/50 transition-colors block"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-white font-semibold text-lg mb-1">{project.name}</h3>
                      <p className="text-slate-400 text-sm mb-2">{project.description || 'No description'}</p>
                      <div className="flex items-center space-x-4 text-sm text-slate-500">
                        <span className="flex items-center">
                          <span className="mr-1">📄</span>
                          {project.files_count} files
                        </span>
                        <span className="flex items-center">
                          <span className="mr-1">🔤</span>
                          {project.language || 'Multiple'}
                        </span>
                        <span>
                          Updated {new Date(project.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <div className="text-slate-500">
                      →
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}