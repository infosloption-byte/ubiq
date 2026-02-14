import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { projectAPI } from '../services/api';
import CreateProjectDialog from '../components/CreateProjectDialog';
import AiGeneratorModal from '../components/AiGeneratorModal'; // <--- IMPORT THIS
import { 
  PlusIcon, 
  MagnifyingGlassIcon, 
  FolderIcon, 
  CodeBracketIcon, 
  ClockIcon,
  SparklesIcon // <--- IMPORT THIS
} from '@heroicons/react/24/outline';

interface Project {
  id: number;
  name: string;
  description: string;
  language: string;
  source: 'manual' | 'github' | 'upload';
  updated_at: string;
  files_count?: number;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false); // <--- NEW STATE

  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await projectAPI.getAll();
      setProjects(response.data.projects || []);
    } catch (error) {
      console.error("Failed to load projects", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.description?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Layout>
      <div className="h-full flex flex-col bg-ubiq-950 p-6 md:p-10 overflow-y-auto custom-scrollbar">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight mb-2">My Projects</h1>
            <p className="text-slate-400">Manage your codebase and connect it with AI.</p>
          </div>
          
          <div className="flex gap-3">
              <button 
                onClick={() => setShowAiModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-lg shadow-purple-900/20 font-medium text-sm"
              >
                <SparklesIcon className="w-5 h-5" /> Generate with AI
              </button>

              <button 
                onClick={() => setShowCreateModal(true)}
                className="btn-primary flex items-center gap-2 shadow-xl shadow-ubiq-accent/20"
              >
                <PlusIcon className="w-5 h-5" /> New Project
              </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-8 relative max-w-md">
          <MagnifyingGlassIcon className="w-5 h-5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input 
            type="text" 
            placeholder="Search projects..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-primary w-full pl-10 py-3 rounded-xl bg-ubiq-900/50 border-white/5 focus:bg-ubiq-900"
          />
        </div>

        {/* Project Grid */}
        {loading ? (
          <div className="flex justify-center py-20">
             <div className="w-8 h-8 border-2 border-ubiq-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/10 rounded-2xl bg-white/5">
             <FolderIcon className="w-16 h-16 text-slate-600 mb-4" />
             <h3 className="text-xl font-semibold text-white mb-2">No projects found</h3>
             <p className="text-slate-400 mb-6 max-w-sm text-center">Get started by creating a blank project or importing an existing repository from GitHub.</p>
             <div className="flex gap-3">
                 <button onClick={() => setShowCreateModal(true)} className="btn-secondary">Create First Project</button>
                 <button onClick={() => setShowAiModal(true)} className="btn-secondary text-purple-400 hover:text-white border-purple-500/30 hover:border-purple-500/50 hover:bg-purple-500/10">Generate with AI</button>
             </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => (
              <div 
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="group relative bg-ubiq-900 border border-white/5 rounded-2xl p-6 hover:border-ubiq-accent/30 hover:bg-ubiq-900/80 transition-all duration-300 hover:-translate-y-1 shadow-lg cursor-pointer"
              >
                <div className="flex justify-between items-start mb-4">
                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      project.source === 'github' ? 'bg-[#24292e] text-white' : 'bg-ubiq-accent/10 text-ubiq-accent'
                   }`}>
                      {project.source === 'github' ? <CodeBracketIcon className="w-6 h-6" /> : <FolderIcon className="w-6 h-6" />}
                   </div>
                   <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                      {project.language || 'Text'}
                   </span>
                </div>

                <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-ubiq-accent transition-colors truncate">
                  {project.name}
                </h3>
                {/* ADD THIS LINE FOR THE TIMESTAMP */}
                <span className="text-[10px] text-slate-500 mt-1">
                    Created: {new Date(project.created_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    })}
                </span>
                <p className="text-slate-400 text-sm mb-6 line-clamp-2 h-10">
                  {project.description || 'No description provided.'}
                </p>

                <div className="flex items-center justify-between text-xs text-slate-500 border-t border-white/5 pt-4">
                   <div className="flex items-center gap-1.5">
                      <ClockIcon className="w-3.5 h-3.5" /> Last Updated
                      {new Date(project.updated_at).toLocaleDateString()}
                   </div>
                   <div>
                      {project.files_count !== undefined ? `${project.files_count} Files` : ''}
                   </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* --- MODALS --- */}
        <CreateProjectDialog 
          isOpen={showCreateModal} 
          onClose={() => setShowCreateModal(false)} 
          onSuccess={loadProjects} 
        />
        
        <AiGeneratorModal 
          isOpen={showAiModal} 
          onClose={() => setShowAiModal(false)} 
        />
        
      </div>
    </Layout>
  );
}