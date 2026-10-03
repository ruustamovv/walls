/**
 * Player settings (persisted to localStorage): theme override, sound,
 * board coordinates. Theme: 'auto' follows the route (site/arena).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeChoice = 'auto' | 'site' | 'arena' | 'slate' | 'warm' | 'contrast';
export type BoardTheme = 'midnight' | 'paper' | 'ember' | 'quoridor' | 'forest' | 'ocean' | 'desert' | 'royal';
export type PawnSet = 'classic' | 'ring';
/** Page backdrop: starry nebula or flat surface. */
export type AppBackground = 'nebula' | 'plain';

interface SettingsState {
  theme: ThemeChoice;
  sound: boolean;
  volume: number; // 0..100
  showCoords: boolean;
  boardTheme: BoardTheme;
  pawnSet: PawnSet;
  confirmWall: boolean;
  appBackground: AppBackground;
  setTheme: (t: ThemeChoice) => void;
  setSound: (on: boolean) => void;
  setVolume: (v: number) => void;
  setShowCoords: (on: boolean) => void;
  setBoardTheme: (t: BoardTheme) => void;
  setPawnSet: (s: PawnSet) => void;
  setConfirmWall: (on: boolean) => void;
  setAppBackground: (b: AppBackground) => void;
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
      appBackground: 'nebula',
      setTheme: (theme) => set({ theme }),
      setSound: (sound) => set({ sound }),
      setVolume: (volume) => set({ volume: Math.min(100, Math.max(0, Math.round(volume))) }),
      setShowCoords: (showCoords) => set({ showCoords }),
      setBoardTheme: (boardTheme) => set({ boardTheme }),
      setPawnSet: (pawnSet) => set({ pawnSet }),
      setConfirmWall: (confirmWall) => set({ confirmWall }),
      setAppBackground: (appBackground) => set({ appBackground }),
    }),
    { name: 'quoridor-settings' },
  ),
);
