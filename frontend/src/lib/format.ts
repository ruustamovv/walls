/** Clock + label formatting shared by HUD, cards and lists. */

export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TC_NAMES: Record<string, string> = {
  '1+0': 'Bullet 1+0',
  '1+1': 'Bullet 1+1',
  '3+0': 'Blitz 3+0',
  '3+1': 'Blitz 3+1',
  '5+0': 'Rapid 5+0',
  '5+1': 'Rapid 5+1',
};

export function timeControlName(id: string): string {
  return TC_NAMES[id] ?? id;
}

/** Rating bucket matching the backend (finish.ts ratingModeFor). */
export function ratingModeFor(timeControlId: string): string {
  if (timeControlId.startsWith('1+')) return 'bullet';
  if (timeControlId.startsWith('3+')) return 'blitz';
  if (timeControlId.startsWith('5+')) return 'rapid';
  return 'casual';
}

export function resultLabel(winnerSeat: 0 | 1 | null, reason: string | null, perspective: 0 | 1 | null): string {
  if (winnerSeat === null) return 'Draw';
  if (perspective !== null) return winnerSeat === perspective ? 'You win' : 'You lose';
  return winnerSeat === 0 ? 'Player 1 wins' : 'Player 2 wins';
}

export function reasonLabel(reason: string | null): string {
  if (reason === 'timeout') return 'on time';
  if (reason === 'resign') return 'by resignation';
  if (reason === 'draw') return 'by agreement';
  return 'reached the goal';
}
