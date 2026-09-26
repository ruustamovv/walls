/**
 * Premium wall-and-pawn board.
 *
 * - Cells are buttons (click a highlighted tile to move).
 * - Wall grooves are hoverable buttons (ghost preview: blue = legal, red = illegal).
 * - Pawns are inline SVG pieces; goal rows are tinted; last action highlighted.
 * - Pure renderer: all legality comes from the deterministic engine via props.
 */
import { useMemo, useState } from 'react';
import { getLegalWalls } from '../../../../engine/typescript/index.js';
import type { Action, GameState, Pos, Wall } from '../../../../engine/typescript/core/types.js';
import { getLegalMoves } from '../../../../engine/typescript/index.js';

export interface GameBoardProps {
  state: GameState;
  /** Seats the local user may act for (both = local 2P, one = vs bot / online). */
  humanSeats: (0 | 1)[];
  interactive: boolean;
  onMove: (to: Pos) => void;
  onWall: (wall: Wall) => void;
  lastAction?: Action | null;
  /** Optional route overlay for analysis/casual (never ranked assistance). */
  showPaths?: { a: Pos[]; b: Pos[] } | null;
}

function wallKey(w: Wall): string {
  return `${w.r},${w.c},${w.orientation}`;
}

function Pawn({ player, active }: { player: 0 | 1; active: boolean }) {
  const fill = player === 0 ? 'var(--player-a)' : 'var(--player-b)';
  return (
    <svg
      viewBox="0 0 40 40"
      width="72%"
      height="72%"
      aria-label={player === 0 ? 'Player 1 pawn' : 'Player 2 pawn'}
      style={{ display: 'block', filter: 'drop-shadow(0 2px 3px rgba(16,20,24,.35))', animation: active ? 'nexus-pulse 2s ease-in-out infinite' : undefined }}
    >
      <circle cx="20" cy="20" r="13" fill={fill} />
      <circle cx="20" cy="20" r="13" fill="none" stroke="#fff" strokeWidth="2.5" opacity=".85" />
      <circle cx="15.5" cy="15" r="4" fill="#fff" opacity=".35" />
    </svg>
  );
}

export default function GameBoard({ state, humanSeats, interactive, onMove, onWall, lastAction = null, showPaths = null }: GameBoardProps) {
  const { size } = state;
  const canAct = interactive && !state.isOver && humanSeats.includes(state.turn);
  const [hover, setHover] = useState<string | null>(null);

  const legalMoves = useMemo(
    () => (canAct ? getLegalMoves(state, state.turn) : []),
    [state, canAct],
  );
  const legalSet = useMemo(() => new Set(legalMoves.map((p) => `${p.r},${p.c}`)), [legalMoves]);
  const wallSet = useMemo(
    () => (canAct ? new Set(getLegalWalls(state, state.turn).map(wallKey)) : new Set<string>()),
    [state, canAct],
  );
  const placedSet = useMemo(() => new Set(state.walls.map(wallKey)), [state.walls]);

  const tracks = useMemo(() => {
    const parts: string[] = [];
    for (let i = 0; i < 2 * size - 1; i++) parts.push(i % 2 === 0 ? '1fr' : '0.20fr');
    return parts.join(' ');
  }, [size]);

  const lastMoveTo = lastAction?.type === 'move' ? lastAction.to : null;
  const lastWallKey = lastAction?.type === 'wall' ? wallKey(lastAction.wall) : null;
  const pathCells = useMemo(() => {
    const set = new Set<string>();
    if (showPaths !== null) {
      for (const p of showPaths.a) set.add(`a${p.r},${p.c}`);
      for (const p of showPaths.b) set.add(`b${p.r},${p.c}`);
    }
    return set;
  }, [showPaths]);

  const renderHGroove = (r: number, c: number) => {
    const w: Wall = { r, c, orientation: 'h' };
    const key = wallKey(w);
    const placed = placedSet.has(key);
    const isHover = hover === key;
    const legal = wallSet.has(key);
    return (
      <button
        key={key}
        aria-label={`wall row ${r} col ${c} horizontal${placed ? ' (placed)' : ''}`}
        disabled={!canAct || placed}
        onMouseEnter={() => setHover(key)}
        onMouseLeave={() => setHover((h) => (h === key ? null : h))}
        onFocus={() => setHover(key)}
        onBlur={() => setHover((h) => (h === key ? null : h))}
        onClick={() => onWall(w)}
        style={{
          gridRow: 2 * r + 2,
          gridColumn: `${2 * c + 1} / span 3`,
          border: 'none',
          borderRadius: 4,
          padding: 0,
          background: placed
            ? 'var(--wall)'
            : isHover && canAct
              ? legal ? 'var(--wall-ghost-ok)' : 'var(--wall-ghost-bad)'
              : 'transparent',
          cursor: canAct && !placed ? 'pointer' : 'default',
          animation: placed && lastWallKey === key ? 'nexus-wall-in .16s ease' : undefined,
          minHeight: 0,
          minWidth: 0,
        }}
      />
    );
  };

  const renderVGroove = (r: number, c: number) => {
    const w: Wall = { r, c, orientation: 'v' };
    const key = wallKey(w);
    const placed = placedSet.has(key);
    const isHover = hover === key;
    const legal = wallSet.has(key);
    return (
      <button
        key={key}
        aria-label={`wall row ${r} col ${c} vertical${placed ? ' (placed)' : ''}`}
        disabled={!canAct || placed}
        onMouseEnter={() => setHover(key)}
        onMouseLeave={() => setHover((h) => (h === key ? null : h))}
        onFocus={() => setHover(key)}
        onBlur={() => setHover((h) => (h === key ? null : h))}
        onClick={() => onWall(w)}
        style={{
          gridRow: `${2 * r + 1} / span 3`,
          gridColumn: 2 * c + 2,
          border: 'none',
          borderRadius: 4,
          padding: 0,
          background: placed
            ? 'var(--wall)'
            : isHover && canAct
              ? legal ? 'var(--wall-ghost-ok)' : 'var(--wall-ghost-bad)'
              : 'transparent',
          cursor: canAct && !placed ? 'pointer' : 'default',
          animation: placed && lastWallKey === key ? 'nexus-wall-in .16s ease' : undefined,
          minHeight: 0,
          minWidth: 0,
        }}
      />
    );
  };

  const nodes: React.ReactNode[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const pawn = state.pawns[0].r === r && state.pawns[0].c === c ? 0 : state.pawns[1].r === r && state.pawns[1].c === c ? 1 : null;
      const isLegal = legalSet.has(`${r},${c}`);
      const isLast = lastMoveTo !== null && lastMoveTo.r === r && lastMoveTo.c === c;
      const isGoalRow = r === 0 || r === size - 1;
      nodes.push(
        <button
          key={`cell-${r},${c}`}
          aria-label={`cell ${r},${c}${pawn !== null ? `, player ${pawn + 1}` : ''}`}
          disabled={!canAct || (!isLegal && pawn === null)}
          onClick={() => { if (isLegal) onMove({ r, c }); }}
          style={{
            gridRow: 2 * r + 1,
            gridColumn: 2 * c + 1,
            border: 'none',
            borderRadius: '22%',
            background: isLast
              ? '#dbe7ff'
              : (r + c) % 2 === 0 ? 'var(--cell)' : 'var(--cell-alt)',
            boxShadow: isGoalRow ? 'inset 0 0 0 2px var(--goal)' : 'inset 0 0 0 1px rgba(16,20,24,.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isLegal && canAct ? 'pointer' : 'default',
            padding: 0,
            minHeight: 0,
            minWidth: 0,
            position: 'relative',
          }}
        >
          {pawn !== null && <Pawn player={pawn} active={state.turn === pawn && !state.isOver} />}
          {pawn === null && isLegal && (
            <span style={{ width: '26%', height: '26%', borderRadius: '50%', background: 'var(--primary)', opacity: .55 }} />
          )}
          {pawn === null && pathCells.has(`a${r},${c}`) && (
            <span style={{ position: 'absolute', inset: '8%', borderRadius: '20%', border: '2px dashed rgba(26,86,219,.5)', pointerEvents: 'none' }} />
          )}
          {pawn === null && pathCells.has(`b${r},${c}`) && (
            <span style={{ position: 'absolute', inset: '8%', borderRadius: '20%', border: '2px dashed rgba(194,65,12,.5)', pointerEvents: 'none' }} />
          )}
        </button>,
      );
    }
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      nodes.push(renderHGroove(r, c));
      nodes.push(renderVGroove(r, c));
      nodes.push(
        <span key={`x-${r},${c}`} style={{ gridRow: 2 * r + 2, gridColumn: 2 * c + 2, background: 'rgba(16,20,24,.10)', borderRadius: '50%', transform: 'scale(.45)', pointerEvents: 'none' }} />,
      );
    }
  }

  return (
    <div
      role="grid"
      aria-label={`wall-and-pawn board, ${size} by ${size}`}
      style={{
        display: 'grid',
        gridTemplateColumns: tracks,
        gridTemplateRows: tracks,
        width: '100%',
        aspectRatio: '1',
        background: '#e9e4d8',
        borderRadius: 14,
        padding: '1.2%',
        boxShadow: '0 8px 28px rgba(16,20,24,.12), inset 0 0 0 1px rgba(16,20,24,.06)',
        touchAction: 'manipulation',
      }}
    >
      {nodes}
    </div>
  );
}
