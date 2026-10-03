/**
 * Play — the arena lobby, chess.com style.
 *
 * Centre: a REAL engine board (empty until a game starts — no demo lines, no
 * preview videos, no evaluation numbers before there is a game). Right: the
 * game chooser. Every category opens a settings WINDOW; the board stays put.
 *
 * Access rules (honest, server-enforced too):
 * - signed-out visitors: bot play + guest matchmaking (casual only);
 * - guests: bots + casual matchmaking;
 * - ranked, friend links and party tables need a full account.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BOTS, SCENARIOS, createGame } from '../../../../engine/typescript/index.js';
import { api, clientRegion } from '../../lib/api.js';
import { copyText } from '../../lib/export.js';
import { timeControlName } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';
import { playSound } from '../../lib/sound.js';
import { toast } from '../../stores/toasts.js';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DivisionBadge,
  Modal,
  Segmented,
} from '../../components/ui/primitives.js';
import { AuthModal } from '../../components/auth/AuthModal.js';
import { Icon, type IconName } from '../../components/ui/icons.js';
import GameBoard from '../../components/game/GameBoard.js';
import { PartyOnlineActions } from './MultiGamePage.js';

const TCS = ['1+0', '1+1', '2+1', '3+0', '3+1', '3+2', '5+0', '5+1', '10+0', '10+5', '15+10'] as const;
type Tc = (typeof TCS)[number];

const BOT_CLOCKS = ['none', '1+0', '3+2', '10+0'] as const;
type BotClock = (typeof BOT_CLOCKS)[number];

type Cat = 'bots' | 'online' | 'friend' | 'party' | 'coach';
type Win = null | Cat;

const CATS: { id: Cat; label: string; blurb: string; icon: IconName; needsAccount: boolean; to?: string }[] = [
  { id: 'online', label: 'Online', blurb: 'Same-level opponents', icon: 'bolt', needsAccount: false },
  { id: 'bots', label: 'Bots', blurb: 'Beginner to master', icon: 'bot', needsAccount: false },
  { id: 'coach', label: 'Coach', blurb: 'Learn by playing', icon: 'coach', needsAccount: false, to: '/learn' },
  { id: 'friend', label: 'Friend', blurb: 'Invite with a link', icon: 'friend', needsAccount: true },
  { id: 'party', label: 'Variants', blurb: 'Party modes & scenarios', icon: 'dice', needsAccount: true },
];

function clockToParts(clock: BotClock): { clock: number; inc: number } {
  if (clock === 'none') return { clock: 0, inc: 0 };
  const [m, i] = clock.split('+');
  return { clock: Number(m) * 60, inc: Number(i) };
}

export default function PlayPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, loginAsGuest } = useSession();

  const cat = (params.get('cat') as Cat | null) ?? 'online';
  const openWin = (c: Cat): void => {
    const entry = CATS.find((x) => x.id === c);
    if (entry?.to !== undefined) {
      navigate(entry.to);
      return;
    }
    const next = new URLSearchParams(params);
    next.set('cat', c);
    setParams(next, { replace: true });
    setWin(c as Win);
  };

  const [win, setWin] = useState<Win>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchDesc, setSearchDesc] = useState('');
  const [queueInfo, setQueueInfo] = useState<{ position?: number; poolSize?: number; window?: number } | null>(null);

  // Static, real, empty board. It becomes a game only after match/bot start.
  const [lobbyBoard] = useState(() => createGame({ size: 9, wallsPerPlayer: 10 }));

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await api.mmStatus();
        if (!cancelled && res.status === 'matched') {
          setSearching(false);
          playSound('match');
          toast('good', 'Match found — good luck!');
          navigate(`/game/${res.gameId}`);
        } else if (!cancelled && res.status === 'queued') {
          setQueueInfo({ position: res.position, poolSize: res.poolSize, window: res.window });
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [searching, navigate]);

  /** Matchmaking entry used by the Online window. */
  async function startSearch(tc: Tc, mode: 'ranked' | 'casual'): Promise<void> {
    setSearchError(null);
    let me = user;
    if (me === null) {
      const ok = await loginAsGuest();
      if (!ok) {
        setAuthOpen(true);
        return;
      }
      me = useSession.getState().user;
    }
    if ((me?.guest === true) && mode === 'ranked') {
      setAuthOpen(true);
      return;
    }
    setSearching(true);
    setQueueInfo(null);
    setSearchDesc(`${timeControlName(tc)} · ${mode}`);
    try {
      const region = clientRegion();
      const res = await api.mmJoin({
        mode,
        timeControl: tc,
        ...(region !== undefined ? { region } : {}),
      });
      if (res.status === 'matched') {
        setSearching(false);
        playSound('match');
        toast('good', 'Match found — good luck!');
        navigate(`/game/${res.gameId}`);
      }
    } catch (err) {
      setSearching(false);
      setSearchError(err instanceof Error ? err.message : 'Matchmaking failed');
    }
  }

  async function cancelSearch(): Promise<void> {
    try {
      await api.mmCancel();
    } finally {
      setSearching(false);
    }
  }

  /** Account-only categories bounce guests to the login window. */
  function needsAccount(): boolean {
    return user === null || user.guest === true;
  }

  const isGuest = user === null || user.guest === true;
  const [myRatings, setMyRatings] = useState<{ mode: string; rating: number }[] | null>(null);

  useEffect(() => {
    if (user === null || user.guest === true) {
      setMyRatings(null);
      return;
    }
    let cancelled = false;
    api.profile(user.username)
      .then((p) => {
        if (cancelled) return;
        setMyRatings(p.ratings.filter((r) => ['bullet', 'blitz', 'rapid'].includes(r.mode)).map((r) => ({ mode: r.mode, rating: r.rating })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="play-lobby">
      <div className="play-board-col">
        <div className="play-player-row">
          <Avatar name="Opponent" size={30} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800 }}>Opponent</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>found on match</div>
          </div>
        </div>
        <div className="play-board-frame">
          <GameBoard state={lobbyBoard} humanSeats={[]} interactive={false} onMove={() => undefined} onWall={() => undefined} coords />
        </div>
        <div className="play-player-row">
          <Avatar name={user?.username ?? 'You'} size={30} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.username ?? 'You'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {user === null ? 'playing as guest' : user.guest ? 'guest — register to keep a rating' : 'welcome back'}
            </div>
          </div>
        </div>
        <p className="play-caption">Win chance appears here once your game starts — never before.</p>
      </div>

      <div className="play-chooser">
        <Card>
          <h2 className="font-display" style={{ margin: '0 0 4px', fontSize: 17 }}>Choose your game</h2>
          {myRatings !== null && myRatings.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {myRatings.map((r) => (
                <span key={r.mode} style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>
                  {r.mode} <strong className="font-mono" style={{ color: 'var(--ink)', fontSize: 13 }}>{r.rating}</strong>
                </span>
              ))}
            </div>
          )}
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
            {isGuest ? 'Guests play bots and casual matchmaking. Ranked, friends and party need an account.' : 'Pick a table — the board stays right here.'}
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {CATS.map((c) => {
              const locked = c.needsAccount && needsAccount();
              return (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={cat === c.id}
                  className={`play-cat${cat === c.id ? ' is-active' : ''}`}
                  onClick={() => {
                    if (locked) {
                      setAuthOpen(true);
                      return;
                    }
                    openWin(c.id);
                  }}
                  title={locked ? 'Needs an account' : c.blurb}
                  style={{ display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left' }}
                >
                  <span style={{ color: 'var(--primary)' }}><Icon name={c.icon} size={26} /></span>
                  <span style={{ flex: 1 }}>
                    <span className="play-cat-label" style={{ display: 'block' }}>{c.label}</span>
                    <span className="play-cat-blurb">{c.blurb}{locked ? ' · login' : ''}</span>
                  </span>
                  {locked && <span style={{ color: 'var(--muted)' }} title="Needs an account"><Icon name="lock" size={16} /></span>}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 13 }}>
            <Link to="/profile/me" style={{ color: 'var(--muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="archive" size={15} /> Archive</Link>
            <Link to="/leaderboard" style={{ color: 'var(--muted)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="chart" size={15} /> Leaderboard</Link>
          </div>
        </Card>
        <Card>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>How it works</h3>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--muted)', display: 'grid', gap: 4 }}>
            <li>Bots run the same engine as rated games — the top tiers read your replies.</li>
            <li>Online matchmaking pairs Bullet, Blitz and Rapid on 15×15.</li>
            <li>Friend links are unique per game — first to join plays.</li>
          </ul>
        </Card>
        <Card>
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Quick bots</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {['rookie', 'architect', 'apex'].map((id) => {
              const b = BOTS.find((x) => x.id === id);
              if (b === undefined) return null;
              return (
                <div key={id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Avatar name={b.name} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 13 }}>{b.name}</div>
                    <div className="font-mono" style={{ fontSize: 12, color: 'var(--muted)' }}>★ {b.rating}</div>
                  </div>
                  <Link to={`/play/bot?bot=${b.id}`}>
                    <Button size="sm">Play</Button>
                  </Link>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {win === 'bots' && (
        <BotsWindow
          onClose={() => setWin(null)}
        />
      )}
      {win === 'online' && (
        <OnlineWindow
          isGuest={isGuest}
          searchError={searchError}
          onPlay={(tc, mode) => void startSearch(tc, mode)}
          onNeedAccount={() => { setWin(null); setAuthOpen(true); }}
          onOpen={(c) => setWin(c)}
          onClose={() => setWin(null)}
        />
      )}
      {win === 'friend' && (
        needsAccount()
          ? <AuthModal next="/play" onClose={() => setWin(null)} />
          : <FriendWindow onClose={() => setWin(null)} />
      )}
      {win === 'party' && (
        needsAccount()
          ? <AuthModal next="/play" onClose={() => setWin(null)} />
          : <PartyWindow onClose={() => setWin(null)} />
      )}

      {searching && (
        <Modal title="Finding opponent…" onClose={() => void cancelSearch()}>
          <p style={{ color: 'var(--muted)' }}>
            {searchDesc} · widening… <span className="nexus-pulse">●</span>
          </p>
          {queueInfo !== null && (queueInfo.poolSize !== undefined || queueInfo.window !== undefined) && (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              {queueInfo.poolSize !== undefined && <>#{queueInfo.position ?? 1} of {queueInfo.poolSize} waiting</>}
              {queueInfo.poolSize !== undefined && queueInfo.window !== undefined && ' · '}
              {queueInfo.window !== undefined && <>rating range ±{queueInfo.window}</>}
            </p>
          )}
          <Button variant="ghost" onClick={() => void cancelSearch()}>Cancel</Button>
        </Modal>
      )}
      {authOpen && <AuthModal next="/play" onClose={() => setAuthOpen(false)} />}
      <style>{PlayStyles}</style>
    </div>
  );
}

function BotsWindow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [botId, setBotId] = useState('architect');
  const [size, setSize] = useState<'9' | '15'>('9');
  const [clock, setClock] = useState<BotClock>('none');
  const bot = BOTS.find((b) => b.id === botId) ?? BOTS[0];
  const tiers = [1, 2, 3, 4, 5];

  function play(): void {
    const { clock: c, inc } = clockToParts(clock);
    const walls = size === '9' ? 10 : 20;
    const q = new URLSearchParams({ bot: botId, size, walls: String(walls) });
    if (c > 0) {
      q.set('clock', String(c));
      q.set('inc', String(inc));
    }
    navigate(`/play/bot?${q.toString()}`);
    onClose();
  }

  return (
    <Modal title="Play a bot" onClose={onClose}>
      <div className="play-form-row">
        <span className="play-key">Opponent</span>
        <select value={botId} onChange={(e) => setBotId(e.target.value)} className="play-select" aria-label="bot">
          {tiers.map((t) => (
            <optgroup key={t} label={`Tier ${t}`}>
              {BOTS.filter((b) => b.difficulty === t).map((b) => (
                <option key={b.id} value={b.id}>{b.name} · ★ {b.rating}{b.experimental === true ? ' (experimental)' : ''}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      {bot !== undefined && (
        <div className="play-bot-card">
          <Avatar name={bot.name} size={38} />
          <div style={{ flex: 1 }}>
            <strong className="font-display">{bot.name}</strong>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{bot.style} — {bot.description}</div>
          </div>
          <DivisionBadge rating={bot.rating} />
        </div>
      )}
      <div className="play-form-row">
        <span className="play-key">Board</span>
        <Segmented options={['9', '15'] as unknown as string[]} active={size} onChange={(t) => setSize(t as '9' | '15')} ariaLabel="board size" />
      </div>
      <div className="play-form-row">
        <span className="play-key">Clock</span>
        <Segmented options={BOT_CLOCKS as unknown as string[]} active={clock} onChange={(t) => setClock(t as BotClock)} ariaLabel="clock" />
      </div>
      <Button size="lg" onClick={play} style={{ width: '100%' }}>Play {bot?.name ?? 'bot'}</Button>
      <p className="play-note">Offline · unrated · same engine rules. Top tiers think a reply ahead — bring patience.</p>
    </Modal>
  );
}

function OnlineWindow({ isGuest, searchError, onPlay, onNeedAccount, onOpen, onClose }: {
  isGuest: boolean;
  searchError: string | null;
  onPlay: (tc: Tc, mode: 'ranked' | 'casual') => void;
  onNeedAccount: () => void;
  onOpen: (c: 'friend' | 'party') => void;
  onClose: () => void;
}) {
  const [tc, setTc] = useState<Tc>('3+1');
  const [ranked, setRanked] = useState(true);
  const [variant, setVariant] = useState<'classic' | 'standard'>('standard');
  const [stats, setStats] = useState<{ users: number; gamesToday: number } | null>(null);

  useEffect(() => {
    let live = true;
    api.publicStats().then((s) => { if (live) setStats(s); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const mode = ranked && !isGuest ? 'ranked' : 'casual';
  const groupOf = (t: Tc): string =>
    ['1+0', '1+1', '2+1'].includes(t) ? 'Bullet'
    : ['3+0', '3+1', '3+2'].includes(t) ? 'Blitz'
    : ['5+0', '5+1'].includes(t) ? 'Rapid' : 'Classic';

  function pickVariant(v: 'classic' | 'standard'): void {
    setVariant(v);
    if (v === 'classic') {
      setRanked(false);
    } else if (!isGuest) {
      setRanked(true);
    }
  }

  return (
    <Modal title="Play online" onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <button className="play-tab is-active">New game</button>
        <Link to="/profile/me" className="play-tab" style={{ textAlign: 'center', textDecoration: 'none', lineHeight: '30px' }}>Games</Link>
        <Link to="/leaderboard" className="play-tab" style={{ textAlign: 'center', textDecoration: 'none', lineHeight: '30px' }}>Players</Link>
      </div>
      <div className="play-form-row">
        <span className="play-key" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="bolt" size={16} /> {tc} ({groupOf(tc)})</span>
      </div>
      <p className="play-note" style={{ textAlign: 'left', marginTop: 0 }}>Variant</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {(['classic', 'standard'] as const).map((v) => (
          <button
            key={v}
            onClick={() => {
              if (v === 'standard' && isGuest) {
                onNeedAccount();
                return;
              }
              pickVariant(v);
            }}
            style={{
              flex: 1, borderRadius: 10, padding: '8px 0', fontWeight: 800, fontSize: 13,
              border: variant === v ? '2px solid var(--good)' : '1px solid var(--line)',
              background: variant === v ? 'var(--good-soft)' : 'var(--surface-2)', color: 'var(--ink)', cursor: 'pointer',
            }}
          >
            {v === 'classic' ? 'Classic 9×9' : 'Standard 15×15'}
          </button>
        ))}
      </div>
      <div className="play-form-row" style={{ justifyContent: 'space-between' }}>
        <span className="play-key">Rated</span>
        <button
          role="switch"
          aria-checked={ranked && !isGuest}
          aria-label="rated"
          onClick={() => {
            if (isGuest) {
              onNeedAccount();
              return;
            }
            setRanked((r) => !r);
          }}
          style={{
            width: 52, height: 30, borderRadius: 999, border: '1px solid var(--line)',
            background: ranked && !isGuest ? 'var(--good)' : 'var(--surface-2)', position: 'relative', flexShrink: 0,
          }}
        >
          <span aria-hidden style={{
            position: 'absolute', top: 3, left: ranked && !isGuest ? 24 : 4, width: 22, height: 22,
            borderRadius: '50%', background: '#fff', transition: 'left var(--dur-fast) ease',
          }} />
        </button>
      </div>
      {isGuest && (
        <p className="play-note" style={{ textAlign: 'left' }}>
          Guests play casual — <button className="play-link" onClick={onNeedAccount}>register</button> for rated.
        </p>
      )}
      {(['Bullet', 'Blitz', 'Rapid', 'Classic'] as const).map((g) => (
        <div key={g} style={{ marginBottom: 8 }}>
          <div className="play-key" style={{ marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Icon name={g === 'Bullet' ? 'rocket' : g === 'Blitz' ? 'bolt' : g === 'Rapid' ? 'clock' : 'shield'} size={15} /> {g}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {TCS.filter((t) => groupOf(t) === g).map((t) => (
              <button
                key={t}
                onClick={() => setTc(t)}
                style={{
                  flex: 1, borderRadius: 10, padding: '8px 0', fontWeight: 800, fontSize: 13,
                  border: tc === t ? '2px solid var(--good)' : '1px solid var(--line)',
                  background: tc === t ? 'var(--good-soft)' : 'var(--surface-2)', color: 'var(--ink)', cursor: 'pointer',
                }}
              >
                {t.replace('+0', ' min').replace('+', ' + ')}
              </button>
            ))}
          </div>
        </div>
      ))}
      {searchError !== null && <p role="alert" className="play-error">{searchError}</p>}
      <Button
        size="lg"
        style={{ width: '100%', background: 'var(--good)', borderColor: 'var(--good)', marginTop: 4 }}
        onClick={() => {
          if (ranked && isGuest) {
            onNeedAccount();
            return;
          }
          onPlay(tc, mode);
        }}
      >
        Play
      </Button>
      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
        <button className="play-cat" onClick={() => onOpen('friend')} style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left' }}>
          <span style={{ color: 'var(--primary)' }}><Icon name="friend" size={24} /></span>
          <span><strong>Play a friend</strong><br /><span className="play-cat-blurb">Private link game</span></span>
        </button>
        <button className="play-cat" onClick={() => onOpen('party')} style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left' }}>
          <span style={{ color: 'var(--primary)' }}><Icon name="dice" size={24} /></span>
          <span><strong>Party & variants</strong><br /><span className="play-cat-blurb">2–6 seats, scenarios</span></span>
        </button>
      </div>
      {stats !== null && stats.users > 0 && (
        <p className="play-note">{stats.users.toLocaleString()} players · {stats.gamesToday.toLocaleString()} games today</p>
      )}
    </Modal>
  );
}

function FriendWindow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [size, setSize] = useState<'9' | '15'>('9');
  const [tc, setTc] = useState<Tc>('10+0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGame({
        boardSize: size === '9' ? 9 : 15,
        wallsPerPlayer: size === '9' ? 10 : 20,
        timeControl: tc,
        visibility: 'private',
      });
      setLink(`${window.location.origin}/game/${g.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Invite a friend" onClose={onClose}>
      {link === null ? (
        <>
          <div className="play-form-row">
            <span className="play-key">Board</span>
            <Segmented options={['9', '15'] as unknown as string[]} active={size} onChange={(t) => setSize(t as '9' | '15')} ariaLabel="board size" />
          </div>
          <div className="play-form-row">
            <span className="play-key">Clock</span>
            <Segmented options={TCS as unknown as string[]} active={tc} onChange={(t) => setTc(t as Tc)} ariaLabel="time control" />
          </div>
          {error !== null && <p role="alert" className="play-error">{error}</p>}
          <Button size="lg" onClick={() => void create()} disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Creating…' : 'Create invite link'}
          </Button>
          <p className="play-note">Private casual game · unique key per link · first to join plays.</p>
        </>
      ) : (
        <>
          <p style={{ fontSize: 14, marginTop: 0 }}>Share this link — your friend presses <strong>Join</strong> on the board screen.</p>
          <div className="play-link-row">
            <code className="play-link-code">{link}</code>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="ghost"
              onClick={() => {
                void copyText(link).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              style={{ flex: 1 }}
            >
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
            <Button onClick={() => navigate(link.replace(window.location.origin, ''))} style={{ flex: 1 }}>Open board</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function PartyWindow({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'online' | 'local'>('online');
  const [scenarioId, setScenarioId] = useState('classic');
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!;
  const localScenarios = SCENARIOS.filter((s) => !s.onlineOnly);
  const seatOptions = scenario.seats.length > 0 ? scenario.seats : [2, 3, 4, 5, 6];
  return (
    <Modal title="Party games" onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['online', 'local'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`play-tab${tab === t ? ' is-active' : ''}`}>{t === 'online' ? 'Online' : 'This device'}</button>
        ))}
      </div>
      {tab === 'online' ? (
        <>
          <Badge tone="info">2–6 seats · online casual</Badge>
          <div style={{ marginTop: 8 }}>
            <PartyOnlineActions />
          </div>
        </>
      ) : (
        <>
          <div className="play-form-row">
            <span className="play-key">Scenario</span>
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} className="play-select" aria-label="scenario">
              {localScenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <p className="play-note" style={{ textAlign: 'left', marginTop: 0 }}>{scenario.blurb}</p>
          <h3 className="play-sub">Seats — you + bots on this device</h3>
          <div className="play-grid2">
            {seatOptions.map((n) => (
              <Link key={n} to={`/play/multi?players=${n}&humans=1&scenario=${scenario.id}`} onClick={onClose}>
                <Button variant="ghost" style={{ width: '100%' }}>{n === 6 && scenario.id === 'classic' ? '1v5 chaos' : `${n} players`}</Button>
              </Link>
            ))}
          </div>
          <h3 className="play-sub">Teams · pass &amp; play</h3>
          <div className="play-grid2">
            <Link to="/play/multi?players=4&humans=4&scenario=teams" onClick={onClose}>
              <Button variant="ghost" style={{ width: '100%' }}>2v2 teams</Button>
            </Link>
            <Link to="/play/multi?players=2&humans=2&scenario=classic" onClick={onClose}>
              <Button variant="ghost" style={{ width: '100%' }}>1v1 pass &amp; play</Button>
            </Link>
          </div>
          <p className="play-note">Fog of war needs separate screens — it lives on online tables. Bigger than 3v3 does not fit a 6-seat table.</p>
        </>
      )}
    </Modal>
  );
}

const PlayStyles = `
.play-lobby {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 16px;
  align-items: start;
  max-width: 1080px;
  margin: 0 auto;
  animation: play-lobby-in .45s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes play-lobby-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
.play-board-col { min-width: 0; display: grid; gap: 10px; }
.play-board-frame {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-lg); padding: 10px;
  box-shadow: var(--shadow-card);
  width: 100%; max-width: 620px; margin: 0 auto;
}
.play-player-row {
  display: flex; gap: 10px; align-items: center;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius-md); padding: 8px 12px;
  max-width: 620px; margin: 0 auto; width: 100%;
}
.play-caption { margin: 0; text-align: center; font-size: 12px; color: var(--muted); }
.play-chooser { display: grid; gap: 12px; min-width: 0; align-content: start; }
.play-cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.play-cat {
  text-align: left; padding: 10px 12px; border-radius: var(--radius-md);
  border: 1px solid var(--line); background: var(--surface-2); color: var(--ink);
  display: grid; gap: 2px; cursor: pointer;
  transition: transform .16s ease, box-shadow .2s ease, border-color .2s ease;
}
.play-cat:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
.play-cat.is-active { border-color: var(--primary); background: var(--primary-soft); }
.play-cat-label { font-weight: 800; font-size: 14px; }
.play-cat-blurb { font-size: 11px; color: var(--muted); }
.play-form-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; max-width: 100%; overflow-x: auto; padding-bottom: 2px; }
.play-key { font-size: 12px; font-weight: 800; color: var(--muted); flex: 0 0 auto; }
.play-select {
  flex: 1; min-width: 160px; padding: 8px 10px; border-radius: var(--radius-md);
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); font-size: 14px;
}
.play-bot-card { display: flex; gap: 10px; align-items: center; padding: 10px 0; margin-bottom: 10px; }
.play-note { color: var(--muted); font-size: 12px; margin: 8px 0 0; text-align: center; }
.play-error { color: var(--bad); font-size: 13px; margin: 0 0 8px; }
.play-link { background: none; border: none; padding: 0; color: var(--primary); font-weight: 800; cursor: pointer; font-size: inherit; }
.play-link-row { background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 10px 12px; margin-bottom: 10px; overflow-x: auto; }
.play-link-code { font-size: 13px; word-break: break-all; }
.play-tab {
  flex: 1; border-radius: 10px; padding: 7px 0; font-weight: 800; font-size: 13px;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; text-transform: capitalize;
}
.play-tab.is-active { border: 2px solid var(--primary); background: var(--primary-soft); }
.play-sub { font-size: 13px; margin: 14px 0 8px; color: var(--muted); }
.play-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 900px) {
  .play-lobby { grid-template-columns: minmax(0, 1fr); }
  .play-chooser { order: 2; }
}
@media (prefers-reduced-motion: reduce) {
  .play-lobby { animation: none !important; }
}
`;
