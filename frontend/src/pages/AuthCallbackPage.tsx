import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setToken, setUser } = useAuthStore();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (token) {
      // 1. Save Token
      setToken(token);
      localStorage.setItem('auth_token', token); // Ensure standard key

      // 2. Fetch User Profile immediately to populate store
      // (Assuming you have a fetchUser action or just redirect to dashboard where it loads)
      navigate('/dashboard');
    } else if (error) {
      alert('Login Failed: ' + error);
      navigate('/login');
    } else {
      navigate('/login');
    }
  }, [searchParams, navigate, setToken]);

  return (
    <div className="min-h-screen bg-[#050509] flex items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
        <p>Authenticating...</p>
      </div>
    </div>
  );
}