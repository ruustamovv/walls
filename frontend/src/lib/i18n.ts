/**
 * Shell-chrome labels.
 *
 * English-only by design: the in-app language switcher was removed, so the
 * multi-dictionary machinery is gone rather than left dormant. `useT()` stays
 * as the single place shell labels come from, so adding a locale later is a
 * local change rather than a refactor across the app.
 */
const STRINGS = {
  play: 'Play',
  puzzles: 'Puzzles',
  rush: 'Rush',
  learn: 'Learn',
  training: 'Training',
  ranks: 'Ranks',
  friends: 'Friends',
  clubs: 'Clubs',
  settings: 'Settings',
  login: 'Login',
  logout: 'Logout',
  search: 'Search',
  inbox: 'Inbox',
} as const;

export type LabelKey = keyof typeof STRINGS;

export function useT(): (key: string) => string {
  return (key: string): string =>
    STRINGS[key as LabelKey] ?? key;
}