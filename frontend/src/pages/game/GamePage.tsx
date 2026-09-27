/**
 * Online game screen: server-authoritative 1v1 (+ spectators).
 * HUD names come from /meta; clocks tick from server snapshots.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TextInput } from '../../components/ui/primitives.js';
import { playSound } from '../../lib/sound.js';
import { api } from '../../lib/api.js';
import { copyText, exportGame } from '../../lib/export.js';
import PathMeter from '../../components/game/PathMeter.js';
import { findShortestPath } from '../../../../engine/typescript/index.js';
import { useEffect, useRef } from 'react';
import GameBoard from '../../components/game/GameBoard.js';
import PlayerCard from '../../components/game/PlayerCard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import ReviewPanel from '../../components/game/ReviewPanel.js';
import { Badge, Button, Card, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { useOnlineGame } from '../../hooks/useOnlineGame.js';
import { ratingModeFor, timeControlName } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';
import { useSettings } from '../../stores/settings.js';
import { useTheme } from '../../hooks/useTheme.js';

export default function GamePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const [confirmResign, setConfirmResign] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [chatMuted, setChatMuted] = useState(false);
  const soundOn = useSettings((s) => s.sound);
  const setSound = useSettings((s) => s.setSound);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  useTheme('arena');
  const game = useOnlineGame(id, user?.id ?? null);

  async function rematch() {
    if (game.snapshot === null || game.mySeat === null) return;
    const s = game.snapshot;
    const opp = s.seats[game.mySeat === 0 ? 1 : 0];
    try {
      const g = await api.createGame({
        boardSize: s.state.size,
        wallsPerPlayer: s.state.wallsPerPlayer,
        timeControl: s.timeControlId,
        ...(opp !== null ? { opponentId: opp } : {}),
      });
      navigate(`/game/${g.id}`);
    } catch (err) {
      game.refresh();
      void err;
    }
  }
  const soundedMoves = useRef(0);
  useEffect(() => {
    const n = game.snapshot?.moveCount ?? 0;
    if (n > soundedMoves.current) {
      soundedMoves.current = n;
      const last = game.snapshot?.state.lastAction;
      playSound(last?.type === 'wall' ? 'wall' : 'move');
    }
  }, [game.snapshot]);
  const soundedEnd = useRef(false);
  useEffect(() => {
    if (game.snapshot === null || !game.snapshot.isOver || soundedEnd.current) return;
    soundedEnd.current = true;
    const w = game.snapshot.winnerSeat;
    playSound(game.mySeat === null || w === null ? 'notify' : w === game.mySeat ? 'win' : 'lose');
  }, [game.snapshot, game.mySeat]);
  const lastTickSec = useRef<[number, number]>([-1, -1]);
  useEffect(() => {
    if (game.snapshot === null || game.snapshot.isOver) return;
    const secs = [Math.ceil(game.snapshot.clockMs[0] / 1000), Math.ceil(game.snapshot.clockMs[1] / 1000)] as [number, number];
    ([0, 1] as const).forEach((s) => {
      if (secs[s] <= 10 && secs[s] > 0 && secs[s] !== lastTickSec.current[s]) {
        lastTickSec.current[s] = secs[s];
        playSound('tick');
      }
    });
  }, [game.snapshot]);
  const soundedChat = useRef(0);
  useEffect(() => {
    if (game.chat.length > soundedChat.current) {
      const last = game.chat[game.chat.length - 1];
      soundedChat.current = game.chat.length;
      if (last !== undefined && last.from !== user?.id) playSound('notify');
    }
  }, [game.chat, user?.id]);
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
  const myPath = findShortestPath(state, (mySeat ?? 0) as 0 | 1).length;
  const oppPath = findShortestPath(state, (((mySeat ?? 0) + 1) % 2) as 0 | 1).length;
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
        {snap.mode === 'ranked' ? <Badge tone="info">rated</Badge> : <Badge tone="neutral">casual</Badge>}
        <button onClick={() => void copyText(`${window.location.origin}/game/${snap.id}`).then((ok) => { if (ok) game.refresh(); })} title="Copy share link" style={shareBtn}>Share</button>
        <button onClick={() => exportGame(snap.id, snap)} title="Download game JSON" style={shareBtn}>Export</button>
        {done && <Link to={`/replay/${encodeURIComponent(snap.id)}`} style={{ fontSize: 14 }}>Open replay</Link>}
      </div>
      <div style={{ maxWidth: 640, marginBottom: 10 }}>
        <PathMeter own={mySeat === null || mySeat === 0 ? myPath : oppPath} opp={mySeat === null || mySeat === 0 ? oppPath : myPath} flip={mySeat === 1} />
      </div>
      {game.error !== null && (
        <p role="alert" style={{ color: 'var(--bad)' }}>{game.error}</p>
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
          <div style={flipped ? { transform: 'rotate(180deg)' } : undefined}>
            <GameBoard
              state={state}
              humanSeats={mySeat === null ? [] : [mySeat]}
              interactive={!spectating && game.connected}
              onMove={game.sendMove}
              onWall={game.sendWall}
              lastAction={snap.state.lastAction}
              showPaths={null}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={() => setFlipped((f) => !f)} style={shareBtn} title="Flip board">Flip</button>
            <button onClick={() => setSound(!soundOn)} style={shareBtn} title="Toggle sound">
              {soundOn ? 'Sound on' : 'Muted'}
            </button>
            <button onClick={() => setChatMuted((m) => !m)} style={shareBtn} title="Toggle chat">
              {chatMuted ? 'Show chat' : 'Hide chat'}
            </button>
          </div>
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
            <MoveList actions={game.actions} size={snap.state.size} onExport={() => exportGame(snap.id, snap)} />
          </Card>
          {!chatMuted && (
          <ChatBox
            messages={game.chat}
            canSend={!spectating && !done}
            onSend={game.sendChat}
            names={new Map([
              ...(snap.seats[0] !== null ? [[snap.seats[0], nameOf(0)] as [string, string]] : []),
              ...(snap.seats[1] !== null ? [[snap.seats[1], nameOf(1)] as [string, string]] : []),
            ])}
            myUserId={user?.id ?? null}
          />
          )}
          {done && <div ref={reviewRef}><ReviewPanel gameId={id} /></div>}
          <Card>
            {!spectating && !done && snap.drawOfferBy !== null && snap.drawOfferBy !== mySeat && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <Badge tone="warn">Draw offered — accept?</Badge>
                <Button size="sm" onClick={() => game.sendDrawResponse(true)}>Accept</Button>
                <Button size="sm" variant="ghost" onClick={() => game.sendDrawResponse(false)}>Decline</Button>
              </div>
            )}
            {!spectating && !done && (
              confirmResign
                ? <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="danger" onClick={() => game.sendResign()}>Confirm resign</Button>
                  <Button variant="ghost" onClick={() => setConfirmResign(false)}>Keep playing</Button>
                </div>
                : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button variant="ghost" onClick={() => game.sendDrawOffer()} disabled={snap.drawOfferBy === mySeat}>
                    {snap.drawOfferBy === mySeat ? 'Offer sent…' : 'Offer draw'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmResign(true)}>Resign</Button>
                </div>
            )}
            {spectating && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>You are spectating. Join from the lobby to play.</p>}
          </Card>
          <Card>
            <ReportBox kind="game" targetId={id} />
          </Card>
        </div>
      </div>
      {done && (
        <GameResult
          snap={snap}
          mySeat={mySeat}
          myUsername={mySeat === null ? null : nameOf(mySeat)}
          onRematch={rematch}
          onReview={() => reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      )}
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

function GameResult({ snap, mySeat, myUsername, onRematch, onReview }: {
  snap: {
    id: string; winnerSeat: 0 | 1 | null; finishReason: 'goal' | 'timeout' | 'resign' | 'draw' | null;
    moveCount: number; timeControlId: string; createdAt: number; updatedAt: number;
  };
  mySeat: 0 | 1 | null;
  myUsername: string | null;
  onRematch: () => void;
  onReview: () => void;
}) {
  const [delta, setDelta] = useState<{ rating: number; delta: number } | null>(null);
  useEffect(() => {
    if (myUsername === null) return;
    api.ratingHistory(myUsername, ratingModeFor(snap.timeControlId))
      .then((r) => {
        const last = r.points[r.points.length - 1];
        if (last !== undefined) setDelta({ rating: last.after, delta: last.after - last.before });
      })
      .catch(() => undefined);
  }, [snap.id, snap.timeControlId, myUsername]);

  const durationSec = Math.max(0, Math.round((snap.updatedAt - snap.createdAt) / 1000));
  return (
    <ResultModal
      winnerSeat={snap.winnerSeat}
      reason={snap.finishReason}
      perspective={mySeat}
      moveCount={snap.moveCount}
      durationSec={durationSec}
      onRematch={mySeat === null ? undefined : onRematch}
      onReview={onReview}
      onNewGame={() => window.location.assign('/play')}
      onHome={() => window.location.assign('/')}
      ratingLine={delta === null
        ? null
        : `${ratingModeFor(snap.timeControlId)} ${delta.rating} (${delta.delta >= 0 ? '+' : ''}${delta.delta})`}
    />
  );
}

export function ReportBox({ kind, targetId }: { kind: 'game' | 'user' | 'club'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useSession();
  if (user === null) return null;
  if (!open) {
    return <Button size="sm" variant="subtle" onClick={() => setOpen(true)}>Report</Button>;
  }
  if (done) {
    return <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Thanks — moderators will review it.</p>;
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        api.report(kind, targetId, reason).then(
          () => setDone(true),
          (err: unknown) => setError(err instanceof Error ? err.message : 'Report failed'),
        );
      }}
      style={{ display: 'grid', gap: 8 }}
    >
      <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened? (min 3 chars)" aria-label="report reason" maxLength={1000} />
      {error !== null && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="sm" type="submit" disabled={reason.trim().length < 3}>Send report</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}

const shareBtn: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8,
  padding: '4px 10px', fontSize: 13, fontWeight: 700, color: 'var(--ink)',
};

function ChatBox({ messages, canSend, onSend, names, myUserId }: {
  messages: { from: string; body: string; at: number }[];
  canSend: boolean;
  onSend: (body: string) => void;
  names: Map<string, string>;
  myUserId: string | null;
}) {
  const [draft, setDraft] = useState('');
  return (
    <Card>
      <h3 style={{ margin: '0 0 8px' }}>Table talk</h3>
      <div aria-live="polite" style={{ display: 'grid', gap: 6, maxHeight: 180, overflowY: 'auto', marginBottom: 8 }}>
        {messages.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No messages yet. Good luck, have fun.</p>}
        {messages.map((m, i) => (
          <p key={i} style={{ margin: 0, fontSize: 14 }}>
            <strong>{m.from === myUserId ? 'you' : (names.get(m.from) ?? 'player')}</strong>{' '}
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(m.at).toLocaleTimeString()}</span>
            <br />{m.body}
          </p>
        ))}
      </div>
      {canSend && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim().length === 0) return;
            onSend(draft.trim());
            setDraft('');
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="gg!" aria-label="chat message" />
          <Button type="submit" variant="ghost">Send</Button>
        </form>
      )}
    </Card>
  );
}
