/**
 * Toast notifications: transient, non-blocking feedback (match found,
 * challenge sent, errors). Auto-dismiss, capped stack, aria-live.
 */
import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'good' | 'bad';
  text: string;
}

let nextId = 1;

interface ToastState {
  items: Toast[];
  push: (kind: Toast['kind'], text: string) => void;
  dismiss: (id: number) => void;
}

export const useToasts = create<ToastState>()((set) => ({
  items: [],
  push: (kind, text) => {
    const id = nextId++;
    set((s) => ({ items: [...s.items.slice(-3), { id, kind, text }] }));
    setTimeout(() => {
      set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

export function toast(kind: Toast['kind'], text: string): void {
  useToasts.getState().push(kind, text);
}
