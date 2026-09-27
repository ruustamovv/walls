/**
 * Admin session — cookie session against the same backend.
 */
import { create } from 'zustand';
import { api } from '../lib/api.js';

interface SessionUser {
  id: string;
  username: string;
  role: string;
}

interface SessionState {
  user: SessionUser | null;
  checked: boolean;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  login: (login: string, password: string) => Promise<boolean>;
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
      const { user } = await api.login(login, password);
      set({ user, busy: false });
      return true;
    } catch (err) {
      set({ busy: false, error: err instanceof Error ? err.message : 'Login failed' });
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

export function isStaff(user: SessionUser | null): boolean {
  const role = user?.role ?? 'user';
  return role === 'admin' || role === 'moderator' || role === 'owner';
}
