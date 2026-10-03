/**
 * N-player board: same groove geometry as GameBoard, N pawn tokens,
 * per-seat goal-edge tinting. Pure renderer over the multi engine state.
 */
import { memo, useMemo, useState } from 'react';
import {
  getMultiLegalMoves,
  getMultiLegalWalls,
  type MultiAction,
  type MultiPos,
  type MultiState,
  type MultiWall,
  type SeatSide,
} from '../../../../engine/typescript/index.js';

export const SEAT_COLORS = ['var(--player-a)', 'var(--player-b)', 'var(--player-c)', 'var(--player-d)', 'var(--player-e)', 'var(--player-f)'];

export interface MultiBoardProps {
  state: MultiState;
  humanSeats: number[];
  interactive: boolean;
  onMove: (to: MultiPos) => void;
  onWall: (wall: MultiWall) => void;
  lastAction?: MultiAction | null;
}

function wallKey(w: MultiWall): string {
  return `${w.r},${w.c},${w.orientation}`;
}

function Pawn({ color, active }: { color: string; active: boolean }) {
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" style={{
      display: 'block', color,
      filter: active
        ? 'drop-shadow(0 0 6px currentColor) drop-shadow(0 2px 3px rgba(0,0,0,.4))'
        : 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
    }}>
      <circle cx="20" cy="20" r="13" fill={color} />
      <circle cx="20" cy="20" r="13" fill="none" stroke="#fff" strokeWidth="2.5" opacity=".85" />
      <circle cx="15.5" cy="15" r="4" fill="#fff" opacity=".35" />
    </svg>
  );
}

function goalTint(side: SeatSide, r: number, c: number, size: number): boolean {
  if (side === 'S') return r === size - 1;
  if (side === 'N') return r === 0;
  if (side === 'E') return c === size - 1;
  return c === 0;
}

export default memo(function MultiBoard({ state, humanSeats, interactive, onMove, onWall, lastAction = null }: MultiBoardProps) {
  const { size, players } = state;
  const canAct = interactive && !state.isOver && humanSeats.includes(state.turn);
  const [hover, setHover] = useState<string | null>(null);

  const legalMoves = useMemo(
    () => (canAct ? getMultiLegalMoves(state, state.turn) : []),
    [state, canAct],
  );
  const legalSet = useMemo(() => new Set(legalMoves.map((p) => `${p.r},${p.c}`)), [legalMoves]);
  const wallSet = useMemo(
    () => (canAct ? new Set(getMultiLegalWalls(state, state.turn).map(wallKey)) : new Set<string>()),
    [state, canAct],
  );
  const placedSet = useMemo(() => new Set(state.walls.map(wallKey)), [state.walls]);
  const placedBy = useMemo(() => new Map(state.walls.map((w) => [wallKey(w), w.by] as const)), [state.walls]);

  const tracks = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < 2 * size - 1; i++) parts.push(i % 2 === 0 ? '1fr' : '0.20fr');
    return parts.join(' ');
  }, [size]);

  const lastMoveTo = lastAction?.type === 'move' ? lastAction.to : null;
  const lastWallKey = lastAction?.type === 'wall' ? wallKey(lastAction.wall) : null;
  const pawnAt = (r: number, c: number): number | null => {
    for (let p = 0; p < players; p++) {
      const q = state.pawns[p];
      if (q !== undefined && q.r === r && q.c === c) return p;
    }
    return null;
  };

  const groove = (w: MultiWall, row: number | string, col: number | string) => {
    const key = wallKey(w);
    const placed = placedSet.has(key);
    const isHover = hover === key;
    const legal = wallSet.has(key);
    // Seat-colored walls: every seat reads its own share at a glance.
    const owner = placed ? placedBy.get(key) : undefined;
    const placedColor = owner === undefined ? 'var(--wall)' : (SEAT_COLORS[owner % SEAT_COLORS.length] as string);
    return (
      <button
        key={key}
        aria-label={`wall ${w.r},${w.c} ${w.orientation}${placed ? ' (placed)' : ''}`}
        disabled={!canAct || placed}
        onMouseEnter={() => setHover(key)}
        onMouseLeave={() => setHover((h) => (h === key ? null : h))}
        onFocus={() => setHover(key)}
        onBlur={() => setHover((h) => (h === key ? null : h))}
        onClick={() => onWall(w)}
        style={{
          gridRow: row as number,
          gridColumn: col as number | string,
          border: 'none', borderRadius: 4, padding: 0,
          background: placed
            ? placedColor
            : isHover && canAct
              ? legal ? 'var(--wall-ghost-ok)' : 'var(--wall-ghost-bad)'
              : 'transparent',
          cursor: canAct && !placed ? 'pointer' : 'default',
          animation: placed && lastWallKey === key ? 'nexus-wall-in .16s ease' : undefined,
          minHeight: 0, minWidth: 0,
        }}
      />
    );
  };

  const nodes: React.ReactNode[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const isLegal = legalSet.has(`${r},${c}`);
      const isLast = lastMoveTo !== null && lastMoveTo.r === r && lastMoveTo.c === c;
      const goals = state.sides.filter((s) => goalTint(s, r, c, size)).length;
      nodes.push(
        <button
          key={`cell-${r},${c}`}
          title={`${String.fromCharCode(97 + c)}${size - r}`}
          aria-label={`cell ${r},${c}`}
          disabled={!canAct || !isLegal}
          onClick={() => { if (isLegal) onMove({ r, c }); }}
          style={{
            gridRow: 2 * r + 1,
            gridColumn: 2 * c + 1,
            border: 'none',
            borderRadius: '22%',
            background: isLast
              ? 'var(--primary-soft)'
              : (r + c) % 2 === 0 ? 'var(--cell)' : 'var(--cell-alt)',
            boxShadow: goals > 0 ? 'inset 0 0 0 2px var(--goal)' : 'inset 0 0 0 1px rgba(16,20,24,.05)',
            cursor: isLegal && canAct ? 'pointer' : 'default',
            padding: 0, minHeight: 0, minWidth: 0, position: 'relative',
          }}
        >
          {isLegal && (
            <span style={{ width: '26%', height: '26%', borderRadius: '50%', background: 'var(--primary)', opacity: .55, margin: 'auto' }} />
          )}
        </button>,
      );
    }
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      nodes.push(groove({ r, c, orientation: 'h' }, 2 * r + 2, `${2 * c + 1} / span 3`));
      nodes.push(groove({ r, c, orientation: 'v' }, `${2 * r + 1} / span 3`, 2 * c + 2));
      nodes.push(
        <span key={`x-${r},${c}`} style={{ gridRow: 2 * r + 2, gridColumn: 2 * c + 2, background: 'rgba(16,20,24,.10)', borderRadius: '50%', transform: 'scale(.45)', pointerEvents: 'none' }} />,
      );
    }
  }

  const frTotal = size + (size - 1) * 0.2;
  const cellPct = 100 / frTotal;
  const center = (i: number): number => (i * 1.2 + 0.5) * cellPct;

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: '1' }}>
      <div
        role="grid"
        aria-label={`multiplayer board, ${size} by ${size}, ${players} players`}
        style={{
          display: 'grid', gridTemplateColumns: tracks, gridTemplateRows: tracks,
          width: '100%', height: '100%', background: 'var(--board-shell)',
          borderRadius: 14, padding: '1.2%',
          boxShadow: '0 8px 28px rgba(16,20,24,.12), inset 0 0 0 1px rgba(16,20,24,.06)',
          touchAction: 'manipulation',
        }}
      >
        {nodes}
      </div>
      <div aria-hidden style={{ position: 'absolute', inset: '1.2%', pointerEvents: 'none' }}>
        {state.pawns.map((pos, p) => {
          const w = cellPct * 0.86;
          return (
            <div
              key={p}
              style={{
                position: 'absolute',
                left: `${center(pos.c) - w / 2}%`,
                top: `${center(pos.r) - w / 2}%`,
                width: `${w}%`, height: `${w}%`,
                transition: 'left var(--dur-med) ease, top var(--dur-med) ease',
              }}
            >
              <Pawn color={SEAT_COLORS[p % SEAT_COLORS.length] as string} active={state.turn === p && !state.isOver} />
            </div>
          );
        })}
      </div>
    </div>
  );
})
