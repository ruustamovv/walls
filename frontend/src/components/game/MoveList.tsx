/**
 * Move timeline: numbered plies from engine action history.
 */
import type { Action } from '../../../../engine/typescript/core/types.js';

function describe(a: Action, index: number): string {
  const n = `${Math.floor(index / 2) + 1}.${index % 2 === 0 ? '' : '…'}`;
  if (a.type === 'move') return `${n} → (${a.to.r}, ${a.to.c})`;
  return `${n} wall ${a.wall.orientation}@(${a.wall.r},${a.wall.c})`;
}

export default function MoveList({ actions }: { actions: Action[] }) {
  if (actions.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>No moves yet. White to play — move or build a wall.</p>;
  }
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 13 }}>
      {actions.map((a, i) => (
        <li key={i} style={{
          background: i === actions.length - 1 ? '#dbe7ff' : 'var(--bg)',
          border: '1px solid var(--line)', borderRadius: 8, padding: '3px 8px',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {describe(a, i)}
        </li>
      ))}
    </ol>
  );
}
