/**
 * Player settings (persisted to localStorage): theme override, sound,
 * board coordinates. Theme: 'auto' follows the route (site/arena).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeChoice = 'auto' | 'site' | 'arena';
export type BoardTheme = 'midnight' | 'paper' | 'ember';
export type PawnSet = 'classic' | 'ring';
export type LangChoice = 'en' | 'ru' | 'uz';

interface SettingsState {
  theme: ThemeChoice;
  sound: boolean;
  volume: number; // 0..100
  showCoords: boolean;
  boardTheme: BoardTheme;
  pawnSet: PawnSet;
  confirmWall: boolean;
  language: LangChoice;
  setTheme: (t: ThemeChoice) => void;
  setSound: (on: boolean) => void;
  setVolume: (v: number) => void;
  setShowCoords: (on: boolean) => void;
  setBoardTheme: (t: BoardTheme) => void;
  setPawnSet: (s: PawnSet) => void;
  setConfirmWall: (on: boolean) => void;
  setLanguage: (l: LangChoice) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'auto',
      sound: true,
      volume: 80,
      showCoords: false,
      boardTheme: 'midnight',
      pawnSet: 'classic',
      confirmWall: false,
      language: 'en',
      setTheme: (theme) => set({ theme }),
      setSound: (sound) => set({ sound }),
      setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, Math.round(volume))) }),
      setShowCoords: (showCoords) => set({ showCoords }),
      setBoardTheme: (boardTheme) => set({ boardTheme }),
      setPawnSet: (pawnSet) => set({ pawnSet }),
      setConfirmWall: (confirmWall) => set({ confirmWall }),
      setLanguage: (language) => set({ language }),
    }),
    { name: 'nexus-settings' },
  ),
);
