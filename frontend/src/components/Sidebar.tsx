import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore'; // Import Store
import { 
  HomeIcon, 
  ChatBubbleLeftRightIcon, 
  CodeBracketIcon, 
  Cog6ToothIcon,
  UserCircleIcon, // New Icon
  SparklesIcon // New Icon for Plan
} from '@heroicons/react/24/outline';

export default function Sidebar() {
  const location = useLocation();
  const { user } = useAuthStore(); // Get User Data

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Chat', href: '/chat', icon: ChatBubbleLeftRightIcon },
    { name: 'Projects', href: '/projects', icon: CodeBracketIcon },
    { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
  ];

  return (
    <div className="w-16 md:w-64 bg-ubiq-900 border-r border-white/5 flex flex-col h-full shrink-0 transition-all duration-300">
      {/* Logo Area */}
      <div className="h-16 flex items-center px-4 md:px-6 border-b border-white/5">
        <div className="w-8 h-8 bg-ubiq-accent rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-ubiq-accent/20">
          U
        </div>
        <span className="ml-3 font-bold text-lg text-white hidden md:block tracking-wide">Ubiq</span>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location.pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              to={item.href}
              className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${
                isActive
                  ? 'bg-ubiq-accent text-white shadow-md shadow-ubiq-accent/10'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <item.icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-white'}`} />
              <span className="ml-3 hidden md:block">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* NEW: User Profile Section at Bottom */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-xs">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="hidden md:flex flex-col overflow-hidden">
                <span className="text-xs font-medium text-white truncate">{user?.username}</span>
                <span className="text-[10px] text-ubiq-accent flex items-center gap-1 uppercase tracking-wider font-bold">
                    <SparklesIcon className="w-3 h-3" />
                    {user?.subscription_tier || 'Free'} Plan
                </span>
            </div>
        </div>
      </div>
    </div>
  );
}