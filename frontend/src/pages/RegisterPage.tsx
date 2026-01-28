import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { SparklesIcon, CheckCircleIcon } from '@heroicons/react/24/solid';

export default function RegisterPage() {
  const [formData, setFormData] = useState({ username: '', email: '', password: '', password_confirmation: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== formData.password_confirmation) return setError("Passwords don't match");
    setError('');
    setLoading(true);

    try {
      const res = await authAPI.register(formData);
      setAuth(res.data.token, res.data.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-ubiq-950 text-slate-300">
      {/* Left: Form Section */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24 z-10 relative">
         {/* Simple background glow for mobile/tablet */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 lg:hidden">
           <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-ubiq-accent/10 rounded-full blur-[80px]" />
        </div>

        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="mb-10">
            <h2 className="text-3xl font-bold text-white tracking-tight">Create account</h2>
            <p className="mt-2 text-sm text-slate-500">Start building with AI today.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
             {error && <div className="text-red-400 text-sm bg-red-500/10 p-3 rounded-lg border border-red-500/20">{error}</div>}
             
             <div className="space-y-1">
               <label className="text-xs font-medium text-slate-400 ml-1">Username</label>
               <input 
                 required 
                 className="input-primary w-full" 
                 placeholder="jdoe"
                 value={formData.username}
                 onChange={e => setFormData({...formData, username: e.target.value})}
               />
             </div>

             <div className="space-y-1">
               <label className="text-xs font-medium text-slate-400 ml-1">Email</label>
               <input 
                 type="email" required 
                 className="input-primary w-full" 
                 placeholder="you@company.com"
                 value={formData.email}
                 onChange={e => setFormData({...formData, email: e.target.value})}
               />
             </div>

             <div className="space-y-1">
               <label className="text-xs font-medium text-slate-400 ml-1">Password</label>
               <input 
                 type="password" required minLength={8}
                 className="input-primary w-full" 
                 placeholder="••••••••"
                 value={formData.password}
                 onChange={e => setFormData({...formData, password: e.target.value})}
               />
             </div>

             <div className="space-y-1">
               <label className="text-xs font-medium text-slate-400 ml-1">Confirm Password</label>
               <input 
                 type="password" required 
                 className="input-primary w-full" 
                 placeholder="••••••••"
                 value={formData.password_confirmation}
                 onChange={e => setFormData({...formData, password_confirmation: e.target.value})}
               />
             </div>

             <button type="submit" disabled={loading} className="btn-primary w-full py-3 mt-4">
               {loading ? 'Creating...' : 'Create Account'}
             </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            Already a member? <Link to="/login" className="font-medium text-ubiq-accent hover:text-white">Sign in</Link>
          </p>
        </div>
      </div>

      {/* Right: Visual Section (Hidden on Mobile) */}
      <div className="hidden lg:flex flex-1 relative bg-ubiq-900 overflow-hidden items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-ubiq-accent/20 to-purple-900/20 opacity-30" />
        <div className="relative z-10 max-w-md px-8 text-center">
           <div className="w-20 h-20 bg-gradient-to-br from-ubiq-accent to-purple-600 rounded-3xl flex items-center justify-center text-white font-bold text-3xl mx-auto mb-8 shadow-2xl shadow-ubiq-accent/30">
              U
           </div>
           <h3 className="text-2xl font-bold text-white mb-6">Unlock your potential</h3>
           <ul className="space-y-4 text-left inline-block">
              {[
                'Smart Code Completion',
                'Real-time AI Chat Debugging',
                'Automated Code Reviews',
                'Private & Secure Environment'
              ].map((item, i) => (
                <li key={i} className="flex items-center text-slate-300">
                  <CheckCircleIcon className="w-5 h-5 text-ubiq-accent mr-3" />
                  {item}
                </li>
              ))}
           </ul>
        </div>
      </div>
    </div>
  );
}