import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: number;
  username: string;
  email: string;
  is_admin?: boolean;           // #15 FIX: was missing — App.tsx guards /admin on this field
  subscription_tier: string;
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | 'free';
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  extra_storage_gb: number;
  avatar?: string;
  api_key?: string;
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
  setToken: (token: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  updateUserStatus: (status: User['subscription_status']) => void;
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

      setToken: (token) => {
        localStorage.setItem('auth_token', token);
        set({ token });
      },

      setUser: (user) => {
        set({ user });
      },

      updateUserStatus: (status) => {
        set((state) => ({
          user: state.user ? { ...state.user, subscription_status: status } : null
        }));
      },

      logout: () => {
        localStorage.removeItem('auth_token');
        set({ token: null, user: null });
      },
    }),
    { name: 'auth-storage' }
  )
);