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

  // Helper component for Sidebar Links
  const NavItem = ({ to, icon: Icon, title }: { to: string; icon: any; title: string }) => {
    const isActive = location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        title={title}
        className={`flex flex-col items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 group relative ${
          isActive
            ? 'bg-ubiq-accent text-white shadow-lg shadow-ubiq-accent/25'
            : 'text-slate-500 hover:text-slate-200 hover:bg-ubiq-800'
        }`}
      >
        <Icon className="w-6 h-6" />
      </Link>
    );
  };

  return (
    <div className="flex h-screen w-full bg-ubiq-950 overflow-hidden text-slate-300">
      {/* Slim Sidebar */}
      <aside className="w-16 flex flex-col items-center py-6 bg-ubiq-900 border-r border-ubiq-800 z-20 shrink-0">
        {/* Brand / Logo */}
        <div className="mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-ubiq-accent to-purple-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-inner shadow-white/10">
            U
          </div>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 flex flex-col items-center gap-4 w-full">
          <NavItem to="/dashboard" icon={Squares2X2Icon} title="Dashboard" />
          <NavItem to="/chat" icon={ChatBubbleLeftRightIcon} title="AI Chat" />
          <NavItem to="/editor" icon={CodeBracketSquareIcon} title="Editor" />
        </nav>

        {/* Bottom Actions */}
        <div className="mt-auto flex flex-col items-center gap-4 mb-2">
          <NavItem to="/settings" icon={Cog6ToothIcon} title="Settings" />
          
          <button
            onClick={handleLogout}
            className="flex items-center justify-center w-10 h-10 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Logout"
          >
            <ArrowRightStartOnRectangleIcon className="w-6 h-6" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Header Bar */}
        <header className="h-14 shrink-0 border-b border-ubiq-800 flex items-center justify-between px-6 bg-ubiq-950/50 backdrop-blur-sm z-10">
           <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-400">
                {location.pathname === '/dashboard' ? 'Overview' : location.pathname.slice(1).charAt(0).toUpperCase() + location.pathname.slice(2)}
              </span>
           </div>
           
           <div className="flex items-center gap-3">
              <span className="text-xs px-2 py-1 rounded border border-ubiq-800 bg-ubiq-900 text-slate-400">
                {user?.subscription_tier || 'Free'} Plan
              </span>
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-xs font-bold text-white ring-2 ring-ubiq-950 border border-ubiq-800">
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