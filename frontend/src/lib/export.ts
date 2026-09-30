/**
 * Game export: download the portable JSON record (works offline, replays
 * anywhere via the deterministic engine).
 */
export function exportGame(gameId: string, payload: unknown): void {
  try {
    const blob = new Blob([JSON.stringify({ gameId, exportedAt: new Date().toISOString(), game: payload }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quoridor-game-${gameId.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    // download unavailable — copy path covers sharing
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
