import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { 
  HomeIcon, 
  ChatBubbleLeftRightIcon, 
  CodeBracketIcon, 
  Cog6ToothIcon,
  SparklesIcon,
  ClockIcon,
  ExclamationTriangleIcon 
} from '@heroicons/react/24/outline';

export default function Sidebar() {
  const location = useLocation();
  const { user } = useAuthStore();

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
    { name: 'Chat', href: '/chat', icon: ChatBubbleLeftRightIcon },
    { name: 'Projects', href: '/projects', icon: CodeBracketIcon },
    { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
  ];

  const isTrialing = user?.subscription_status === 'trialing';
  const isExpired = user?.subscription_status === 'expired';
  const isActive = user?.subscription_status === 'active';

  const daysLeft = user?.trial_ends_at 
    ? Math.max(0, Math.ceil((new Date(user.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) 
    : 0;

  return (
    <div className="w-16 md:w-64 bg-ubiq-900 border-r border-white/5 flex flex-col h-full shrink-0 transition-all duration-300">
      <div className="h-16 flex items-center px-4 md:px-6 border-b border-white/5">
        <div className="w-8 h-8 bg-ubiq-accent rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-ubiq-accent/20">U</div>
        <span className="ml-3 font-bold text-lg text-white hidden md:block tracking-wide">Ubiq</span>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {navigation.map((item) => {
          const active = location.pathname.startsWith(item.href);
          return (
            <Link key={item.name} to={item.href} className={`group flex items-center px-3 py-2.5 text-sm font-medium rounded-xl transition-all duration-200 ${active ? 'bg-ubiq-accent text-white shadow-md shadow-ubiq-accent/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
              <item.icon className={`h-5 w-5 shrink-0 ${active ? 'text-white' : 'text-slate-500 group-hover:text-white'}`} />
              <span className="ml-3 hidden md:block">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {isTrialing && (
        <div className="mx-4 mb-4 p-3 bg-gradient-to-br from-indigo-600/20 to-ubiq-accent/10 rounded-xl border border-indigo-500/20">
          <div className="flex items-center gap-2 mb-2">
            <ClockIcon className="w-4 h-4 text-indigo-400" />
            <span className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider">Trial Period</span>
          </div>
          <div className="flex items-end justify-between">
            <div>
              <span className="text-2xl font-bold text-white">{daysLeft}</span>
              <span className="text-[10px] text-slate-400 ml-1 uppercase">Days left</span>
            </div>
            <Link 
              to="/settings?tab=billing" 
              className="text-[10px] font-bold text-ubiq-accent hover:text-white transition-colors"
            >
              UPGRADE
            </Link>
          </div>
          {/* Progress Bar */}
          <div className="mt-2 h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-indigo-500 transition-all duration-1000" 
              style={{ width: `${(daysLeft / 14) * 100}%` }} // Assuming 14-day trial
            />
          </div>
        </div>
      )}

      {/* Profile Section */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/5">
            <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
                {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="hidden md:flex flex-col overflow-hidden">
                <span className="text-xs font-medium text-white truncate">{user?.username}</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-300">
                        {user?.subscription_tier || 'Free'}
                    </span>
                    <span className="text-slate-600 text-[9px]">•</span>
                    <span className={`text-[9px] font-bold uppercase tracking-widest ${
                        isActive ? 'text-green-400' : isTrialing ? 'text-blue-400' : 'text-red-400'
                    }`}>
                        {user?.subscription_status || 'Unknown'}
                    </span>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}