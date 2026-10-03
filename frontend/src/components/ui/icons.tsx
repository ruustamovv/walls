/**
 * House icon set: single-weight stroke glyphs (24 grid, round caps).
 * One visual voice everywhere — no emoji icons in the UI.
 */
export type IconName =
  | 'bolt'
  | 'rocket'
  | 'clock'
  | 'bot'
  | 'coach'
  | 'friend'
  | 'dice'
  | 'flame'
  | 'chart'
  | 'archive'
  | 'lock'
  | 'shield';

const PATHS: Record<IconName, React.ReactNode> = {
  bolt: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />,
  rocket: (
    <>
      <path d="M12 2c3 2 5 6 5 10l-5 4-5-4c0-4 2-8 5-10z" />
      <circle cx="12" cy="9" r="1.6" />
      <path d="M7.5 15.5 5 21M16.5 15.5 19 21" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  bot: (
    <>
      <rect x="5" y="9" width="14" height="10" rx="2.5" />
      <path d="M12 9V4.5M9.5 4.5h5" />
      <path d="M9.5 13.5h.01M14.5 13.5h.01" />
      <path d="M9.5 16.5h5" />
    </>
  ),
  coach: (
    <>
      <path d="M3.5 10.5v3L8 14.5l9 4.5v-14l-9 4.5-4.5 1z" />
      <path d="M20 9.5a3.5 3.5 0 010 5" />
    </>
  ),
  friend: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <circle cx="16.8" cy="9" r="2.4" />
      <path d="M15.8 14.3c2.7.3 4.7 2.3 4.7 4.7" />
    </>
  ),
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" />
    </>
  ),
  flame: <path d="M12 2C8.5 6.5 5.5 9.8 5.5 14a6.5 6.5 0 0013 0C18.5 9.5 14.5 6.5 12 2z" />,
  chart: (
    <>
      <path d="M5 20v-6M11 20V5M17 20v-9" />
      <path d="M3 20h18" />
    </>
  ),
  archive: (
    <>
      <rect x="4" y="3.5" width="16" height="4.5" rx="1" />
      <path d="M6 8v12.5h12V8" />
      <path d="M10 12h4" />
    </>
  ),
  lock: (
    <>
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M9 11V8a3 3 0 016 0v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" />
      <path d="M9 11.5l2 2 4-4" />
    </>
  ),
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  );
}
