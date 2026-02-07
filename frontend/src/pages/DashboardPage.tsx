import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authAPI, projectAPI, userAPI } from '../services/api';
import Layout from '../components/Layout';
import CreateProjectDialog from '../components/CreateProjectDialog'; 
import { 
  FolderIcon, 
  DocumentTextIcon, 
  ChatBubbleLeftRightIcon, 
  PlusIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

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
}

export default function DashboardPage() {
  const { user, setUser } = useAuthStore();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  
  // State for Dialog
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Define loadData outside useEffect so we can pass it to the dialog
  const loadData = async () => {
    try {
      const [userData, projectData, statsData] = await Promise.all([
        authAPI.me(),
        projectAPI.getAll(),
        userAPI.getStats()
      ]);
      setUser(userData.data.user);
      setProjects(projectData.data.projects);
      setStats(statsData.data.stats);
    } catch (e) {
      console.error("Dashboard error", e);
    } finally {
      setLoading(false);
    }
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
      <div className="p-8 max-w-7xl mx-auto space-y-8">
        
        {/* Welcome Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-slate-400 text-sm mt-1">Overview of your activity and projects</p>
          </div>
          {/* Button opens modal */}
          <button 
            onClick={() => setIsCreateDialogOpen(true)}
            className="btn-primary shadow-lg shadow-ubiq-accent/20 flex items-center gap-2 px-4 py-2 rounded-lg bg-ubiq-accent hover:bg-ubiq-accent-hover text-white transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            <span>New Project</span>
          </button>
        </div>

        {/* Stats Grid */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total Projects" value={stats.total_projects} icon={FolderIcon} color="bg-blue-500" />
            <StatCard title="Source Files" value={stats.total_files} icon={DocumentTextIcon} color="bg-emerald-500" />
            <StatCard title="AI Chats" value={stats.total_chats} icon={ChatBubbleLeftRightIcon} color="bg-purple-500" />
            <div className="glass-panel p-5 rounded-xl flex flex-col justify-center">
               <p className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-1">Current Plan</p>
               <div className="flex items-center gap-2">
                 <span className="text-xl font-bold text-white capitalize">{stats.subscription_tier}</span>
                 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-ubiq-accent/20 text-ubiq-accent border border-ubiq-accent/20">PRO</span>
               </div>
            </div>
          </div>
        )}

        {/* Projects List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white">Recent Projects</h2>
          
          {loading ? (
             <div className="text-center py-20 text-slate-500 animate-pulse">Loading workspace...</div>
          ) : projects.length === 0 ? (
            <div className="glass-panel rounded-xl p-12 text-center border-dashed border-ubiq-700">
               <FolderIcon className="w-12 h-12 text-slate-600 mx-auto mb-4" />
               <h3 className="text-white font-medium mb-1">No projects found</h3>
               <p className="text-slate-500 text-sm mb-4">Get started by creating your first AI-powered project.</p>
               <button onClick={() => setIsCreateDialogOpen(true)} className="text-ubiq-accent hover:text-white text-sm font-medium">Create Project &rarr;</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Link 
                  key={project.id} 
                  // LINK TO PROJECT INFO PAGE (Not Editor)
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
                    {project.description || "No description provided."}
                  </p>
                  
                  <div className="flex items-center text-xs text-slate-600 pt-4 border-t border-white/5">
                    <ClockIcon className="w-3.5 h-3.5 mr-1.5" />
                    <span>Updated {new Date(project.updated_at).toLocaleDateString()}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Create Dialog */}
        <CreateProjectDialog 
            isOpen={isCreateDialogOpen} 
            onClose={() => setIsCreateDialogOpen(false)} 
            onSuccess={() => {
                loadData(); 
                setIsCreateDialogOpen(false);
            }} 
        />

      </div>
    </Layout>
  );
}