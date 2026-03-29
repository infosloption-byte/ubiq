import { useState, useEffect } from 'react';
import Layout from '../components/Layout'; // <--- Using the App Layout (Sidebar)
import { adminAPI } from '../services/api';
import { 
  Users, LayoutGrid, Activity, 
  Trash2, ShieldCheck, Cpu,
  Zap, AlertTriangle, Clock, Coins,
  CheckCircle2, TrendingUp, Eye, MousePointerClick
} from 'lucide-react';

export default function AdminPage() {
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users'>('dashboard');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, usersRes] = await Promise.all([
        adminAPI.getStats(),
        adminAPI.getUsers()
      ]);
      setStats(statsRes.data);
      // Defensive check for user list
      setUsers(usersRes.data?.users?.data || []);
    } catch (e) {
      console.error("Admin Load Failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id: number) => {
    if(!confirm("Are you sure? This deletes all their projects.")) return;
    try {
      await adminAPI.deleteUser(id);
      setUsers(users.filter(u => u.id !== id));
    } catch (e) { alert("Failed to delete user"); }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex h-full items-center justify-center bg-ubiq-950 text-slate-500">
          <Activity className="w-6 h-6 animate-spin mr-2" /> Loading Command Center...
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      {/* Scrollable Container matching Project/Dashboard pages */}
      <div className="h-full flex flex-col bg-ubiq-950 overflow-hidden">
        
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-white/5 bg-ubiq-900/50 shrink-0">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h1 className="text-lg font-bold text-white tracking-tight">Admin Command</h1>
           </div>
           
           {/* Tab Switcher */}
           <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
              <button 
                onClick={() => setActiveTab('dashboard')} 
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'dashboard' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                <LayoutGrid className="w-3.5 h-3.5" /> Overview
              </button>
              <button 
                onClick={() => setActiveTab('users')} 
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 ${activeTab === 'users' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                <Users className="w-3.5 h-3.5" /> Users
              </button>
           </div>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 scroll-smooth custom-scrollbar">
          <div className="max-w-7xl mx-auto pb-20">
            
            {activeTab === 'dashboard' && stats && (
              <div className="space-y-8 animate-fade-in">
                
                {/* ROW 1: ACQUISITION (Visitors -> Signups) */}
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                    <Eye className="w-3.5 h-3.5" /> Acquisition Pipeline
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard 
                      icon={<Eye className="text-blue-400"/>} 
                      label="Total Visits" 
                      value={stats.total_visits?.toLocaleString() || '0'} 
                      subtext={`+${stats.visits_today || 0} today`}
                    />
                    <StatCard 
                      icon={<MousePointerClick className="text-purple-400"/>} 
                      label="Sign Ups" 
                      value={stats.total_users?.toLocaleString() || '0'} 
                      subtext={`+${stats.new_users_today || 0} today`}
                    />
                    <StatCard 
                      icon={<TrendingUp className="text-green-400"/>} 
                      label="Conversion Rate" 
                      value={`${stats.conversion_rate || 0}%`} 
                      subtext="Visits to Signups"
                    />
                    <StatCard 
                      icon={<Activity className="text-yellow-400"/>} 
                      label="Active Users (24h)" 
                      value={stats.active_users_24h || 0} 
                      subtext="Coding right now"
                    />
                  </div>
                </div>

                {/* ROW 2: PLATFORM SCALE (The Requested Missing Section) */}
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                    <LayoutGrid className="w-3.5 h-3.5" /> Platform Scale
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard 
                      icon={<Users className="text-indigo-400"/>} 
                      label="Total Users" 
                      value={stats.total_users} 
                      subtext="Registered Accounts"
                    />
                    <StatCard 
                      icon={<LayoutGrid className="text-pink-400"/>} 
                      label="Projects Created" 
                      value={stats.total_projects} 
                      subtext="Total workspaces"
                    />
                    <StatCard 
                      icon={<Zap className="text-orange-400"/>} 
                      label="AI Requests" 
                      value={stats.total_ai_requests?.toLocaleString() || '0'} 
                      subtext="Total Completions"
                    />
                    <StatCard 
                      icon={<Coins className="text-yellow-400"/>} 
                      label="Tokens Processed" 
                      value={stats.total_tokens ? `${(stats.total_tokens / 1000).toFixed(1)}k` : '0'} 
                      subtext="Input + Output"
                    />
                  </div>
                </div>

                {/* ROW 3: SYSTEM HEALTH */}
                <div>
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1 flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5" /> System Health
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-[#0B0B10] border border-white/10 p-5 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-slate-500 text-xs font-medium uppercase">Avg AI Latency</p>
                        <p className="text-2xl font-bold text-white mt-1">{stats.avg_latency || 0}ms</p>
                      </div>
                      <div className={`p-3 rounded-full ${stats.avg_latency < 1000 ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
                        <Clock className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="bg-[#0B0B10] border border-white/10 p-5 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-slate-500 text-xs font-medium uppercase">Error Rate</p>
                        <p className={`text-2xl font-bold mt-1 ${(stats.error_rate || 0) > 5 ? 'text-red-400' : 'text-white'}`}>{stats.error_rate || 0}%</p>
                      </div>
                      <div className={`p-3 rounded-full ${(stats.error_rate || 0) > 5 ? 'bg-red-500/10 text-red-400' : 'bg-green-500/10 text-green-400'}`}>
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                    </div>

                    <div className="bg-[#0B0B10] border border-white/10 p-5 rounded-xl flex items-center justify-between">
                      <div>
                        <p className="text-slate-500 text-xs font-medium uppercase">Subscription Split</p>
                        <div className="flex gap-3 mt-2 text-sm">
                          <span className="text-white"><span className="text-slate-500">Free:</span> {stats.tiers?.free || 0}</span>
                          <span className="text-indigo-400 font-bold"><span className="text-slate-500 font-normal">Pro:</span> {stats.tiers?.pro || 0}</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-full bg-indigo-500/10 text-indigo-400">
                        <Zap className="w-6 h-6" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* ROW 4: USAGE BREAKDOWN */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Model Popularity */}
                  <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                      <Cpu className="w-5 h-5 text-indigo-500"/> Model Popularity
                    </h3>
                    <div className="space-y-4">
                      {(stats.ai_usage_breakdown || []).map((item: any, idx: number) => (
                        <div key={item.model_used} className="group">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-slate-300 text-sm font-mono truncate max-w-[200px]">{item.model_used}</span>
                            <span className="text-slate-500 text-xs">{stats.total_ai_requests ? ((item.total / stats.total_ai_requests) * 100).toFixed(1) : 0}%</span>
                          </div>
                          <div className="w-full bg-white/5 rounded-full h-2 overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${idx === 0 ? 'bg-indigo-500' : 'bg-slate-600'}`} 
                              style={{ width: `${stats.total_ai_requests ? (item.total / stats.total_ai_requests) * 100 : 0}%` }} 
                            />
                          </div>
                        </div>
                      ))}
                      {(!stats.ai_usage_breakdown || stats.ai_usage_breakdown.length === 0) && <p className="text-slate-500 text-sm italic">No AI requests yet.</p>}
                    </div>
                  </div>

                  {/* Recent Signups */}
                  <div className="bg-[#0B0B10] border border-white/10 rounded-xl p-6">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-500"/> Recent Signups
                    </h3>
                    <div className="space-y-0">
                      {(stats.recent_users || []).map((u: any) => (
                        <div key={u.id} className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/5 px-2 -mx-2 rounded-lg transition-colors">
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-sm">
                            {u.username ? u.username.substring(0,2).toUpperCase() : '??'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-white text-sm font-medium truncate">{u.username}</p>
                            <p className="text-slate-500 text-xs truncate">{u.email}</p>
                          </div>
                          <div className="ml-auto text-right">
                            <span className="block text-[10px] text-slate-400">{new Date(u.created_at).toLocaleDateString()}</span>
                            <span className="inline-block px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-slate-500 uppercase">{u.subscription_tier}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="bg-[#0B0B10] border border-white/10 rounded-xl overflow-hidden animate-fade-in shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-white/5 text-slate-400 font-medium text-xs uppercase tracking-wider">
                      <tr>
                        <th className="p-4">User Details</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Joined</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {(users || []).map((u) => (
                        <tr key={u.id} className="hover:bg-white/5 transition-colors group">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300">
                                {u.username ? u.username[0].toUpperCase() : '?'}
                              </div>
                              <div>
                                <div className="text-white font-medium flex items-center gap-2">
                                  {u.username}
                                  {u.is_admin && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 rounded border border-yellow-500/30">ADMIN</span>}
                                </div>
                                <div className="text-slate-500 text-xs">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${u.subscription_tier === 'pro' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-700/30 text-slate-400'}`}>
                              {(u.subscription_tier || 'free').toUpperCase()}
                            </span>
                          </td>
                          <td className="p-4 text-slate-500 font-mono text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                          <td className="p-4 text-right">
                            <button 
                              onClick={() => handleDeleteUser(u.id)}
                              className="p-2 bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              title="Delete User"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </Layout>
  );
}

const StatCard = ({ icon, label, value, subtext }: any) => (
  <div className="bg-[#0B0B10] border border-white/10 p-5 rounded-xl hover:border-indigo-500/30 transition-colors">
    <div className="flex items-start justify-between mb-4">
      <div className="p-3 bg-white/5 rounded-lg border border-white/5">
        {icon}
      </div>
      {subtext && <span className="text-[10px] text-slate-500 font-mono bg-white/5 px-2 py-1 rounded">{subtext}</span>}
    </div>
    <div>
      <p className="text-slate-500 text-xs font-medium uppercase tracking-wide mb-1">{label}</p>
      <p className="text-3xl font-bold text-white">{value}</p>
    </div>
  </div>
);