/**
 * Party table: 2–6 seats, humans + bots (local) or real players (online).
 * Local query: ?players=4&humans=1&size=9&walls=5
 * Online query: ?online=1&gameId=m_...
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import MultiBoard, { SEAT_COLORS } from '../../components/game/MultiBoard.js';
import MoveList from '../../components/game/MoveList.js';
import ResultModal from '../../components/game/ResultModal.js';
import { Avatar, Badge, Button, Card, Segmented, Spinner, TextInput } from '../../components/ui/primitives.js';
import { useMultiGame } from '../../hooks/useMultiGame.js';
import { useOnlineMultiGame } from '../../hooks/useOnlineMultiGame.js';
import { useTheme } from '../../hooks/useTheme.js';
import { useSession } from '../../stores/session.js';
import { useSettings } from '../../stores/settings.js';
import { multiRotationDeg, rotationStyle } from '../../lib/orientation.js';
import { estimateMultiWinShare, shortestToSide } from '../../../../engine/typescript/index.js';
import { SCENARIOS, getScenario } from '../../../../engine/typescript/index.js';
import { api } from '../../lib/api.js';
import { copyText } from '../../lib/export.js';
import { playSound } from '../../lib/sound.js';
import { toast } from '../../stores/toasts.js';
import type { Action } from '../../../../engine/typescript/core/types.js';
import { presetForPlayers } from '../../../../engine/typescript/index.js';

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

  const players = clampInt(params.get('players'), 4, 2, 6);
  const humans = clampInt(params.get('humans'), 1, 1, players);
  const preset = presetForPlayers(players);
  const size = clampInt(params.get('size'), preset.size, 5, 21);
  const walls = clampInt(params.get('walls'), preset.wallsPerPlayer, 0, 30);
  const scenarioId = params.get('scenario') ?? 'classic';
  const onlineGameId = params.get('online') === '1' ? params.get('gameId') : null;
  void location;

  if (onlineGameId !== null && onlineGameId !== '') {
    return <OnlineParty gameId={onlineGameId} />;
  }

  // Fog needs separate screens: a local ?scenario=fog degrades to classic
  // instead of claiming a mode the shared board cannot enforce.
  const picked = getScenario(scenarioId) ?? getScenario('classic')!;
  const effectiveScenarioId = picked.onlineOnly ? 'classic' : picked.id;
  const game = useMultiGame({ players, humans, size, wallsPerPlayer: walls, scenario: effectiveScenarioId });
  const { state, actions } = game;
  const scenario = getScenario(effectiveScenarioId) ?? getScenario('classic')!;
  const done = state.isOver;
  const boardTheme = useSettings((s) => s.boardTheme);
  // Main player (seat 0) sits at the bottom: rotate so their side starts low.
  const [flipped, setFlipped] = useState(false);
  const rotation = multiRotationDeg(state.sides[0] ?? 'S', flipped);

  const names = Array.from({ length: players }, (_, i) =>
    i < humans ? `Player ${i + 1}` : `Bot ${i + 1}`,
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Play</Link>
        <h1 className="font-display" style={{ margin: 0, fontSize: 22 }}>
          Party · {players} players {humans < players ? `(${humans} human)` : '(all human)'}
        </h1>
        {scenario !== null && scenario.id !== 'classic' && (
          <Badge tone="info" >{scenario.name} — {scenario.blurb}</Badge>
        )}
        {picked.onlineOnly && (
          <Badge tone="warn">Fog of war needs separate screens — playing classic on this device</Badge>
        )}
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
          <div data-board={boardTheme} style={rotationStyle(rotation)}>
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
              {players >= 5 ? 'Shared edges use offset start lanes.' : ''}
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
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Play</Link>
        <div style={{ marginTop: 16 }}>{game.error !== null ? <p role="alert" style={{ color: 'var(--bad)' }}>{game.error}</p> : <Spinner />}</div>
      </div>
    );
  }

  const mySeat = game.mySeat;
  const done = snap.isOver || snap.status === 'finished';
  const boardTheme = useSettings((s) => s.boardTheme);
  // Main player ALWAYS at the bottom: rotate so their side starts low.
  const mySide = mySeat === null ? (snap.state.sides[0] ?? 'S') : (snap.state.sides[mySeat] ?? 'S');
  const rotation = multiRotationDeg(mySide, flipped);
  const nameOf = (seat: number): string =>
    game.meta?.[seat]?.username ?? (snap.seats[seat] !== null ? `Player ${seat + 1}` : 'Open seat…');
  const myPlace = mySeat === null ? null : snap.placement.indexOf(mySeat) + 1;
  // Estimated win share per seat (ENB-004): deterministic route-based
  // estimate, labeled as such — never presented as certainty.
  const winShare = useMemo(() => {
    if (done) return null;
    try {
      const paths = snap.state.pawns.map((p, i) => {
        const side = (snap.state.sides[i] ?? 'S') as 'N' | 'S' | 'E' | 'W';
        const l = shortestToSide(snap.state.walls, snap.state.size, p, side).length;
        return l < 0 ? 999 : l;
      });
      return estimateMultiWinShare(paths, snap.state.wallsRemaining, snap.turn);
    } catch {
      return null;
    }
  }, [done, snap.state]);

  return (
    <div style={{ animation: 'quoridor-lift .3s ease' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Play</Link>
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
                {snap.eliminated.includes(i) && <Badge tone="neutral">finished #{snap.placement.indexOf(i) + 1}</Badge>}
              {snap.teamOf !== null && (
                <Badge tone={snap.winningTeam === snap.teamOf[i] && done ? 'good' : 'info'}>
                  {TEAM_LABELS[snap.teamOf[i]] ?? `Team ${snap.teamOf[i]}`}
                </Badge>
              )}
              </span>
            ))}
          </div>
          <div data-board={boardTheme} style={rotationStyle(rotation)}>
            <MultiBoard
              state={{
                ...snap.state,
                sides: snap.state.sides as ('N' | 'S' | 'E' | 'W')[],
                continueAfterWin: snap.continueForPlacement,
                eliminated: snap.eliminated,
                placement: snap.placement,
                teamOf: snap.teamOf,
                winningTeam: snap.winningTeam,
                fog: snap.fog,
                chaos: snap.chaos,
                siege: snap.siege,
                siegeHeadStart: 0,
              }}
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
              <span>{snap.teamMode
                ? `Team game — ${TEAM_LABELS[0]} seats 1+3 vs ${TEAM_LABELS[1]} seats 2+4; first pawn home wins for its team`
                : snap.continueForPlacement
                  ? 'Full placement race — every seat finishes'
                  : 'First to the goal wins'}</span>
              {snap.fog && (
                <span title="Walls far from your pawn stay hidden until you get close.">
                  Fog of war{snap.hiddenWalls > 0 ? ` · ${snap.hiddenWalls} wall${snap.hiddenWalls === 1 ? '' : 's'} out of sight` : ' · board clear around you'}
                </span>
              )}
              {snap.chaos && <span>Chaos — walls rotate between seats</span>}
              {snap.siege && <span>Siege — seat 1 has the wall advantage and a head start</span>}
              <span>Move {snap.moveCount}{myPlace !== null && myPlace > 0 ? ` · you #${myPlace}` : ''}</span>
              {winShare !== null && !done && (
                <span title={`Estimated win share (${winShare.confidence} confidence)`}>
                  {winShare.shares.map((s, i) => `P${i + 1} ~${s.toFixed(0)}%`).join(' · ')}
                </span>
              )}
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
          title={snap.teamMode && snap.winningTeam !== null
            ? (mySeat !== null && snap.teamOf?.[mySeat] === snap.winningTeam
                ? `${TEAM_LABELS[snap.winningTeam]} wins!`
                : `${TEAM_LABELS[snap.winningTeam]} wins this one`)
            : mySeat !== null && myPlace !== null && myPlace > 0
              ? (myPlace === 1 ? `You win the party!` : `You finished #${myPlace} of ${snap.players}`)
              : `${nameOf(snap.winnerSeat ?? 0)} wins the party!`}
          won={snap.teamMode && snap.winningTeam !== null
            ? mySeat !== null && snap.teamOf?.[mySeat] === snap.winningTeam
            : myPlace === 1}
          onRematch={undefined}
          onNewGame={() => navigate('/play')}
          onHome={() => navigate('/')}
        />
      )}
      {done && snap.teamMode && snap.teamOf !== null && (
        <Card style={{ maxWidth: 640 }}>
          <h3 className="font-display" style={{ margin: '0 0 8px' }}>Team result</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '4px 8px' }}>Team</th>
                <th style={{ padding: '4px 8px' }}>Players</th>
                <th style={{ padding: '4px 8px' }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {TEAM_LABELS.map((label, team) => {
                const seats = snap.seats
                  .map((_, i) => i)
                  .filter((i) => snap.teamOf?.[i] === team);
                const won = snap.winningTeam === team;
                return (
                  <tr key={label} style={{ borderTop: '1px solid var(--line)', fontWeight: won ? 800 : 400 }}>
                    <td style={{ padding: '4px 8px' }}>{label}</td>
                    <td style={{ padding: '4px 8px' }}>
                      {seats.map((i) => (i === snap.winnerSeat ? `${nameOf(i)} ★` : nameOf(i))).join(', ')}
                    </td>
                    <td style={{ padding: '4px 8px', color: won ? 'var(--good)' : 'var(--muted)' }}>
                      {won ? 'won' : 'lost'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {done && snap.placement.length > 1 && (
        <Card style={{ maxWidth: 640 }}>
          <h3 className="font-display" style={{ margin: '0 0 8px' }}>Final placement</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                <th style={{ padding: '4px 8px' }}>#</th>
                <th style={{ padding: '4px 8px' }}>Player</th>
                <th style={{ padding: '4px 8px' }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {snap.placement.map((seat, i) => (
                <tr key={seat} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 800 }}>{i + 1}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: SEAT_COLORS[seat % SEAT_COLORS.length], marginRight: 8 }} />
                    {seat === mySeat ? 'You' : nameOf(seat)}
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>
                    {snap.finishReason === 'goal' ? 'reached goal' : snap.finishReason ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

const TEAM_LABELS = ['Team A', 'Team B'] as const;

const partyBtn: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
  padding: '6px 12px', fontSize: 13, fontWeight: 800, color: 'var(--ink)',
};

export function PartyOnlineActions() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState(9);
  const [walls, setWalls] = useState(5);
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'unlisted' | 'private'>('public');
  const [continueForPlacement, setContinueForPlacement] = useState(false);
  // Party presets (MLT-009): team 2v2 and the opt-in placement race are
  // chosen here instead of threading a new query parameter through the page.
  const [teamMode, setTeamMode] = useState(false);
  const [fog, setFog] = useState(false);
  const [chaos, setChaos] = useState(false);
  const [siege, setSiege] = useState(false);
  // Which seat count the mode checkboxes apply to (the last one clicked).
  const [modePlayers, setModePlayers] = useState(4);
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
        toast('good', 'Party table ready!');
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
          toast('good', 'Party table ready!');
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

  // `team` forces team mode for the dedicated 2v2 preset button.
  async function createPrivate(players: number, team = false) {
    if (user === null) { navigate('/login?next=/play'); return; }
    setBusy(true);
    setError(null);
    try {
      const teamOn = team || (teamMode && (players === 4 || players === 2));
      // Siege is inherently 1v1 (one attacker vs one defender).
      const siegeOn = siege && players === 2;
      const g = await api.multiCreate({
        players,
        boardSize: size,
        wallsPerPlayer: walls,
        timeControl: '3+0',
        visibility,
        // Team mode and the placement race are mutually exclusive server-side.
        continueForPlacement: teamOn ? false : continueForPlacement,
        teamMode: teamOn,
        fog,
        chaos: teamOn || siegeOn ? false : chaos,
        siege: siegeOn,
      });
      navigate(`/play/multi?online=1&gameId=${g.id}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not create table');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Scenario</span>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            disabled={busy}
            title={s.blurb}
            onClick={() => {
              setTeamMode(s.flags.teamMode === true);
              setContinueForPlacement(s.flags.continueAfterWin === true);
              setFog(s.flags.fog === true);
              setChaos(s.flags.chaos === true);
              setSiege(s.flags.siege === true);
              if (s.seats.length > 0) setModePlayers(s.seats[s.seats.length - 1] ?? 4);
            }}
            style={{
              borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: '1px solid var(--line)', background: 'var(--surface-2)', color: 'var(--ink)',
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Board</span>
        <Segmented options={['9', '13', '15', '19', '21']} active={String(size)} onChange={(t) => setSize(Number(t))} ariaLabel="party board size" />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Walls</span>
        <Segmented options={['0', '5', '8', '10']} active={String(walls)} onChange={(t) => setWalls(Number(t))} ariaLabel="party walls" />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Watch</span>
        <Segmented options={['public', 'friends', 'unlisted', 'private'] as const} active={visibility} onChange={setVisibility} ariaLabel="party visibility" />
      </div>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={continueForPlacement}
          disabled={teamMode}
          onChange={(e) => setContinueForPlacement(e.target.checked)}
        />
        Full placement race — keep playing until every seat finishes
      </label>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={teamMode}
          onChange={(e) => { setTeamMode(e.target.checked); if (e.target.checked) setContinueForPlacement(false); }}
        />
        Team game{teamMode ? ` — seats 1+3 vs 2+4 share the win` : ' (2v2 or 2-seat only)'}
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[2, 3, 4, 5, 6].map((n) => (
          <Button key={n} variant="ghost" disabled={busy} onClick={() => void quickMatch(n)}>
            {n}P quick match
          </Button>
        ))}
      </div>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
        <input type="checkbox" checked={fog} onChange={(e) => setFog(e.target.checked)} />
        Fog of war — you only see walls near your own pawn
      </label>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={chaos}
          disabled={teamMode || (siege && modePlayers === 2)}
          onChange={(e) => setChaos(e.target.checked)}
        />
        Chaos — wall budget rotates, nobody banks an arsenal
      </label>
      <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={siege}
          disabled={modePlayers !== 2}
          onChange={(e) => { setSiege(e.target.checked); if (e.target.checked) setChaos(false); }}
        />
        Siege — 2P only: seat 1 starts a row in with extra walls
      </label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="subtle" disabled={busy} onClick={() => void createPrivate(4, true)}>
          2v2 team private link
        </Button>
        {[2, 3, 4, 5, 6].map((n) => (
          <Button
            key={n}
            variant="ghost"
            disabled={busy}
            onClick={() => { setModePlayers(n); void createPrivate(n); }}
          >
            {n}P private link
          </Button>
        ))}
      </div>
      {error !== null && <p role="status" style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>{error}</p>}
    </div>
  );
}
