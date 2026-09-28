/**
 * Path-pressure meter: live route-length duel from engine facts.
 * Shows distance only — no advice, ranked-safe.
 */
import { memo } from 'react';

export default memo(function PathMeter({ own, opp, flip = false }: { own: number; opp: number; flip?: boolean }) {
  const a = own < 0 ? 99 : own;
  const b = opp < 0 ? 99 : opp;
  const total = Math.max(1, a + b);
  const ownPct = (b / total) * 100; // bigger share = opponent walks further = good
  const diff = b - a;
  const left = flip ? 'var(--player-b)' : 'var(--player-a)';
  return (
    <div role="img" aria-label={`Shortest routes: you ${own}, opponent ${opp}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
        <span className="font-mono" style={{ color: left, fontWeight: 800 }}>{own}</span>
        <span>{diff === 0 ? 'even race' : diff > 0 ? `+${diff} you` : `${diff} them`}</span>
        <span className="font-mono" style={{ fontWeight: 800 }}>{opp}</span>
      </div>
      <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-2)', border: '1px solid var(--line)', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${ownPct}%`, background: left, transition: 'width var(--dur-med) ease' }} />
        <div style={{ flex: 1, background: flip ? 'var(--player-a)' : 'var(--player-b)', opacity: 0.75, transition: 'flex var(--dur-med) ease' }} />
      </div>
    </div>
  );
})
