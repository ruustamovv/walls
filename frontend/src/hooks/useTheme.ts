/**
 * Theme scope: game routes default to the dark arena, everything else to
 * the light site — unless the player pins a theme in Settings.
 */
import { useEffect } from 'react';
import { useSettings } from '../stores/settings.js';

export type ThemeName = 'site' | 'arena' | 'slate' | 'warm' | 'contrast';

const THEME_COLORS: Record<ThemeName, string> = {
  site: '#f7f5f0',
  arena: '#0b0e14',
  slate: '#eef1f4',
  warm: '#faf4e8',
  contrast: '#000000',
};

function apply(theme: ThemeName): ThemeName {
  const root = document.documentElement;
  const prev = (root.dataset['theme'] as ThemeName | undefined) ?? 'site';
  root.dataset['theme'] = theme;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[theme] ?? '#f7f5f0');
  return prev;
}

export function useTheme(routeDefault: ThemeName): void {
  const pinned = useSettings((s) => s.theme);
  useEffect(() => {
    const effective: ThemeName = pinned === 'auto' ? routeDefault : pinned;
    const prev = apply(effective);
    return () => {
      apply(prev);
    };
  }, [routeDefault, pinned]);
}

/** Imperative escape hatch (settings page preview). */
export function setThemeNow(theme: ThemeName): void {
  apply(theme);
}
