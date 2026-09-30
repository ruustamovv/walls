/**
 * Party table: 2–4 seats, humans + bots (local) or real players (online).
 * Local query: ?players=4&humans=1&size=9&walls=5
 * Online query: ?online=1&gameId=m_...
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MultiBoard, { SEAT_COLORS } from '../../components/game/MultiBoard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import { Avatar, Badge, Button, Card, Spinner, TextInput } from '../../components/ui/primitives.js';
import { useMultiGame } from '../../hooks/useMultiGame.js';
import { useOnlineMultiGame } from '../../hooks/useOnlineMultiGame.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useSession } from '../../stores/session.js';
import { multiRotationDeg, rotationStyle } from '../../lib/orientation.js';
import { api } from '../../lib/api.js';
import { copyText } from '../../lib/export.js';
import { playSound } from '../../lib/sound.js';
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
  const onlineGameId = params.get('online') === '1' ? params.get('gameId') : null;
  void location;

  if (onlineGameId !== null && onlineGameId !== '') {
    return <OnlineParty gameId={onlineGameId} />;
  }

  const game = useMultiGame({ players, humans, size, wallsPerPlayer: walls });
  const { state, actions } = game;
  const done = state.isOver;
  // Main player (seat 0) sits at the bottom: rotate so their side starts low.
  const [flipped, setFlipped] = useState(false);
  const rotation = multiRotationDeg(state.sides[0] ?? 'S', flipped);

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
          <div style={rotationStyle(rotation)}>
            <MultiBoard
              state={state}
              humanSeats={game.humanSeats}
              interactive={!done && !game.botThinking}
              onMove={game.doMove}
              onWall={game.doWall}
              lastAction={state.lastAction}
            />
          </div>
          {game.message !== '' && <p role="status" style={{ color: 'var(--bad)' }}>{game.message}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => setFlipped((f) => !f)}>Flip</Button>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Moves · {players}P {humans < players ? `· ${humans} human + ${players - humans} bot` : '· all human'}</h3>
            <MoveList actions={actions as Action[]} size={size} />
          </Card>
          <Card>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={game.restart}>Restart</Button>
              <Button variant="subtle" onClick={() => navigate('/play')}>New game</Button>
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>
              Turn: <strong style={{ color: SEAT_COLORS[state.turn % SEAT_COLORS.length] }}>{names[state.turn]}</strong> ·
              first pawn to its glowing edge wins. {players === 4 && humans === 2 ? '2v2 team: seats 1+3 vs 2+4.' : ''}
              5–6 seats need a 15×15+ custom board — coming next.
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

function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function OnlineParty({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
  const { user } = useSession();
  useTheme('arena');
  const game = useOnlineMultiGame(gameId, user?.id ?? null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [draft, setDraft] = useState('');
  const [flipped, setFlipped] = useState(false);
  const snap = game.snapshot;

  if (snap === null) {
    return (
      <div>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <div style={{ marginTop: 16 }}>{game.error !== null ? <p role="alert" style={{ color: 'var(--bad)' }}>{game.error}</p> : <Spinner />}</div>
      </div>
    );
  }

  const mySeat = game.mySeat;
  const done = snap.isOver || snap.status === 'finished';
  // Main player ALWAYS at the bottom: rotate so their side starts low.
  const mySide = mySeat === null ? (snap.state.sides[0] ?? 'S') : (snap.state.sides[mySeat] ?? 'S');
  const rotation = multiRotationDeg(mySide, flipped);
  const nameOf = (seat: number): string =>
    game.meta?.[seat]?.username ?? (snap.seats[seat] !== null ? `Player ${seat + 1}` : 'Open seat…');
  const myPlace = mySeat === null ? null : snap.placement.indexOf(mySeat) + 1;

  return (
    <div style={{ animation: 'quoridor-lift .3s ease' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <h1 className="font-display" style={{ margin: 0, fontSize: 20 }}>
          Party · {snap.players} players · casual
        </h1>
        {snap.status === 'waiting' ? <Badge tone="warn">waiting for players</Badge> : done ? <Badge tone="neutral">finished</Badge> : <Badge tone="good">live</Badge>}
        {!game.connected && <Badge tone="bad">reconnecting</Badge>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => void copyText(`${window.location.origin}/play/multi?online=1&gameId=${snap.id}`)} style={partyBtn}>Invite link</button>
        </span>
      </div>
      {game.error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{game.error}</p>}
      {snap.status === 'waiting' && (
        <Card>
          <p style={{ margin: 0, fontSize: 14 }}>
            Share the invite link — the game starts when all {snap.players} seats fill.
            ({snap.seats.filter((s) => s !== null).length}/{snap.players} seated)
          </p>
        </Card>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 640 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {snap.seats.map((_, i) => (
              <span
                key={i}
                style={{
                  display: 'inline-flex', gap: 8, alignItems: 'center',
                  background: 'var(--surface)', border: `2px solid ${snap.turn === i && !done ? SEAT_COLORS[i % SEAT_COLORS.length] : 'var(--line)'}`,
                  borderRadius: 10, padding: '6px 10px', fontSize: 14, fontWeight: snap.turn === i ? 800 : 500,
                }}
              >
                <Avatar name={nameOf(i)} size={24} />
                {i === mySeat ? 'You' : nameOf(i)}
                <span className="font-mono" style={{ color: snap.turn === i ? 'var(--ink)' : 'var(--muted)' }}>{formatClock(game.clocks[i] ?? 0)}</span>
                <span style={{ color: 'var(--muted)' }}>▮ {snap.state.wallsRemaining[i] ?? 0}</span>
              </span>
            ))}
          </div>
          <div style={rotationStyle(rotation)}>
            <MultiBoard
              state={{ ...snap.state, sides: snap.state.sides as ('N' | 'S' | 'E' | 'W')[] }}
              humanSeats={mySeat === null ? [] : [mySeat]}
              interactive={mySeat !== null && game.connected && snap.status === 'active' && !done}
              onMove={game.sendMove}
              onWall={game.sendWall}
              lastAction={snap.state.lastAction}
            />
          </div>
          {mySeat !== null && (
            <Card>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Avatar name={nameOf(mySeat)} size={30} />
                <div style={{ flex: 1 }}>
                  <strong>You · {nameOf(mySeat)}</strong>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    <span className="font-mono">{formatClock(game.clocks[mySeat] ?? 0)}</span>
                    {' · '}▮ {snap.state.wallsRemaining[mySeat] ?? 0} walls
                    {!done && snap.turn === mySeat && ' · your turn'}
                    {done && myPlace !== null && myPlace > 0 && ` · #${myPlace} of ${snap.players}`}
                  </div>
                </div>
                <span
                  aria-hidden
                  style={{ width: 12, height: 12, borderRadius: '50%', background: SEAT_COLORS[mySeat % SEAT_COLORS.length] }}
                />
              </div>
            </Card>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setFlipped((f) => !f)} style={partyBtn}>Flip</button>
            {mySeat !== null && !done && snap.status === 'active' && (
              confirmResign
                ? (<><button onClick={() => game.sendResign()} style={{ ...partyBtn, background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }}>Confirm</button><button onClick={() => setConfirmResign(false)} style={partyBtn}>Keep playing</button></>)
                : (<button onClick={() => setConfirmResign(true)} style={partyBtn}>Resign</button>)
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Moves</h3>
            <MoveList actions={game.actions as Action[]} size={snap.state.size} />
          </Card>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Table talk</h3>
            <div aria-live="polite" style={{ display: 'grid', gap: 6, maxHeight: 200, overflowY: 'auto', marginBottom: 8 }}>
              {game.chat.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No messages yet.</p>}
              {game.chat.map((m, i) => (
                <p key={i} style={{ margin: 0, fontSize: 14 }}>
                  <strong>{m.from === user?.id ? 'You' : (game.meta?.find((p) => p?.id === m.from)?.username ?? 'Player')}</strong>{' '}
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(m.at).toLocaleTimeString()}</span>
                  <br />{m.body}
                </p>
              ))}
            </div>
            {mySeat !== null && !done && (
              <form onSubmit={(e) => { e.preventDefault(); if (draft.trim().length === 0) return; game.sendChat(draft.trim()); setDraft(''); void playSound('notify'); }} style={{ display: 'flex', gap: 8 }}>
                <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Message…" aria-label="chat message" />
                <Button type="submit" variant="ghost">Send</Button>
              </form>
            )}
          </Card>
          <Card>
            <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Details</h3>
            <div style={{ fontSize: 13, display: 'grid', gap: 4, color: 'var(--muted)' }}>
              <span>{snap.timeControlId} · casual · {snap.state.size}×{snap.state.size}</span>
              <span>Move {snap.moveCount}{myPlace !== null && myPlace > 0 ? ` · you #${myPlace}` : ''}</span>
              {!game.connected && <span>Reconnecting…</span>}
            </div>
          </Card>
        </div>
      </div>
      {done && (
        <ResultModal
          winnerSeat={null}
          reason={snap.finishReason}
          perspective={null}
          moveCount={snap.moveCount}
          durationSec={Math.max(0, Math.round((snap.updatedAt - snap.createdAt) / 1000))}
          title={mySeat !== null && myPlace !== null && myPlace > 0
            ? (myPlace === 1 ? `You win the party! 🏆` : `You finished #${myPlace} of ${snap.players}`)
            : `${nameOf(snap.winnerSeat ?? 0)} wins the party!`}
          won={myPlace === 1}
          onRematch={undefined}
          onNewGame={() => navigate('/play')}
          onHome={() => navigate('/')}
        />
      )}
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

const partyBtn: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
  padding: '6px 12px', fontSize: 13, fontWeight: 800, color: 'var(--ink)',
};

export function PartyOnlineActions() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (pollRef.current !== null) clearInterval(pollRef.current);
  }, []);

  async function quickMatch(players: number) {
    if (user === null) { navigate('/login?next=/play'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api.multiMmJoin({ players, timeControl: '3+0' });
      if (res.status === 'matched') {
        playSound('match');
        navigate(`/play/multi?online=1&gameId=${res.gameId}`);
      } else {
        setError(`Waiting for ${players}-player table… keep this tab open.`);
        poll();
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Matchmaking failed');
    }
  }

  function poll() {
    if (pollRef.current !== null) clearInterval(pollRef.current);
    const id = setInterval(async () => {
      try {
        const res = await api.multiMmStatus();
        if (res.status === 'matched') {
          if (pollRef.current !== null) clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(false);
          playSound('match');
          navigate(`/play/multi?online=1&gameId=${res.gameId}`);
        }
      } catch { /* keep polling */ }
    }, 1500);
    pollRef.current = id as unknown as number;
    setTimeout(() => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setBusy(false);
      }
    }, 120000);
  }

  async function createPrivate(players: number) {
    if (user === null) { navigate('/login?next=/play'); return; }
    setBusy(true);
    setError(null);
    try {
      const g = await api.multiCreate({ players, timeControl: '3+0' });
      navigate(`/play/multi?online=1&gameId=${g.id}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not create table');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[2, 3, 4].map((n) => (
          <Button key={n} variant="ghost" disabled={busy} onClick={() => void quickMatch(n)}>
            {n}P quick match
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[2, 3, 4].map((n) => (
          <Button key={n} variant="subtle" disabled={busy} onClick={() => void createPrivate(n)}>
            {n}P private link
          </Button>
        ))}
      </div>
      {error !== null && <p role="status" style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
