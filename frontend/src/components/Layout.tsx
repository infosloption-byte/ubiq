import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { authAPI } from '../services/api';
import {
  Squares2X2Icon,
  ChatBubbleLeftRightIcon,
  CodeBracketSquareIcon,
  Cog6ToothIcon,
  ArrowRightStartOnRectangleIcon
} from '@heroicons/react/24/outline';

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

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
    const isActive = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        title={title}
        className={`relative flex flex-col items-center justify-center w-10 h-10 rounded-xl transition-all duration-300 group ${
          isActive
            ? 'bg-ubiq-800 text-white shadow-lg'
            : 'text-slate-500 hover:text-slate-200 hover:bg-ubiq-800/50'
        }`}
      >
        <Icon className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
        
        {/* Active Indicator Dot */}
        {isActive && (
          <span className="absolute -right-1 top-1 w-2 h-2 rounded-full bg-ubiq-accent shadow-md shadow-ubiq-accent/50" />
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-screen w-full bg-ubiq-950 overflow-hidden text-slate-300 font-sans">
      {/* Sidebar */}
      <aside className="w-16 flex flex-col items-center py-6 bg-ubiq-900 border-r border-white/5 z-20 shrink-0">
        {/* Gemini-Style Gradient Brand */}
        <div className="mb-8">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-purple-500/20 ring-1 ring-white/10">
            U
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 flex flex-col items-center gap-6 w-full">
          <NavItem to="/dashboard" icon={Squares2X2Icon} title="Dashboard" />
          <NavItem to="/chat" icon={ChatBubbleLeftRightIcon} title="AI Chat" />
          <NavItem to="/editor" icon={CodeBracketSquareIcon} title="Editor" />
        </nav>

        {/* Bottom Actions */}
        <div className="mt-auto flex flex-col items-center gap-4 mb-2">
          <NavItem to="/settings" icon={Cog6ToothIcon} title="Settings" />
          
          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Logout"
          >
            <ArrowRightStartOnRectangleIcon className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Minimal Header */}
        <header className="h-14 shrink-0 border-b border-white/5 flex items-center justify-between px-6 bg-ubiq-950/50 backdrop-blur-sm z-10">
           <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-400 tracking-wide">
                {location.pathname === '/dashboard' ? 'Overview' : 
                 location.pathname.slice(1).charAt(0).toUpperCase() + location.pathname.slice(2)}
              </span>
           </div>
           
           <div className="flex items-center gap-3">
              <span className="text-xs px-2.5 py-1 rounded-full border border-ubiq-800 bg-ubiq-900 text-slate-400 font-medium">
                {user?.subscription_tier || 'Free'} Plan
              </span>
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-ubiq-700 to-ubiq-800 flex items-center justify-center text-xs font-bold text-white ring-2 ring-ubiq-950 border border-white/10">
                {user?.username?.[0]?.toUpperCase() || 'U'}
              </div>
           </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-0 scroll-smooth">
          {children}
        </div>
      </main>
    </div>
  );
}