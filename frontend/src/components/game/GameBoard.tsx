/**
 * Premium wall-and-pawn board.
 *
 * - Cells are buttons (click a highlighted tile to move).
 * - Wall grooves are hoverable buttons (ghost preview: blue = legal, red = illegal).
 * - Pawns glide on an overlay layer; goal rows tinted; last action highlighted.
 * - Pure renderer: all legality comes from the deterministic engine via props.
 *
 * Performance: cells/grooves/pawns are memoized on primitive props, so
 * clock ticks that don't touch board state skip the whole tree. Hover
 * previews are rAF-debounced to keep groove sweeps at 60fps.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../../stores/settings.js';
import { applyMove, getLegalMoves, getLegalWalls, getPathMetrics } from '../../../../engine/typescript/index.js';
import type { Action, GameState, Pos, Wall } from '../../../../engine/typescript/core/types.js';
import type { PawnSet } from '../../stores/settings.js';
import { wallName } from '../../lib/coords.js';

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

const Pawn = memo(function Pawn({ player, active, skin }: { player: 0 | 1; active: boolean; skin: PawnSet }) {
  const fill = player === 0 ? 'var(--player-a)' : 'var(--player-b)';
  return (
    <svg
      viewBox="0 0 40 40"
      width="100%"
      height="100%"
      aria-label={player === 0 ? 'Player 1 pawn' : 'Player 2 pawn'}
      style={{
        display: 'block',
        filter: active
          ? 'drop-shadow(0 0 6px currentColor) drop-shadow(0 2px 3px rgba(0,0,0,.4))'
          : 'drop-shadow(0 2px 3px rgba(0,0,0,.35))',
        color: fill,
      }}
    >
      {skin === 'ring' ? (
        <>
          <circle cx="20" cy="20" r="13" fill="none" stroke={fill} strokeWidth="6" />
          <circle cx="20" cy="20" r="5" fill={fill} />
        </>
      ) : (
        <>
          <circle cx="20" cy="20" r="13" fill={fill} />
          <circle cx="20" cy="20" r="13" fill="none" stroke="#fff" strokeWidth="2.5" opacity=".85" />
          <circle cx="15.5" cy="15" r="4" fill="#fff" opacity=".35" />
        </>
      )}
    </svg>
  );
});

interface CellProps {
  r: number;
  c: number;
  size: number;
  isLegal: boolean;
  isLast: boolean;
  isGoalRow: boolean;
  canAct: boolean;
  showA: boolean;
  showB: boolean;
  hasPawn: boolean;
  pawnLabel: string;
  onMove: (to: Pos) => void;
}

const CellButton = memo(function CellButton(props: CellProps) {
  const { r, c, size, isLegal, isLast, isGoalRow, canAct, showA, showB, hasPawn, pawnLabel, onMove } = props;
  return (
    <button
      aria-label={`cell ${r},${c}${pawnLabel}`}
      disabled={!canAct || (!isLegal && !hasPawn)}
      onClick={() => { if (isLegal) onMove({ r, c }); }}
      style={{
        gridRow: 2 * r + 1,
        gridColumn: 2 * c + 1,
        border: 'none',
        borderRadius: '22%',
        background: isLast
          ? 'var(--primary-soft)'
          : (r + c) % 2 === 0 ? 'var(--cell)' : 'var(--cell-alt)',
        boxShadow: isGoalRow ? 'inset 0 0 0 2px var(--goal)' : 'inset 0 0 0 1px rgba(16,20,24,.05)',
        cursor: isLegal && canAct ? 'pointer' : 'default',
        padding: 0,
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
      }}
    >
      <span title={`${String.fromCharCode(97 + c)}${size - r}`} style={{ position: 'absolute', inset: 0 }} aria-hidden />
      {!hasPawn && isLegal && (
        <span style={{ position: 'absolute', left: '37%', top: '37%', width: '26%', height: '26%', borderRadius: '50%', background: 'var(--primary)', opacity: .55 }} />
      )}
      {!hasPawn && showA && (
        <span style={{ position: 'absolute', inset: '8%', borderRadius: '20%', border: '2px dashed rgba(26,86,219,.5)', pointerEvents: 'none' }} />
      )}
      {!hasPawn && showB && (
        <span style={{ position: 'absolute', inset: '8%', borderRadius: '20%', border: '2px dashed rgba(194,65,12,.5)', pointerEvents: 'none' }} />
      )}
    </button>
  );
});

interface GrooveProps {
  wall: Wall;
  label: string;
  row: number | string;
  col: number | string;
  placed: boolean;
  highlighted: boolean;
  legal: boolean;
  armed: boolean;
  canAct: boolean;
  isLastWall: boolean;
  onEnter: (key: string) => void;
  onLeave: () => void;
  onFire: (wall: Wall) => void;
}

const GrooveButton = memo(function GrooveButton(props: GrooveProps) {
  const { wall, label, row, col, placed, highlighted, legal, armed, canAct, isLastWall, onEnter, onLeave, onFire } = props;
  const key = wallKey(wall);
  return (
    <button
      key={key}
      aria-label={label}
      disabled={!canAct || placed}
      onMouseEnter={() => onEnter(key)}
      onMouseLeave={onLeave}
      onFocus={() => onEnter(key)}
      onBlur={onLeave}
      onClick={() => onFire(wall)}
      style={{
        gridRow: row,
        gridColumn: col,
        border: armed ? '2px solid var(--primary)' : 'none',
        borderRadius: 4,
        padding: 0,
        background: placed
          ? 'var(--wall)'
          : armed
            ? 'var(--wall-ghost-ok)'
            : highlighted && canAct
              ? legal ? 'var(--wall-ghost-ok)' : 'var(--wall-ghost-bad)'
              : 'transparent',
        cursor: canAct && !placed ? 'pointer' : 'default',
        animation: placed && isLastWall ? 'nexus-wall-in .16s ease' : undefined,
        minHeight: 0,
        minWidth: 0,
      }}
    />
  );
});

interface PawnTokenProps {
  seat: 0 | 1;
  r: number;
  c: number;
  center: (i: number) => number;
  cellW: number;
  active: boolean;
  crowned: boolean;
  moveNumber: number;
  skin: PawnSet;
}

const PawnToken = memo(function PawnToken(props: PawnTokenProps) {
  const { seat, r, c, center, cellW, active, crowned, moveNumber, skin } = props;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${center(c) - cellW / 2}%`,
        top: `${center(r) - cellW / 2}%`,
        width: `${cellW}%`,
        height: `${cellW}%`,
        transition: 'left var(--dur-med) ease, top var(--dur-med) ease',
      }}
    >
      <div key={moveNumber} style={{ width: '100%', height: '100%', animation: 'nexus-hop .28s ease' }}>
        <Pawn player={seat} active={active} skin={skin} />
      </div>
      {crowned && (
        <span style={{
          position: 'absolute', inset: '-18%', borderRadius: '50%',
          border: '3px solid var(--good)', animation: 'nexus-ring 1.1s ease-out infinite',
        }} />
      )}
    </div>
  );
});

function GameBoardInner({ state, humanSeats, interactive, onMove, onWall, lastAction = null, showPaths = null }: GameBoardProps) {
  const { size } = state;
  const canAct = interactive && !state.isOver && humanSeats.includes(state.turn);
  const [hover, setHover] = useState<string | null>(null);
  const boardTheme = useSettings((s) => s.boardTheme);
  const skin = useSettings((s) => s.pawnSet);
  const confirmWall = useSettings((s) => s.confirmWall);
  // Two-tap wall confirm (touch safety): first tap arms, second fires.
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const confirmRef = useRef(confirmWall);
  confirmRef.current = confirmWall;
  const onWallRef = useRef(onWall);
  onWallRef.current = onWall;
  const canActRef = useRef(canAct);
  canActRef.current = canAct;

  useEffect(() => {
    pendingRef.current = null;
    setPending(null);
  }, [state.moveNumber]);

  // rAF-debounced hover: groove sweeps stay at 60fps, ghost appears pre-paint.
  const hoverRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(hoverRaf.current), []);
  const onEnter = useCallback((key: string) => {
    cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => setHover(key));
  }, []);
  const onLeave = useCallback(() => {
    cancelAnimationFrame(hoverRaf.current);
    setHover(null);
  }, []);

  const fireWall = useCallback((w: Wall) => {
    const key = wallKey(w);
    if (confirmRef.current && canActRef.current && pendingRef.current !== key) {
      pendingRef.current = key;
      setPending(key);
      setHover(key);
      return;
    }
    pendingRef.current = null;
    setPending(null);
    onWallRef.current(w);
  }, []);

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

  // Projected route impact for the hovered groove (preview only, no advice).
  const preview = useMemo(() => {
    if (hover === null || !canAct) return null;
    const [r, c, o] = hover.split(',');
    if (r === undefined || c === undefined || (o !== 'h' && o !== 'v')) return null;
    const wall: Wall = { r: Number(r), c: Number(c), orientation: o };
    if (!wallSet.has(hover)) return { legal: false as const, wall };
    try {
      const next = applyMove(state, { type: 'wall', wall }).state;
      const me = state.turn;
      const other = (1 - me) as 0 | 1;
      const before = getPathMetrics(state);
      const after = getPathMetrics(next);
      const ownBefore = me === 0 ? before.pathLengthA : before.pathLengthB;
      const oppBefore = me === 0 ? before.pathLengthB : before.pathLengthA;
      const ownAfter = me === 0 ? after.pathLengthA : after.pathLengthB;
      const oppAfter = me === 0 ? after.pathLengthB : after.pathLengthA;
      return { legal: true as const, wall, ownDelta: ownAfter - ownBefore, oppDelta: oppAfter - oppBefore };
    } catch {
      return { legal: false as const, wall };
    }
  }, [hover, canAct, wallSet, state]);

  const nodes: React.ReactNode[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const p0 = state.pawns[0];
      const p1 = state.pawns[1];
      const hasPawn = (p0.r === r && p0.c === c) || (p1.r === r && p1.c === c);
      const pawnLabel = p0.r === r && p0.c === c ? ', player 1' : p1.r === r && p1.c === c ? ', player 2' : '';
      nodes.push(
        <CellButton
          key={`cell-${r},${c}`}
          r={r} c={c} size={size}
          isLegal={legalSet.has(`${r},${c}`)}
          isLast={lastMoveTo !== null && lastMoveTo.r === r && lastMoveTo.c === c}
          isGoalRow={r === 0 || r === size - 1}
          canAct={canAct}
          showA={pathCells.has(`a${r},${c}`)}
          showB={pathCells.has(`b${r},${c}`)}
          hasPawn={hasPawn}
          pawnLabel={pawnLabel}
          onMove={onMove}
        />,
      );
    }
  }
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const h: Wall = { r, c, orientation: 'h' };
      const v: Wall = { r, c, orientation: 'v' };
      const hk = wallKey(h);
      const vk = wallKey(v);
      nodes.push(
        <GrooveButton
          key={hk} wall={h} label={`wall row ${r} col ${c} horizontal${placedSet.has(hk) ? ' (placed)' : ''}`}
          row={2 * r + 2} col={`${2 * c + 1} / span 3`}
          placed={placedSet.has(hk)} highlighted={hover === hk} legal={wallSet.has(hk)}
          armed={pending === hk} canAct={canAct} isLastWall={lastWallKey === hk}
          onEnter={onEnter} onLeave={onLeave} onFire={fireWall}
        />,
        <GrooveButton
          key={vk} wall={v} label={`wall row ${r} col ${c} vertical${placedSet.has(vk) ? ' (placed)' : ''}`}
          row={`${2 * r + 1} / span 3`} col={2 * c + 2}
          placed={placedSet.has(vk)} highlighted={hover === vk} legal={wallSet.has(vk)}
          armed={pending === vk} canAct={canAct} isLastWall={lastWallKey === vk}
          onEnter={onEnter} onLeave={onLeave} onFire={fireWall}
        />,
        <span key={`x-${r},${c}`} style={{ gridRow: 2 * r + 2, gridColumn: 2 * c + 2, background: 'rgba(16,20,24,.10)', borderRadius: '50%', transform: 'scale(.45)', pointerEvents: 'none' }} />,
      );
    }
  }

  // Pawn overlay: tokens glide between cells via CSS transition on the
  // percentage position (grid relocation itself is not transitionable).
  const frTotal = size + (size - 1) * 0.2;
  const cellPct = 100 / frTotal;
  const center = (i: number): number => (i * 1.2 + 0.5) * cellPct;
  const cellW = cellPct * 0.86;

  return (
    <div data-board={boardTheme} style={{ position: 'relative', width: '100%', aspectRatio: '1' }}>
      {preview !== null && (
        <div
          role="status"
          style={{
            position: 'absolute', top: -8, left: '50%', transform: 'translate(-50%, -100%)', zIndex: 5,
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999,
            padding: '4px 12px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-card)', pointerEvents: 'none',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {preview.legal
            ? <>{wallName(preview.wall.r, preview.wall.c, preview.wall.orientation, size)} · opp {preview.oppDelta >= 0 ? `+${preview.oppDelta}` : preview.oppDelta} · you {preview.ownDelta >= 0 ? `+${preview.ownDelta}` : preview.ownDelta}</>
            : <>illegal wall</>}
        </div>
      )}
      <div
        role="grid"
        aria-label={`wall-and-pawn board, ${size} by ${size}`}
        style={{
          display: 'grid',
          gridTemplateColumns: tracks,
          gridTemplateRows: tracks,
          width: '100%',
          height: '100%',
          background: 'var(--board-shell)',
          borderRadius: 14,
          padding: '1.2%',
          boxShadow: '0 8px 28px rgba(16,20,24,.12), inset 0 0 0 1px rgba(16,20,24,.06)',
          touchAction: 'manipulation',
        }}
      >
        {nodes}
      </div>
      <div aria-hidden style={{ position: 'absolute', inset: '1.2%', pointerEvents: 'none' }}>
        {([0, 1] as const).map((p) => {
          const pos = state.pawns[p];
          return (
            <PawnToken
              key={p} seat={p} r={pos.r} c={pos.c} center={center} cellW={cellW}
              active={state.turn === p && !state.isOver}
              crowned={state.isOver && state.winner === p}
              moveNumber={state.moveNumber} skin={skin}
            />
          );
        })}
      </div>
    </div>
  );
}

export default memo(GameBoardInner);
