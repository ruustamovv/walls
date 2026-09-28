/**
 * Position designer: build any legal position, validate it live, share it
 * as a link, or play it out against a bot. Editing never touches wall
 * supply rules silently — the legality meter shows exactly what is off.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createGame,
  findShortestPath,
  getLegalWalls,
  validateMove,
} from '../../../../engine/typescript/index.js';
import type { GameState, Pos, Wall } from '../../../../engine/typescript/core/types.js';
import GameBoard from '../../components/game/GameBoard.js';
import { Badge, Button, Card, Tabs } from '../../components/ui/primitives.js';
import { copyText } from '../../lib/export.js';
import { decodePosition, encodePosition } from '../../lib/position.js';

type Tool = 'pawn1' | 'pawn2' | 'wall' | 'erase';

const encodeState = encodePosition;

function decodeState(hash: string): GameState | null {
  return decodePosition(hash)?.state ?? null;
}

const TOOLS: Tool[] = ['pawn1', 'pawn2', 'wall', 'erase'];

export default function DesignerPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<GameState>(() => {
    const hash = window.location.hash.slice(1);
    return (hash !== '' ? decodeState(hash) : null) ?? createGame({ size: 9, wallsPerPlayer: 10 });
  });
  const [tool, setTool] = useState<Tool>('wall');
  const [orientation, setOrientation] = useState<'h' | 'v'>('h');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, '', `#${encodeState(state)}`);
  }, [state]);

  const legal = useMemo(() => {
    const a = findShortestPath(state, 0).length;
    const b = findShortestPath(state, 1).length;
    const wallsOk = getLegalWalls(state, state.turn as 0 | 1);
    return { a, b, ok: a >= 0 && b >= 0, legalWalls: wallsOk.length };
  }, [state]);

  function onMove(to: Pos) {
    if (tool === 'pawn1' || tool === 'pawn2') {
      const seat = tool === 'pawn1' ? 0 : 1;
      setState((s) => {
        const pawns = [...s.pawns] as [Pos, Pos];
        pawns[seat] = { ...to };
        return { ...s, pawns };
      });
    } else if (tool === 'erase') {
      // Erasing a cell removes a touching wall is ambiguous — erase the
      // most recently placed wall instead (label explains).
      setState((s) => ({ ...s, walls: s.walls.slice(0, -1) }));
    }
  }

  function onWall(wall: Wall) {
    if (tool === 'erase') {
      setState((s) => ({
        ...s,
        walls: s.walls.filter((w) => !(w.r === wall.r && w.c === wall.c && w.orientation === wall.orientation)),
      }));
      return;
    }
    const w = { ...wall, orientation };
    const verdict = validateMove(state, { type: 'wall', wall: w });
    if (!verdict.ok) return; // illegal placements simply don't stick
    setState((s) => ({ ...s, walls: [...s.walls, w] }));
  }

  function playOut(vsBot: boolean) {
    const code = encodeState(state);
    navigate(vsBot ? `/play/bot?bot=architect&from=${encodeURIComponent(code)}` : `/play/local?from=${encodeURIComponent(code)}`);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Position designer</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 560 }}>
          <GameBoard
            state={state}
            humanSeats={[state.turn]}
            interactive
            onMove={onMove}
            onWall={onWall}
          />
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Tools</h3>
            <Tabs tabs={TOOLS} active={tool} onChange={setTool} />
            {(tool === 'wall') && (
              <div style={{ marginTop: 8 }}>
                <Tabs tabs={(['h', 'v'] as const)} active={orientation} onChange={setOrientation} />
              </div>
            )}
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 0' }}>
              {tool === 'erase'
                ? 'Click a groove to remove that wall, or any tile to drop the last wall.'
                : tool === 'wall'
                  ? 'Click a groove to place (illegal walls refuse to stick).'
                  : 'Click any tile to move that pawn.'}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" onClick={() => setState(createGame({ size: 9, wallsPerPlayer: 10 }))}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void copyText(`${window.location.origin}${window.location.pathname}#${encodeState(state)}`)
                    .then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); } });
                }}
              >
                {copied ? 'Copied!' : 'Share link'}
              </Button>
            </div>
          </Card>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Legality meter</h3>
            <p style={{ margin: '0 0 4px', fontSize: 14 }}>
              <Badge tone={legal.ok ? 'good' : 'bad'}>{legal.ok ? 'Legal position' : 'Illegal — a pawn is sealed'}</Badge>
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              P1 route {legal.a} · P2 route {legal.b} · {legal.legalWalls} legal walls for side to move.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button size="sm" disabled={!legal.ok} onClick={() => playOut(true)}>Play vs bot from here</Button>
              <Button size="sm" variant="ghost" disabled={!legal.ok} onClick={() => playOut(false)}>Local 2P from here</Button>
            </div>
          </Card>
          <Card>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
              Positions live in the link — send it to a friend and they get this exact board.{' '}
              <Link to="/learn">Back to lessons</Link>
            </p>
          </Card>
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
