/**
 * Auth session store (zustand). Cookie session is authoritative; this store
 * only mirrors the logged-in user for UI. Refresh on app start.
 */
import { create } from 'zustand';
import { api, type SessionUser } from '../lib/api.js';

interface SessionState {
  user: SessionUser | null;
  checked: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (login: string, password: string) => Promise<boolean>;
  register: (email: string, username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  checked: false,
  busy: false,
  error: null,

  refresh: async () => {
    try {
      const { user } = await api.me();
      set({ user, checked: true, error: null });
    } catch {
      set({ user: null, checked: true });
    }
  },

  login: async (login, password) => {
    set({ busy: true, error: null });
    try {
      const { user } = await api.login({ login, password });
      set({ user, busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Login failed' });
      return false;
    }
  },

  register: async (email, username, password) => {
    set({ busy: true, error: null });
    try {
      const { user } = await api.register({ email, username, password });
      set({ user, busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Registration failed' });
      return false;
    }
  },

  logout: async () => {
    try {
      await api.logout();
    } finally {
      set({ user: null });
    }
  },
}));
