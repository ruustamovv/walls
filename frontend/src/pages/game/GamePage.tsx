/**
 * Online game screen: server-authoritative 1v1 (+ spectators).
 * HUD names come from /meta; clocks tick from server snapshots.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import GameBoard from '../../components/game/GameBoard.js';
import PlayerCard from '../../components/game/PlayerCard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import { Badge, Button, Card, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { useOnlineGame } from '../../hooks/useOnlineGame.js';
import { timeControlName } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';

export default function GamePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const [confirmResign, setConfirmResign] = useState(false);
  const game = useOnlineGame(id, user?.id ?? null);
  const { snapshot: snap } = game;

  if (snap === null) {
    return (
      <div>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <div style={{ marginTop: 16 }}>
          {game.error !== null ? <ErrorBox message={game.error} onRetry={game.refresh} /> : <Spinner />}
        </div>
      </div>
    );
  }

  const mySeat = game.mySeat;
  const spectating = mySeat === null;
  const state = {
    size: snap.state.size,
    wallsPerPlayer: snap.state.wallsPerPlayer,
    turn: snap.state.turn as 0 | 1,
    pawns: snap.state.pawns,
    walls: snap.state.walls,
    wallsRemaining: snap.state.wallsRemaining,
    winner: snap.state.winner,
    isOver: snap.isOver,
    moveNumber: snap.state.moveNumber,
    lastAction: snap.state.lastAction,
    rulesVersion: snap.state.rulesVersion,
  };
  const done = snap.isOver || snap.status === 'finished';
  const nameOf = (seat: 0 | 1): string =>
    game.meta?.[seat]?.username ?? (snap.seats[seat] !== null ? `Player ${seat + 1}` : 'Waiting…');
  const ratingOf = (seat: 0 | 1): number | null => game.meta?.[seat]?.rating ?? null;
  const statusBadge = snap.status === 'finished'
    ? <Badge tone="neutral">finished</Badge>
    : snap.status === 'waiting'
      ? <Badge tone="warn">waiting for opponent</Badge>
      : <Badge tone="good">live</Badge>;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>{timeControlName(snap.timeControlId)} · {snap.mode}</h1>
        {statusBadge}
        {!game.connected && <Badge tone="bad">reconnecting…</Badge>}
        {spectating && <Badge tone="info">spectating</Badge>}
      </div>
      {game.error !== null && (
        <p role="alert" style={{ color: '#b91c1c' }}>{game.error}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 640 }}>
          <div style={{ marginBottom: 10 }}>
            <PlayerCard
              name={nameOf(1)}
              rating={ratingOf(1)}
              clockMs={snap.clockMs[1]}
              clockActive={!done && snap.turn === 1}
              lowTime={snap.clockMs[1] < 30000}
              wallsLeft={snap.state.wallsRemaining[1]}
              wallsTotal={state.wallsPerPlayer}
              isTurn={!done && snap.turn === 1}
              isYou={mySeat === 1}
              connected={game.connected}
              accent={1}
            />
          </div>
          <GameBoard
            state={state}
            humanSeats={mySeat === null ? [] : [mySeat]}
            interactive={!spectating && game.connected}
            onMove={game.sendMove}
            onWall={game.sendWall}
            lastAction={snap.state.lastAction}
            showPaths={null}
          />
          <div style={{ marginTop: 10 }}>
            <PlayerCard
              name={nameOf(0)}
              rating={ratingOf(0)}
              clockMs={snap.clockMs[0]}
              clockActive={!done && snap.turn === 0}
              lowTime={snap.clockMs[0] < 30000}
              wallsLeft={snap.state.wallsRemaining[0]}
              wallsTotal={state.wallsPerPlayer}
              isTurn={!done && snap.turn === 0}
              isYou={mySeat === 0}
              connected={game.connected}
              accent={0}
            />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 style={{ margin: '0 0 8px' }}>Moves</h3>
            <MoveList actions={game.actions} />
          </Card>
          <Card>
            {!spectating && !done && (
              confirmResign
                ? <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="danger" onClick={() => game.sendResign()}>Confirm resign</Button>
                  <Button variant="ghost" onClick={() => setConfirmResign(false)}>Keep playing</Button>
                </div>
                : <Button variant="ghost" onClick={() => setConfirmResign(true)}>Resign</Button>
            )}
            {spectating && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>You are spectating. Join from the lobby to play.</p>}
          </Card>
        </div>
      </div>
      {done && (
        <ResultModal
          winnerSeat={snap.winnerSeat}
          reason={snap.finishReason}
          perspective={mySeat}
          moveCount={snap.moveCount}
          durationSec={null}
          onNewGame={() => navigate('/play')}
          onHome={() => navigate('/')}
        />
      )}
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
