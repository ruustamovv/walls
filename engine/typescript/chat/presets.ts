/**
 * Ranked-safe quick chat presets (CHT-002).
 *
 * Ranked games allow ONLY these messages (server-enforced): short,
 * sportsmanlike, non-strategic. Casual games keep free text. The list is
 * matched exactly after trimming; keep it tiny and stable — clients and
 * server both import it from here.
 */
export const QUICK_CHAT = [
  'Good luck',
  'Nice move',
  'Well played',
  'Good game',
  'Rematch?',
] as const;

export type QuickChatMessage = (typeof QUICK_CHAT)[number];

/** True when the trimmed text is exactly one of the presets. */
export function isQuickChat(text: string): boolean {
  return (QUICK_CHAT as readonly string[]).includes(text.trim());
}
