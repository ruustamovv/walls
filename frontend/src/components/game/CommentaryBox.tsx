/**
 * AI play-by-play for spectators: structured engine facts narrated on
 * demand (manual refresh — never auto-burns the viewer's quota).
 */
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { Button, Card, Spinner } from '../ui/primitives.js';

export default function CommentaryBox({ gameId }: { gameId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function update() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.commentate(gameId);
      if (res.available && res.commentary !== undefined) {
        setLines((l) => [...l.slice(-9), res.commentary as string]);
      } else {
        setNote(res.message ?? 'Commentary unavailable');
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Commentary unavailable');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Commentary</h3>
        <span style={{ marginLeft: 'auto' }}>
          <Button size="sm" variant="ghost" onClick={() => void update()} disabled={busy}>
            {busy ? 'Calling…' : lines.length === 0 ? 'Start commentary' : 'Update'}
          </Button>
        </span>
      </div>
      {lines.length === 0 && note === null && !busy && (
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Live narration of the verified position, on your cue.</p>
      )}
      {busy && lines.length === 0 && <Spinner />}
      {note !== null && <p style={{ color: 'var(--muted)', fontSize: 13 }}>{note}</p>}
      <div aria-live="polite" style={{ display: 'grid', gap: 8 }}>
        {lines.map((line, i) => (
          <p key={i} style={{ margin: 0, fontSize: 14, borderTop: i === 0 ? 'none' : '1px solid var(--line)', paddingTop: i === 0 ? 0 : 8 }}>
            <span style={{ marginRight: 6, color: 'var(--muted)', fontSize: 12, fontWeight: 800 }}>LIVE</span>{line}
          </p>
        ))}
      </div>
    </Card>
  );
}
