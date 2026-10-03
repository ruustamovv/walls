/**
 * Offline game screen: local 2P or vs engine bot.
 * Query: ?mode=local|bot&bot=<id>&size=9&walls=10&clock=<sec>&inc=<sec>
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { findShortestPath, getBot, quip, validateMove, winChanceFor } from '../../../../engine/typescript/index.js';
import type { Action, GameState } from '../../../../engine/typescript/core/types.js';
import PathMeter from '../../components/game/PathMeter.js';
import GameBoard from '../../components/game/GameBoard.js';
import PlayerCard from '../../components/game/PlayerCard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import { EvalBar } from '../../components/ui/primitives.js';
import { LocalReviewPanel } from '../../components/game/ReviewPanel.js';
import { Button, Card } from '../../components/ui/primitives.js';
import { useLocalGame } from '../../hooks/useLocalGame.js';
import { useTheme } from '../../hooks/useTheme.js';
import { decodePosition } from '../../lib/position.js';

export default function LocalGamePage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.pathname.endsWith('/bot') ? 'bot' : 'local';
  const bot = getBot(params.get('bot') ?? 'rookie') ?? getBot('rookie');
  const size = Math.min(19, Math.max(5, Number(params.get('size') ?? 9) || 9));
  const walls = Math.min(30, Math.max(0, Number(params.get('walls') ?? 10) || 0));
  useTheme('arena');
  const clockSec = Math.max(0, Number(params.get('clock') ?? 0) || 0);
  const incSec = Math.max(0, Number(params.get('inc') ?? 0) || 0);

  const fromCode = params.get('from');
  const from = fromCode !== null && fromCode !== '' ? decodePosition(fromCode) : null;
  const isNemesis = (params.get('bot') ?? '') === 'nemesis';
  const isMirror = (params.get('bot') ?? '') === 'mirror';
  const isGhost = (params.get('bot') ?? '') === 'ghost';
  const [nemesisDef, setNemesisDef] = useState<import('../../../../engine/typescript/index.js').BotDef | null>(null);
  useEffect(() => {
    if (!isNemesis) return;
    try {
      const raw = sessionStorage.getItem('nexus-nemesis');
      if (raw !== null) {
        setNemesisDef(JSON.parse(raw) as import('../../../../engine/typescript/index.js').BotDef);
        return;
      }
    } catch {
      // fall through to live fetch
    }
    void import('../../lib/api.js').then(({ api }) => {
      api.nemesis().then((p) => {
        setNemesisDef({
          id: 'nemesis', name: 'Your Nemesis', rating: 1700, difficulty: 5,
          style: `Counter to your game (cf. ${p.baseName})`, description: p.explanation,
          weights: { ...p.weights }, wallCandidates: p.wallCandidates, noise: p.noise,
          wallBias: p.wallBias, replySearch: p.replySearch, budgetMs: p.budgetMs,
          depth: 2, maxNodes: 500,
        });
      }).catch(() => undefined);
    });
  }, [isNemesis]);
  // Mirror reuses the nemesis custom-personality pipeline.
  const [mirrorDef, setMirrorDef] = useState<import('../../../../engine/typescript/index.js').BotDef | null>(null);
  useEffect(() => {
    if (!isMirror) return;
    try {
      const raw = sessionStorage.getItem('quoridor-mirror');
      if (raw !== null) {
        setMirrorDef(JSON.parse(raw) as import('../../../../engine/typescript/index.js').BotDef);
        return;
      }
    } catch {
      // fall through to live fetch
    }
    void import('../../lib/api.js').then(({ api }) => {
      api.mirror().then((p) => {
        setMirrorDef({
          id: 'mirror', name: 'Your Mirror', rating: 1500, difficulty: 4,
          style: 'Plays like you', description: p.explanation,
          weights: { ...p.weights }, wallCandidates: p.wallCandidates, noise: p.noise,
          wallBias: p.wallBias, replySearch: p.replySearch, budgetMs: p.budgetMs,
          depth: 2, maxNodes: 400,
        });
      }).catch(() => undefined);
    });
  }, [isMirror]);
  // Ghost: replay the opponent's exact moves from one of your games.
  // Diverged positions fall back to rookie search (see scripted driver).
  const [ghostScript, setGhostScript] = useState<{ actions: Action[]; size: number; wallsPerPlayer: number } | null>(null);
  useEffect(() => {
    if (!isGhost) return;
    try {
      const raw = sessionStorage.getItem('quoridor-ghost');
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { actions: Action[]; size: number; wallsPerPlayer: number };
        if (Array.isArray(parsed.actions)) setGhostScript(parsed);
      }
    } catch {
      // no script — rookie fallback covers every turn
    }
  }, [isGhost]);
  const ghostMove = useCallback((state: GameState, moveNumber: number): Action | null => {
    if (ghostScript === null) return null;
    const next = ghostScript.actions[moveNumber];
    if (next === undefined) return null;
    try {
      return validateMove(state, next).ok ? next : null;
    } catch {
      return null;
    }
  }, [ghostScript]);
  const resolvedBot = isNemesis ? nemesisDef : isMirror ? mirrorDef : isGhost ? null : bot;
  const ghostName = isGhost ? 'Your Ghost' : null;
  const game = useLocalGame({    size: from?.state.size ?? (isNemesis || isMirror ? 15 : isGhost && ghostScript !== null ? ghostScript.size : size),
    wallsPerPlayer: from?.state.wallsPerPlayer ?? (isNemesis || isMirror ? 20 : isGhost && ghostScript !== null ? ghostScript.wallsPerPlayer : walls),
    mode,
    botId: isNemesis ? 'nemesis' : isMirror ? 'mirror' : isGhost ? 'ghost' : (bot?.id ?? 'rookie'),
    ...((isNemesis && nemesisDef !== null ? { customBot: nemesisDef } : {})),
    ...((isMirror && mirrorDef !== null ? { customBot: mirrorDef } : {})),
    ...(isGhost ? { scripted: ghostMove } : {}),
    clockMs: clockSec * 1000, incrementMs: incSec * 1000,
    ...(from !== null ? { from } : {}),
  });
  const { state, actions } = game;
  const done = game.winnerSeat !== null;
  const [banter, setBanter] = useState<string | null>(mode === 'bot' && bot !== null && bot !== undefined ? quip(bot, 'greet', 0) : null);
  const [banterOn, setBanterOn] = useState(true);

  // Bot table talk: greetings, mid-game remarks, and a sign-off.
  useEffect(() => {
    if (mode !== 'bot' || bot === null || bot === undefined || !banterOn) return;
    if (done && game.winnerSeat !== null) {
      setBanter(quip(bot, game.winnerSeat === 1 ? 'win' : 'lose', actions.length));
      return;
    }
    if (done) return;
    const botWalls = actions.filter((a, i) => a.type === 'wall' && i % 2 === 1).length;
    if (botWalls === 3 && actions.length < 12) {
      setBanter(quip(bot, 'wall', actions.length));
      return;
    }
    const myPath = findShortestPath(state, 0).length;
    const botPath = findShortestPath(state, 1).length;
    if (actions.length >= 20) {
      setBanter(quip(bot, botPath < myPath ? 'winning' : 'losing', actions.length));
    }
  }, [mode, bot, done, game.winnerSeat, actions, state, banterOn]);
  const humanSeats = useMemo(() => (mode === 'local' ? [0, 1] : [0]) as (0 | 1)[], [mode]);

  // Casual analysis aid: show both shortest paths (offline modes only).
  const paths = useMemo(() => {
    if (done) return null;
    const a = findShortestPath(state, 0);
    const b = findShortestPath(state, 1);
    return { a: a.path, b: b.path };
  }, [state, done]);

  const topName = mode === 'bot' ? (ghostName ?? resolvedBot?.name ?? 'Bot') : 'Player 2';
  const bottomName = mode === 'bot' ? 'You' : 'Player 1';
  const [flipped, setFlipped] = useState(false);
  // Seat 0 (You / Player 1) always renders at the bottom: the board is
  // rotated 180° by default so their pawn starts at the bottom edge.
  const rotated = !flipped;
  const topSeat = (flipped ? 0 : 1) as 0 | 1;
  const bottomSeat = (flipped ? 1 : 0) as 0 | 1;
  const nameOfSeat = (s: 0 | 1): string => s === 0 ? bottomName : topName;
  const durationSec = done ? Math.round((Date.now() - game.startedAt) / 1000) : null;
  const [showReview, setShowReview] = useState(false);
  useEffect(() => { setShowReview(false); }, [mode, size, walls]);
  const p0Path = useMemo(() => findShortestPath(state, 0).length, [state]);
  const p1Path = useMemo(() => findShortestPath(state, 1).length, [state]);
  const started = actions.length > 0;
  const bottomWin = winChanceFor(bottomSeat, bottomSeat === 0 ? p0Path : p1Path, bottomSeat === 0 ? p1Path : p0Path, state.wallsRemaining[bottomSeat] ?? 0, state.wallsRemaining[topSeat] ?? 0, actions.length);
  const topWin = Math.round((100 - bottomWin) * 10) / 10;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Play</Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>
          {mode === 'bot' ? `You vs ${ghostName ?? resolvedBot?.name ?? 'Bot'}` : 'Local game'}
        </h1>
        {game.botThinking && <span style={{ color: 'var(--muted)', fontSize: 14, animation: 'nexus-pulse 1s infinite' }}>thinking…</span>}
        {mode === 'bot' && banterOn && banter !== null && (
          <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--muted)' }}>
            “{banter}”
            <button
              onClick={() => setBanterOn(false)}
              title="Mute bot banter"
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}
            >
              mute
            </button>
          </span>
        )}
      </div>
      <div className="local-game-grid" style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) 300px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 58 }}>
          {started ? (
            <>
              <EvalBar whitePct={bottomWin} label={`You ${bottomWin}% · Opp ${topWin}%`} />
              <span className="font-mono" style={{ fontSize: 11, fontWeight: 800 }}>{bottomWin.toFixed(0)}%</span>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Chance appears on move 1</span>
          )}
        </div>
        <div style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 10 }}>
            <PlayerCard
              name={nameOfSeat(topSeat)}
              rating={mode === 'bot' && topSeat === 1 ? (resolvedBot?.rating ?? null) : null}
              winPct={started ? topWin : null}
              clockMs={game.clocks[topSeat]}
              clockActive={game.clockOn && !done && state.turn === topSeat}
              lowTime={game.clockOn && game.clocks[topSeat] < 30000}
              wallsLeft={state.wallsRemaining[topSeat]}
              wallsTotal={state.wallsPerPlayer}
              isTurn={!done && state.turn === topSeat}
              isYou={mode === 'local' || (mode === 'bot' && topSeat === 0)}
              accent={topSeat}
            />
          </div>
          <div style={rotated ? { transform: 'rotate(180deg)' } : undefined}>
            <GameBoard
              state={state}
              humanSeats={humanSeats}
              interactive={!done && !game.botThinking}
              onMove={game.doMove}
              onWall={game.doWall}
              lastAction={state.lastAction}
              showPaths={paths}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <PlayerCard
              name={nameOfSeat(bottomSeat)}
              rating={mode === 'bot' && bottomSeat === 1 ? (resolvedBot?.rating ?? null) : null}
              winPct={started ? bottomWin : null}
              clockMs={game.clocks[bottomSeat]}
              clockActive={game.clockOn && !done && state.turn === bottomSeat}
              lowTime={game.clockOn && game.clocks[bottomSeat] < 30000}
              wallsLeft={state.wallsRemaining[bottomSeat]}
              wallsTotal={state.wallsPerPlayer}
              isTurn={!done && state.turn === bottomSeat}
              isYou={mode === 'local' || (mode === 'bot' && bottomSeat === 0)}
              accent={bottomSeat}
            />
          </div>
          {game.message !== '' && <p role="status" style={{ color: 'var(--bad)' }}>{game.message}</p>}
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 style={{ margin: '0 0 8px' }}>Moves</h3>
            <MoveList actions={actions} size={size} />
          </Card>
          <Card>
            <PathMeter
              own={paths === null ? -1 : paths.a.length - 1}
              opp={paths === null ? -1 : paths.b.length - 1}
            />
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={game.restart}>Restart</Button>
              <Button variant="ghost" onClick={() => setFlipped((f) => !f)}>Flip</Button>
              <Button
                variant="ghost"
                disabled={actions.length === 0 || game.botThinking || done}
                onClick={() => game.undo(mode === 'bot' ? 2 : 1)}
                title={mode === 'bot' ? 'Take back your move and the bot reply' : 'Take back one ply'}
              >
                Undo
              </Button>
              <Button variant="subtle" onClick={() => navigate('/play')}>New game</Button>
              {done && (mode === 'bot' || mode === 'local') && actions.length >= 4 && (
                <Button variant="ghost" onClick={() => setShowReview((v) => !v)}>{showReview ? 'Hide review' : 'Review game'}</Button>
              )}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>
              Turn: <strong>Player {state.turn + 1}</strong> · Click a dotted tile to move, or hover a groove between tiles to place a wall.
            </p>
          </Card>
        </div>
      </div>
      {done && game.winnerSeat !== null && (
        <ResultModal
          winnerSeat={game.winnerSeat}
          reason={game.reason}
          perspective={mode === 'bot' ? 0 : null}
          moveCount={actions.length}
          durationSec={durationSec}
          onRematch={game.restart}
          onNewGame={() => navigate('/play')}
          onHome={() => navigate('/')}
        />
      )}
      {done && showReview && actions.length >= 4 && (
        <div style={{ marginTop: 16, maxWidth: 720 }}>
          <LocalReviewPanel size={size} wallsPerPlayer={walls} actions={actions} />
        </div>
      )}
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } } @media (max-width: 1020px){.local-game-grid{grid-template-columns:30px minmax(0,1fr)!important}.local-game-grid aside{grid-column:1/-1}}`}</style>
    </div>
  );
}
