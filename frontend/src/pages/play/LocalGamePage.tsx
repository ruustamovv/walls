/**
 * Offline game screen: local 2P or vs engine bot.
 * Query: ?mode=local|bot&bot=<id>&size=9&walls=10&clock=<sec>&inc=<sec>
 */
import { useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { findShortestPath, getBot } from '../../../../engine/typescript/index.js';
import GameBoard from '../../components/game/GameBoard.js';
import PlayerCard from '../../components/game/PlayerCard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import { Button, Card } from '../../components/ui/primitives.js';
import { useLocalGame } from '../../hooks/useLocalGame.js';

export default function LocalGamePage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const mode = location.pathname.endsWith('/bot') ? 'bot' : 'local';
  const bot = getBot(params.get('bot') ?? 'rookie') ?? getBot('rookie');
  const size = Math.min(19, Math.max(5, Number(params.get('size') ?? 9) || 9));
  const walls = Math.min(30, Math.max(0, Number(params.get('walls') ?? 10) || 0));
  const clockSec = Math.max(0, Number(params.get('clock') ?? 0) || 0);
  const incSec = Math.max(0, Number(params.get('inc') ?? 0) || 0);

  const game = useLocalGame({
    size, wallsPerPlayer: walls, mode,
    botId: bot?.id ?? 'rookie',
    clockMs: clockSec * 1000, incrementMs: incSec * 1000,
  });
  const { state, actions } = game;
  const done = game.winnerSeat !== null;

  // Casual analysis aid: show both shortest paths (offline modes only).
  const paths = useMemo(() => {
    if (done) return null;
    const a = findShortestPath(state, 0);
    const b = findShortestPath(state, 1);
    return { a: a.path, b: b.path };
  }, [state, done]);

  const topName = mode === 'bot' ? (bot?.name ?? 'Bot') : 'Player 2';
  const bottomName = mode === 'bot' ? 'You' : 'Player 1';
  // Perspective: player 0 (bottom) starts at top of screen? Player 0 starts
  // on the TOP row and moves down. Render top card = player 1 (bottom
  // starter) so each side sits near its own goal row.
  const durationSec = done ? Math.round((Date.now() - game.startedAt) / 1000) : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>
          {mode === 'bot' ? `You vs ${bot?.name}` : 'Local game'}
        </h1>
        {game.botThinking && <span style={{ color: 'var(--muted)', fontSize: 14, animation: 'nexus-pulse 1s infinite' }}>thinking…</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 10 }}>
            <PlayerCard
              name={topName}
              rating={mode === 'bot' ? bot?.rating : null}
              clockMs={game.clocks[1]}
              clockActive={game.clockOn && !done && state.turn === 1}
              lowTime={game.clockOn && game.clocks[1] < 30000}
              wallsLeft={state.wallsRemaining[1]}
              wallsTotal={state.wallsPerPlayer}
              isTurn={!done && state.turn === 1}
              isYou={mode === 'local'}
              accent={1}
            />
          </div>
          <GameBoard
            state={state}
            humanSeats={mode === 'local' ? [0, 1] : [0]}
            interactive={!done && !game.botThinking}
            onMove={game.doMove}
            onWall={game.doWall}
            lastAction={state.lastAction}
            showPaths={paths}
          />
          <div style={{ marginTop: 10 }}>
            <PlayerCard
              name={bottomName}
              rating={null}
              clockMs={game.clocks[0]}
              clockActive={game.clockOn && !done && state.turn === 0}
              lowTime={game.clockOn && game.clocks[0] < 30000}
              wallsLeft={state.wallsRemaining[0]}
              wallsTotal={state.wallsPerPlayer}
              isTurn={!done && state.turn === 0}
              isYou
              accent={0}
            />
          </div>
          {game.message !== '' && <p role="status" style={{ color: '#b91c1c' }}>{game.message}</p>}
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 style={{ margin: '0 0 8px' }}>Moves</h3>
            <MoveList actions={actions} />
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={game.restart}>Restart</Button>
              <Button variant="subtle" onClick={() => navigate('/play')}>New game</Button>
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
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
