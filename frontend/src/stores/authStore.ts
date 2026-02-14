import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  username: string;
  email: string;
  subscription_tier: string;
  preferences?: {
    preferred_model: string;
    theme: string;
    editor_settings: any;
    auto_complete: boolean;
    code_suggestions: boolean;
  };
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  setToken: (token: string) => void; // <--- Added this line
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      
      setAuth: (token, user) => {
        localStorage.setItem('auth_token', token);
        set({ token, user });
      },

      // --- NEW FUNCTION TO FIX CRASH ---
      setToken: (token) => {
        localStorage.setItem('auth_token', token);
        set({ token });
      },
      
      setUser: (user) => {
        set({ user });
      },
      
      logout: () => {
        localStorage.removeItem('auth_token');
        set({ token: null, user: null });
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);