/**
 * Party table: 2–4 seats, humans + bots.
 * Query: ?players=4&humans=1&size=9&walls=5
 */
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MultiBoard, { SEAT_COLORS } from '../../components/game/MultiBoard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import { Avatar, Button, Card } from '../../components/ui/primitives.js';
import { useMultiGame } from '../../hooks/useMultiGame.js';
import { useTheme } from '../../hooks/useTheme.js';
import type { Action } from '../../../../engine/typescript/core/types.js';

function clampInt(v: string | null, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default function MultiGamePage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  useTheme('arena');

  const players = clampInt(params.get('players'), 4, 2, 4);
  const humans = clampInt(params.get('humans'), 1, 1, players);
  const size = clampInt(params.get('size'), players >= 4 ? 9 : 13, 5, 19);
  const walls = clampInt(params.get('walls'), players >= 4 ? 5 : 10, 0, 30);
  void location;

  const game = useMultiGame({ players, humans, size, wallsPerPlayer: walls });
  const { state, actions } = game;
  const done = state.isOver;

  const names = Array.from({ length: players }, (_, i) =>
    i < humans ? `Player ${i + 1}` : `Bot ${i + 1}`,
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <h1 className="font-display" style={{ margin: 0, fontSize: 22 }}>
          Party · {players} players {humans < players ? `(${humans} human)` : '(all human)'}
        </h1>
        {game.botThinking && <span style={{ color: 'var(--muted)', fontSize: 14, animation: 'nexus-pulse 1s infinite' }}>bot thinking…</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 640 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {names.map((n, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex', gap: 8, alignItems: 'center',
                  background: 'var(--surface)', border: `2px solid ${state.turn === i && !done ? SEAT_COLORS[i % SEAT_COLORS.length] : 'var(--line)'}`,
                  borderRadius: 10, padding: '6px 10px', fontSize: 14, fontWeight: state.turn === i ? 800 : 500,
                }}
              >
                <Avatar name={n} size={24} />
                {n}
                <span style={{ color: 'var(--muted)' }}>▮ {state.wallsRemaining[i] ?? 0}</span>
              </span>
            ))}
          </div>
          <MultiBoard
            state={state}
            humanSeats={game.humanSeats}
            interactive={!done && !game.botThinking}
            onMove={game.doMove}
            onWall={game.doWall}
            lastAction={state.lastAction}
          />
          {game.message !== '' && <p role="status" style={{ color: 'var(--bad)' }}>{game.message}</p>}
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Moves</h3>
            <MoveList actions={actions as Action[]} size={size} />
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={game.restart}>Restart</Button>
              <Button variant="subtle" onClick={() => navigate('/play')}>New game</Button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>
              Turn: <strong style={{ color: SEAT_COLORS[state.turn % SEAT_COLORS.length] }}>{names[state.turn]}</strong> ·
              first pawn to its glowing edge wins.
            </p>
          </Card>
        </div>
      </div>
      {done && state.winner !== null && (
        <ResultModal
          winnerSeat={null}
          reason="goal"
          perspective={null}
          moveCount={actions.length}
          durationSec={null}
          title={`${names[state.winner] ?? `Seat ${state.winner + 1}`} reaches the goal!`}
          won={humans === players ? true : state.winner < humans}
          onRematch={game.restart}
          onNewGame={() => navigate('/play')}
          onHome={() => navigate('/')}
        />
      )}
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
