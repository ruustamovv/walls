/**
 * Quoridor live game: board left, details sidebar right.
 * Self always at bottom. Eval bar (own engine) + Moves/Chat/Review tabs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { winChanceFor } from '../../../../engine/typescript/eval/winChance.js';
import { QUICK_CHAT } from '../../../../engine/typescript/index.js';
import { findShortestPath } from '../../../../engine/typescript/index.js';
import { TextInput } from '../../components/ui/primitives.js';
import { playSound } from '../../lib/sound.js';
import { haptic } from '../../lib/haptics.js';
import { api } from '../../lib/api.js';
import { copyText, exportGame } from '../../lib/export.js';
import GameBoard from '../../components/game/GameBoard.js';
import PlayerCard from '../../components/game/PlayerCard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import ReviewPanel from '../../components/game/ReviewPanel.js';
import CommentaryBox from '../../components/game/CommentaryBox.js';
import { Badge, Button, Card, ErrorBox, EvalBar, Spinner } from '../../components/ui/primitives.js';
import { useOnlineGame } from '../../hooks/useOnlineGame.js';
import { ratingModeFor, timeControlName } from '../../lib/format.js';
import { duelBottomSeat, duelRotated, rotationStyle } from '../../lib/orientation.js';
import { useSession } from '../../stores/session.js';
import { useSettings } from '../../stores/settings.js';
import { useTheme } from '../../hooks/useTheme.js';

type Tab = 'moves' | 'chat' | 'review';

export default function GamePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const [confirmResign, setConfirmResign] = useState(false);
  const [tab, setTab] = useState<Tab>('moves');
  const [flipped, setFlipped] = useState(false);
  const soundOn = useSettings((s) => s.sound);
  const setSound = useSettings((s) => s.setSound);
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
    } catch {
      game.refresh();
    }
  }

  const soundedMoves = useRef(0);
  useEffect(() => {
    const n = game.snapshot?.moveCount ?? 0;
    if (n > soundedMoves.current) {
      soundedMoves.current = n;
      const isWall = game.snapshot?.state.lastAction?.type === 'wall';
      playSound(isWall ? 'wall' : 'move');
      if (isWall) haptic.wall(); else haptic.move();
    }
  }, [game.snapshot]);

  const soundedEnd = useRef(false);
  useEffect(() => {
    if (game.snapshot === null || !game.snapshot.isOver || soundedEnd.current) return;
    soundedEnd.current = true;
    const w = game.snapshot.winnerSeat;
    const won = game.mySeat !== null && w === game.mySeat;
    playSound(won ? 'win' : 'lose');
    if (won) haptic.victory(); else haptic.error();
  }, [game.snapshot, game.mySeat]);

  const { snapshot: snap } = game;
  if (snap === null) {
    return (
      <div>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Play</Link>
        <div style={{ marginTop: 16 }}>{game.error !== null ? <ErrorBox message={game.error} onRetry={game.refresh} /> : <Spinner />}</div>
      </div>
    );
  }

  return <LiveGame snap={snap} game={game} id={id} userId={user?.id ?? null} isGuest={user?.guest === true} tab={tab} setTab={setTab} confirmResign={confirmResign} setConfirmResign={setConfirmResign} flipped={flipped} setFlipped={setFlipped} soundOn={soundOn} setSound={setSound} rematch={rematch} navigate={navigate} />;
}

function LiveGame({ snap, game, id, userId, isGuest, tab, setTab, confirmResign, setConfirmResign, flipped, setFlipped, soundOn, setSound, rematch, navigate }: any) {
  const mySeat = game.mySeat as 0 | 1 | null;
  const spectating = mySeat === null;
  // Main player ALWAYS at the bottom: bottom card is the user (or seat 0
  // for spectators) and the board rotates so their pawn starts at bottom.
  const bottomSeat = duelBottomSeat(mySeat, flipped);
  const topSeat = (1 - bottomSeat) as 0 | 1;
  const rotated = duelRotated(mySeat, flipped);

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
  const p0Path = useMemo(() => findShortestPath(state as any, 0).length, [snap.state]);
  const p1Path = useMemo(() => findShortestPath(state as any, 1).length, [snap.state]);
  // Win% from bottom player's perspective for the bar.
  const bottomWin = winChanceFor(bottomSeat, bottomSeat === 0 ? p0Path : p1Path, bottomSeat === 0 ? p1Path : p0Path, snap.state.wallsRemaining[bottomSeat], snap.state.wallsRemaining[topSeat], snap.moveCount);
  const topWin = Math.round((100 - bottomWin) * 10) / 10;
  const humanSeats = useMemo(() => (mySeat === null ? [] : [mySeat]), [mySeat]);
  const nameOf = (seat: 0 | 1): string => game.meta?.[seat]?.username ?? (snap.seats[seat] !== null ? `Player ${seat + 1}` : 'Waiting…');
  const ratingOf = (seat: 0 | 1): number | null => game.meta?.[seat]?.rating ?? null;
  const done = snap.isOver || snap.status === 'finished';
  const waiting = snap.status === 'waiting';
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  async function join(): Promise<void> {
    setJoinBusy(true);
    setJoinError(null);
    try {
      await api.joinGame(snap.id);
      game.refresh();
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Could not join');
    } finally {
      setJoinBusy(false);
    }
  }

  return (
    <div style={{ animation: 'quoridor-lift .3s ease' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Play</Link>
        <h1 style={{ margin: 0, fontSize: 20 }} className="font-display">{timeControlName(snap.timeControlId)} · {snap.mode}</h1>
        {snap.status === 'finished' ? <Badge tone="neutral">finished</Badge> : snap.status === 'waiting' ? <Badge tone="warn">waiting</Badge> : <Badge tone="good">live</Badge>}
        {!game.connected && <Badge tone="bad">reconnecting</Badge>}
        {spectating && <Badge tone="info">watching</Badge>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => void copyText(`${window.location.origin}/game/${snap.id}`)} style={btn}>Share</button>
          <button onClick={() => exportGame(snap.id, snap)} style={btn}>Export</button>
        </span>
      </div>
      {game.error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{game.error}</p>}
      <span aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {done ? 'Game over' : spectating ? 'Watching live game' : snap.turn === mySeat ? 'Your turn' : 'Opponent turn'}
      </span>
      <div className="quoridor-game" style={{ display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) 330px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 58 }}>
          {waiting ? (
            <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>Chance appears when the game starts</span>
          ) : (
            <>
              <EvalBar whitePct={bottomWin} label={`You ${bottomWin}% · Opp ${topWin}%`} />
              <span className="font-mono" style={{ fontSize: 11, fontWeight: 800 }}>{bottomWin.toFixed(0)}%</span>
              <Badge tone="info">Free</Badge>
            </>
          )}
        </div>
        <div style={{ maxWidth: 660, width: '100%', margin: '0 auto' }}>
          <PlayerCard name={nameOf(topSeat)} rating={ratingOf(topSeat)} winPct={waiting ? null : topWin} clockMs={game.clocks[topSeat]} clockActive={!done && snap.turn === topSeat} lowTime={game.clocks[topSeat] < 30000} wallsLeft={snap.state.wallsRemaining[topSeat]} wallsTotal={state.wallsPerPlayer} isTurn={!done && snap.turn === topSeat} isYou={mySeat === topSeat} connected={game.connected} accent={topSeat} />
          <div style={{ margin: '10px 0', ...rotationStyle(rotated ? 180 : 0) }}>
            <GameBoard state={state as any} humanSeats={humanSeats} interactive={!spectating && game.connected} onMove={game.sendMove} onWall={game.sendWall} lastAction={snap.state.lastAction} showPaths={null} />
          </div>
          <PlayerCard name={mySeat === null ? nameOf(bottomSeat) : `You · ${nameOf(bottomSeat)}`} rating={ratingOf(bottomSeat)} winPct={waiting ? null : bottomWin} clockMs={game.clocks[bottomSeat]} clockActive={!done && snap.turn === bottomSeat} lowTime={game.clocks[bottomSeat] < 30000} wallsLeft={snap.state.wallsRemaining[bottomSeat]} wallsTotal={state.wallsPerPlayer} isTurn={!done && snap.turn === bottomSeat} isYou={mySeat === bottomSeat} connected={game.connected} accent={bottomSeat} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setFlipped((f: boolean) => !f)} style={btn}>Flip</button>
            <button onClick={() => setSound(!soundOn)} style={btn}>{soundOn ? 'Sound on' : 'Muted'}</button>
            {!spectating && !done && (confirmResign
              ? (<><button onClick={() => game.sendResign()} style={{ ...btn, background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }}>Confirm</button><button onClick={() => setConfirmResign(false)} style={btn}>Keep playing</button></>)
              : (<><button onClick={() => game.sendDrawOffer()} style={btn} disabled={snap.drawOfferBy === mySeat}>{snap.drawOfferBy === mySeat ? 'Offer sent' : 'Draw'}</button><button onClick={() => setConfirmResign(true)} style={btn}>Resign</button></>))}
          </div>
          {waiting && spectating && (
            <Card>
              <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Open seat</h3>
              {userId === null ? (
                <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}><Link to={`/login?next=/game/${snap.id}`}>Log in</Link> to take this seat.</p>
              ) : (
                <>
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 8px' }}>This link is a private invite — first to join plays.</p>
                  {joinError !== null && <p role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{joinError}</p>}
                  <Button onClick={() => void join()} disabled={joinBusy} style={{ width: '100%' }}>{joinBusy ? 'Joining…' : 'Join game'}</Button>
                </>
              )}
            </Card>
          )}
          {!spectating && !done && snap.drawOfferBy !== null && snap.drawOfferBy !== mySeat && (
            <Card><Badge tone="warn">Draw offered</Badge> <Button size="sm" onClick={() => game.sendDrawResponse(true)}>Accept</Button> <Button size="sm" variant="ghost" onClick={() => game.sendDrawResponse(false)}>Decline</Button></Card>
          )}
        </div>
        <aside style={{ display: 'grid', gap: 12, position: 'sticky', top: 12 }} aria-label="Game details">
          <Card>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(['moves', 'chat', 'review'] as Tab[]).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{ flex: 1, borderRadius: 10, padding: '7px 0', fontWeight: 800, fontSize: 13, textTransform: 'capitalize', border: tab === t ? '2px solid var(--primary)' : '1px solid var(--line)', background: tab === t ? 'var(--primary-soft)' : 'var(--surface)', color: 'var(--ink)' }}>{t}</button>
              ))}
            </div>
            {tab === 'moves' && <MoveList actions={game.actions} size={snap.state.size} onExport={() => exportGame(snap.id, snap)} />}
            {tab === 'chat' && <ChatBox messages={game.chat} canSend={!spectating && !done && !isGuest} quickOnly={snap.mode === 'ranked'} onSend={game.sendChat} names={new Map([...(snap.seats[0] !== null ? [[snap.seats[0], nameOf(0)] as [string, string]] : []), ...(snap.seats[1] !== null ? [[snap.seats[1], nameOf(1)] as [string, string]] : [])])} myUserId={userId} guestNote={isGuest === true} />}
            {tab === 'review' && (done ? <ReviewPanel gameId={id} /> : <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Review unlocks at finish. Win% bar stays live.</p>)}
          </Card>
          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Details</h3>
            <div style={{ fontSize: 13, display: 'grid', gap: 4, color: 'var(--muted)' }}>
              <span>Route you <strong className="font-mono" style={{ color: 'var(--ink)' }}>{bottomSeat === 0 ? p0Path : p1Path}</strong> · Opp <strong className="font-mono" style={{ color: 'var(--ink)' }}>{topSeat === 0 ? p0Path : p1Path}</strong></span>
              <span>Walls {snap.state.wallsRemaining[0]}–{snap.state.wallsRemaining[1]} · Move {snap.moveCount}</span>
              <span>{snap.mode} · {ratingModeFor(snap.timeControlId)} {snap.mode === 'ranked' ? '· rated' : '· casual'}</span>
            </div>
          </Card>
          {spectating && <CommentaryBox gameId={id} />}
          {done && <Button onClick={() => setTab('review')}>Game review</Button>}
        </aside>
      </div>
      {done && <GameResult snap={snap} mySeat={mySeat} myUsername={mySeat === null ? null : nameOf(mySeat)} isGuest={isGuest === true} onRematch={rematch} onReview={() => setTab('review')} onNewGame={() => navigate('/play')} onHome={() => navigate('/')} onRegister={() => navigate('/signup?next=/play')} />}
      <style>{`@media (max-width: 1020px){.quoridor-game{grid-template-columns:30px minmax(0,1fr)!important}.quoridor-game aside{grid-column:1/-1;position:static!important}}`}</style>
    </div>
  );
}

function GameResult({ snap, mySeat, myUsername, isGuest, onRematch, onReview, onNewGame, onHome, onRegister }: any) {
  const [delta, setDelta] = useState<{ rating: number; delta: number } | null>(null);
  useEffect(() => {
    if (myUsername === null) return;
    api.ratingHistory(myUsername, ratingModeFor(snap.timeControlId)).then((r) => {
      const last = r.points[r.points.length - 1];
      if (last !== undefined) setDelta({ rating: last.after, delta: last.after - last.before });
    }).catch(() => undefined);
  }, [snap.id, snap.timeControlId, myUsername]);
  const durationSec = Math.max(0, Math.round((snap.updatedAt - snap.createdAt) / 1000));
  return (
    <ResultModal winnerSeat={snap.winnerSeat} reason={snap.finishReason} perspective={mySeat} moveCount={snap.moveCount} durationSec={durationSec} onRematch={mySeat === null ? undefined : onRematch} onReview={onReview} onNewGame={onNewGame} onHome={onHome} onRegister={onRegister} guestNudge={isGuest === true}
      ratingLine={delta === null ? null : `${ratingModeFor(snap.timeControlId)} ${delta.rating} (${delta.delta >= 0 ? '+' : ''}${delta.delta})`} />
  );
}

const btn: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, padding: '6px 12px', fontSize: 13, fontWeight: 800, color: 'var(--ink)' };

function ChatBox({ messages, canSend, quickOnly, onSend, names, myUserId, guestNote }: {
  messages: { from: string; body: string; at: number }[];
  canSend: boolean;
  /** Ranked games: preset buttons only, no free text (server-enforced). */
  quickOnly?: boolean;
  onSend: (body: string) => void;
  names: Map<string, string>;
  myUserId: string | null;
  guestNote?: boolean;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div aria-live="polite" style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto', marginBottom: 8 }}>
        {messages.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No messages yet.</p>}
        {messages.map((m, i) => (
          <p key={i} style={{ margin: 0, fontSize: 14 }}>
            <strong>{m.from === myUserId ? 'You' : (names.get(m.from) ?? 'Player')}</strong>{' '}
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(m.at).toLocaleTimeString()}</span>
            <br />{m.body}
          </p>
        ))}
      </div>
      {guestNote === true && !canSend && (
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Guests can read chat but not send — register to join the conversation.</p>
      )}
      {canSend && (quickOnly === true ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="quick chat">
          {QUICK_CHAT.map((q) => (
            <button key={q} onClick={() => onSend(q)} style={btn} title={`Send “${q}”`}>{q}</button>
          ))}
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (draft.trim().length === 0) return; onSend(draft.trim()); setDraft(''); }} style={{ display: 'flex', gap: 8 }}>
          <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Message…" aria-label="chat message" />
          <Button type="submit" variant="ghost">Send</Button>
        </form>
      ))}
    </div>
  );
}
