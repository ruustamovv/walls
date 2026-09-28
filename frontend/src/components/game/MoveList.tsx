/**
 * Move timeline: algebraic notation, click-to-seek, auto-scroll, copy/export.
 * `ply` = how many plies are currently shown (parents drive replay scrub).
 */
import { memo, useEffect, useRef } from 'react';
import { actionName, lineNotation } from '../../lib/coords.js';

type Action = { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } };

export default memo(function MoveList({ actions, size, ply, onSeek, onExport }: {
  actions: Action[];
  size: number;
  ply?: number;
  onSeek?: (ply: number) => void;
  onExport?: () => void;
}) {
  const shown = ply ?? actions.length;
  const endRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shown]);

  async function copyLine(): Promise<void> {
    try {
      await navigator.clipboard.writeText(lineNotation(actions, size));
    } catch {
      // clipboard unavailable — export button covers downloads
    }
  }

  if (actions.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>No moves yet. Move, or spend a wall.</p>;
  }

  const rows: { n: number; white?: number; black?: number }[] = [];
  for (let i = 0; i < actions.length; i += 2) {
    rows.push({ n: Math.floor(i / 2) + 1, white: i, black: i + 1 < actions.length ? i + 1 : undefined });
  }

  const cell = (idx: number | undefined) => {
    if (idx === undefined) return <span style={{ flex: 1 }} />;
    const active = idx < shown;
    const isLast = idx === shown - 1;
    return (
      <button
        onClick={() => onSeek?.(idx + 1)}
        disabled={onSeek === undefined}
        title={onSeek === undefined ? undefined : `Jump to move ${idx + 1}`}
        style={{
          flex: 1, textAlign: 'left', borderRadius: 6, padding: '3px 8px', fontSize: 13,
          fontFamily: 'var(--font-mono)', border: 'none', cursor: onSeek === undefined ? 'default' : 'pointer',
          background: isLast ? 'var(--primary-soft)' : 'transparent',
          color: active ? 'var(--ink)' : 'var(--faint)', fontWeight: isLast ? 800 : 400,
        }}
      >
        {actionName(actions[idx] as Action, size)}
      </button>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{shown}/{actions.length} moves</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button onClick={() => void copyLine()} style={miniBtn} title="Copy notation">Copy</button>
          {onExport !== undefined && <button onClick={onExport} style={miniBtn} title="Download game JSON">Export</button>}
        </span>
      </div>
      <ol ref={undefined} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 220, overflowY: 'auto', fontSize: 13 }}>
        {rows.map((r) => (
          <li
            key={r.n}
            ref={r.n === rows.length ? endRef : undefined}
            style={{ display: 'flex', gap: 4, alignItems: 'center' }}
          >
            <span style={{ color: 'var(--muted)', width: 30, fontVariantNumeric: 'tabular-nums' }}>{r.n}.</span>
            {cell(r.white)}
            {cell(r.black)}
          </li>
        ))}
      </ol>
    </div>
  );
})

const miniBtn: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 6,
  padding: '3px 8px', fontSize: 12, fontWeight: 700, color: 'var(--ink)',
};
