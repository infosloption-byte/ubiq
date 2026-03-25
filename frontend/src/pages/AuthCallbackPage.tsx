import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import axios from 'axios';

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken } = useAuthStore();
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const code  = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
      setErrorMsg('Google login failed: ' + error);
      setTimeout(() => navigate('/login'), 3000);
      return;
    }

    if (!code) {
      navigate('/login');
      return;
    }

    // Exchange the one-time code for the real Sanctum token.
    // The code is single-use and expires in 5 minutes server-side.
    axios.post(`${import.meta.env.VITE_API_URL}/auth/exchange`, { code })
      .then(res => {
        setToken(res.data.token);
        navigate('/dashboard');
      })
      .catch(() => {
        setErrorMsg('Login link expired or already used. Please try again.');
        setTimeout(() => navigate('/login'), 3000);
      });
  }, []);

  if (errorMsg) {
    return (
      <div className="min-h-screen bg-[#050509] flex items-center justify-center text-red-400">
        <p>{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050509] flex items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p>Completing sign in...</p>
      </div>
    </div>
  );
}