import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authAPI } from '../services/api';
import {
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
  CodeBracketSquareIcon,
  Cog6ToothIcon,
  ArrowRightStartOnRectangleIcon,
  SparklesIcon,
  Bars3Icon,
  XMarkIcon,
  FolderIcon // New Icon for Projects
} from '@heroicons/react/24/outline';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      logout();
      navigate('/login');
    }
  };

  const NavItem = ({ to, icon: Icon, title }: { to: string; icon: any; title: string }) => {
    // Check if the current path starts with the link's path (e.g. /projects/1 matches /projects)
    const isActive = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        title={title}
        onClick={() => setIsMobileMenuOpen(false)}
        className={`relative flex items-center gap-3 md:justify-center w-full md:w-10 h-10 px-3 md:px-0 rounded-xl transition-all duration-300 group ${
          isActive
            ? 'bg-ubiq-accent text-white shadow-lg shadow-ubiq-accent/20'
            : 'text-slate-500 hover:text-slate-200 hover:bg-white/5'
        }`}
      >
        <Icon className="w-5 h-5 transition-transform duration-300 group-hover:scale-110 shrink-0" />
        {/* Label visible only on mobile drawer */}
        <span className="md:hidden text-sm font-medium">{title}</span>
        
        {/* Active Indicator (Desktop) */}
        {isActive && (
          <span className="hidden md:block absolute -right-2 top-1/2 -translate-y-1/2 w-1 h-8 rounded-l-full bg-white/20" />
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-screen w-full bg-ubiq-950 overflow-hidden text-slate-300 font-sans selection:bg-ubiq-accent/30">
      
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-14 bg-ubiq-950/80 backdrop-blur-md border-b border-white/5 z-50 flex items-center justify-between px-4">
         <div className="flex items-center gap-3">
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-1 text-slate-400 hover:text-white">
               <Bars3Icon className="w-6 h-6" />
            </button>
            <span className="font-bold text-white tracking-wide">Ubiq</span>
         </div>
         <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ubiq-700 to-ubiq-800 flex items-center justify-center text-xs font-bold text-white border border-white/10">
            {user?.username?.[0]?.toUpperCase() || 'U'}
         </div>
      </div>

      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 md:hidden animate-fade-in"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar (Responsive Drawer) */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50 
        w-64 md:w-16 
        bg-ubiq-900 border-r border-white/5 
        flex flex-col items-center py-6 
        transition-transform duration-300 ease-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        
        {/* Brand Logo (Desktop) / Close Button (Mobile) */}
        <div className="mb-8 flex items-center justify-between w-full px-6 md:px-0 md:justify-center">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-purple-500/20 ring-1 ring-white/10 shrink-0">
            U
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-500 hover:text-white">
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col items-center gap-2 md:gap-4 w-full px-4 md:px-0">
          <NavItem to="/dashboard" icon={Squares2X2Icon} title="Dashboard" />
          {/* NEW: Projects Menu Item */}
          <NavItem to="/projects" icon={FolderIcon} title="Projects" />
          <NavItem to="/chat" icon={ChatBubbleLeftRightIcon} title="AI Chat" />
          <NavItem to="/editor" icon={CodeBracketSquareIcon} title="Editor" />
        </nav>

        {/* Bottom Section */}
        <div className="mt-auto flex flex-col items-center gap-4 w-full px-4 md:px-0 mb-2">
          <NavItem to="/settings" icon={Cog6ToothIcon} title="Settings" />
          
          <div className="w-full md:w-8 h-px bg-white/5" />

          {/* User Profile (Desktop Compact) */}
          <div className="hidden md:flex flex-col items-center gap-2 group relative">
             <div className="w-9 h-9 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-xs font-bold text-white ring-1 ring-white/10 shadow-inner cursor-default">
                {user?.username?.[0]?.toUpperCase() || 'U'}
             </div>
             {/* Hover Popup inside Layout.tsx */}
              <div className="absolute left-full ml-4 bottom-0 w-max bg-ubiq-900 border border-white/10 p-3 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                <p className="text-sm font-medium text-white">{user?.username}</p>
                
                <div className="flex flex-col gap-1.5 mt-2">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-300 font-bold uppercase tracking-wide">
                    <SparklesIcon className="w-3 h-3 text-indigo-400" />
                    {user?.subscription_tier || 'Free'} Plan
                  </div>
                  
                  {/* Status Badge */}
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border self-start ${
                    user?.subscription_status === 'active' 
                      ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                      : user?.subscription_status === 'trialing'
                      ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}>
                    {user?.subscription_status}
                  </span>
                </div>
              </div>
          </div>

          {/* Mobile User Info inside Layout.tsx */}
          <div className="md:hidden flex items-center gap-3 w-full p-2 rounded-xl bg-white/5 border border-white/5">
              <div className="w-8 h-8 rounded-full bg-ubiq-800 flex items-center justify-center text-white font-bold text-xs">
                {user?.username?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col">
                <span className="text-sm text-white font-medium">{user?.username}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ubiq-accent font-bold uppercase">{user?.subscription_tier || 'Free'}</span>
                  <span className="text-slate-600 text-xs">•</span>
                  <span className={`text-[10px] font-bold uppercase ${
                    user?.subscription_status === 'active' ? 'text-green-400' : 'text-blue-400'
                  }`}>
                    {user?.subscription_status}
                  </span>
                </div>
              </div>
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-3 md:justify-center w-full md:w-10 h-10 px-3 md:px-0 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Logout"
          >
            <ArrowRightStartOnRectangleIcon className="w-5 h-5 shrink-0" />
            <span className="md:hidden text-sm font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden bg-ubiq-950 pt-14 md:pt-0">
        {children}
      </main>
    </div>
  );
}