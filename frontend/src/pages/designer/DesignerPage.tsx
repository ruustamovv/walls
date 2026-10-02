/**
 * Position designer: build any legal position, validate it live, share it
 * as a link, or play it out against a bot. Editing never touches wall
 * supply rules silently — the legality meter shows exactly what is off.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  createGame,
  findShortestPath,
  getLegalWalls,
  validateMove,
} from '../../../../engine/typescript/index.js';
import type { GameState, Pos, Wall } from '../../../../engine/typescript/core/types.js';
import GameBoard from '../../components/game/GameBoard.js';
import { Badge, Button, Card, Tabs, TextInput } from '../../components/ui/primitives.js';
import { copyText } from '../../lib/export.js';
import { decodePosition, encodePosition } from '../../lib/position.js';
import { api } from '../../lib/api.js';

type Tool = 'pawn1' | 'pawn2' | 'wall' | 'erase';

const encodeState = encodePosition;

function decodeState(hash: string): GameState | null {
  return decodePosition(hash)?.state ?? null;
}

const TOOLS: Tool[] = ['pawn1', 'pawn2', 'wall', 'erase'];

export default function DesignerPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [state, setState] = useState<GameState>(() => {
    // Architect share links arrive as ?from=<base64 position>; hand-built
    // links use the #<base64 position> hash.
    const fromQuery = search.get('from');
    if (fromQuery !== null && fromQuery !== '') return decodeState(fromQuery) ?? createGame({ size: 9, wallsPerPlayer: 10 });
    const hash = window.location.hash.slice(1);
    return (hash !== '' ? decodeState(hash) : null) ?? createGame({ size: 9, wallsPerPlayer: 10 });
  });
  const [tool, setTool] = useState<Tool>('wall');
  const [orientation, setOrientation] = useState<'h' | 'v'>('h');
  const [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Awaited<ReturnType<typeof api.architectDesign>> | null>(null);

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
    // The groove the user actually clicked decides the orientation. Forcing the
    // H/V toggle here ignored the groove and produced walls the engine then
    // rejected as crossings, so vertical grooves silently refused to stick.
    const w = { ...wall };
    const verdict = validateMove(state, { type: 'wall', wall: w });
    if (!verdict.ok) return; // illegal placements simply don't stick
    setState((s) => ({ ...s, walls: [...s.walls, w] }));
  }

  function playOut(vsBot: boolean) {
    const code = encodeState(state);
    navigate(vsBot ? `/play/bot?bot=architect&from=${encodeURIComponent(code)}` : `/play/local?from=${encodeURIComponent(code)}`);
  }

  // Architect: prompt -> engine-validated board. The server is the sole
  // authority on legality; a rejection reason is shown verbatim.
  async function generate() {
    if (prompt.trim().length < 3) {
      setAiError('Describe the board in a few words (at least 3 characters).');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await api.architectDesign(prompt.trim());
      setAiResult(res);
      if (res.ok && res.code !== null) {
        const decoded = decodeState(res.code);
        if (decoded !== null) setState(decoded);
        else setAiError('The generated board could not be decoded — try a different prompt.');
      }
    } catch (err) {
      setAiResult(null);
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiBusy(false);
    }
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
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Generate with Architect</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 8px' }}>
              Describe a board in plain words. Every proposal is checked by the rules engine before it reaches you.
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); void generate(); }}
              style={{ display: 'grid', gap: 8 }}
            >
              <label htmlFor="architect-prompt" style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>
                Prompt
              </label>
              <TextInput
                id="architect-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={500}
                placeholder="hard board with two choke points"
              />
              <Button type="submit" disabled={aiBusy}>
                {aiBusy ? 'Designing…' : 'Design board'}
              </Button>
            </form>
            {aiError !== null && <p role="alert" style={{ color: 'var(--bad)', fontSize: 13, margin: '8px 0 0' }}>{aiError}</p>}
            {aiResult !== null && (
              <div style={{ marginTop: 10, fontSize: 13 }}>
                {aiResult.ok ? (
                  <>
                    <p style={{ margin: '0 0 4px' }}>
                      <Badge tone="good">engine-approved</Badge>{' '}
                      <span style={{ color: 'var(--muted)' }}>
                        {aiResult.size}×{aiResult.size} · {aiResult.difficulty} · {aiResult.theme} ·{' '}
                        {aiResult.walls.length} walls · routes {aiResult.routeA}/{aiResult.routeB}
                      </span>
                    </p>
                    {aiResult.notes.map((n) => (
                      <p key={n} style={{ margin: '0 0 2px', color: 'var(--muted)' }}>{n}</p>
                    ))}
                    {aiResult.shareUrl !== null && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { void copyText(aiResult.shareUrl as string); }}
                      >
                        Copy share link
                      </Button>
                    )}
                  </>
                ) : (
                  <p role="status" style={{ margin: 0, color: 'var(--bad)' }}>
                    <strong>Rejected{aiResult.stage !== null ? ` (${aiResult.stage} check)` : ''}:</strong>{' '}
                    {aiResult.reason ?? 'the engine could not accept this board'}
                  </p>
                )}
              </div>
            )}
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
