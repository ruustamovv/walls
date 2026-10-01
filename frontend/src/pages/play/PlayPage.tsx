/**
 * Quoridor Play: categories without extra words.
 * 1v1 ranked/casual + bots + party 2-6P + local.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BOTS } from '../../../../engine/typescript/index.js';
import { api, clientRegion } from '../../lib/api.js';
import { timeControlName } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';
import { playSound } from '../../lib/sound.js';
import { toast } from '../../stores/toasts.js';
import { Avatar, Badge, Button, Card, DivisionBadge, Modal, Segmented } from '../../components/ui/primitives.js';
import { AuthModal } from '../../components/auth/AuthModal.js';
import { PartyOnlineActions } from './MultiGamePage.js';

const TCS = ['1+0', '1+1', '3+0', '3+1', '5+0', '5+1', '10+0', '10+5'] as const;
type Cat = '1v1' | 'bots' | 'party' | 'custom';

export default function PlayPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [cat, setCat] = useState<Cat>('1v1');
  const [tc, setTc] = useState<(typeof TCS)[number]>('3+1');
  const [mode, setMode] = useState<'ranked' | 'casual'>('ranked');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);

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
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => { cancelled = true; clearInterval(id); };
  }, [searching, navigate]);

  async function quickPlay() {
    if (user === null) { setAuthOpen(true); return; }
    if (user.guest && mode === 'ranked') {
      setSearchError('Ranked needs an account — play casual now or register to keep a rating.');
      return;
    }
    setSearchError(null);
    setSearching(true);
    try {
      const region = clientRegion();
      const res = await api.mmJoin({
        mode, timeControl: tc,
        ...(region !== undefined ? { region } : {}),
      });
      if (res.status === 'matched') { setSearching(false); playSound('match'); toast('good', 'Match found — good luck!'); navigate(`/game/${res.gameId}`); }
    } catch (err) {
      setSearching(false);
      setSearchError(err instanceof Error ? err.message : 'Matchmaking failed');
    }
  }
  async function cancelSearch() { try { await api.mmCancel(); } finally { setSearching(false); } }

  return (
    <div style={{ display: 'grid', gap: 16, animation: 'quoridor-lift .3s ease' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="font-display" style={{ margin: 0 }}>Play</h1>
        <Segmented options={['1v1', 'bots', 'party', 'custom'] as const} active={cat} onChange={setCat} ariaLabel="game categories" />
      </div>

      {cat === '1v1' && (
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <h2 className="font-display" style={{ margin: 0 }}>1v1</h2>
            <Badge tone="info">{mode === 'ranked' ? 'rated · 15×15' : 'casual'}</Badge>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Segmented options={TCS as unknown as string[]} active={tc} onChange={(t) => setTc(t as (typeof TCS)[number])} ariaLabel="time control" />
            <Segmented options={['ranked', 'casual'] as const} active={mode} onChange={setMode} ariaLabel="mode" />
          </div>
          {searchError !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{searchError}</p>}
          <Button onClick={quickPlay} size="lg">Play {timeControlName(tc)}</Button>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>
            {user === null
              ? 'Log in for rated, or continue as guest for casual.'
              : user.guest
                ? 'Playing as guest · casual only · register to earn a rating.'
                : `As ${user.username} · bullet 1+ · blitz 3+ · rapid 5+ · ± rating`}
          </p>
        </Card>
      )}

      {cat === 'bots' && (
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <h2 className="font-display" style={{ margin: 0 }}>Bots</h2>
            <Badge tone="info">offline</Badge>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
            {BOTS.map((b) => (
              <button key={b.id} onClick={() => navigate(`/play/bot?bot=${b.id}`)} style={{ textAlign: 'left', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 14, padding: 12, transition: 'transform .15s ease, box-shadow .2s ease' }} onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lift)'; }} onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                  <Avatar name={b.name} size={34} />
                  <strong className="font-display">{b.name}</strong>
                </div>
                <DivisionBadge rating={b.rating} />
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>{b.style}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {cat === 'party' && (
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <h2 className="font-display" style={{ margin: 0 }}>Party</h2>
            <Badge tone="info">2–6 seats · bots + humans + online</Badge>
          </div>
          <h3 className="font-display" style={{ margin: '0 0 8px', fontSize: 14 }}>Online · casual</h3>
          <PartyOnlineActions />
          <h3 className="font-display" style={{ margin: '14px 0 8px', fontSize: 14 }}>Local · bots + humans</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/play/multi?players=2&humans=1&size=9&walls=10"><Button variant="ghost">1v1 vs bot</Button></Link>
            <Link to="/play/multi?players=3&humans=1&size=13&walls=10"><Button variant="ghost">3P vs 2 bots</Button></Link>
            <Link to="/play/multi?players=4&humans=1&size=9&walls=5"><Button variant="ghost">4P vs 3 bots</Button></Link>
            <Link to="/play/multi?players=4&humans=4&size=9&walls=5"><Button variant="ghost">4P local</Button></Link>
            <Link to="/play/multi?players=4&humans=2&size=9&walls=5"><Button variant="ghost">2v2 team</Button></Link>
            <Link to="/play/multi?players=5&humans=1&size=19&walls=8"><Button variant="ghost">5P vs 4 bots</Button></Link>
            <Link to="/play/multi?players=6&humans=1&size=21&walls=8"><Button variant="ghost">6P vs 5 bots</Button></Link>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Fog/Chaos next. 5–6 seats need 15×15+ custom.</p>
        </Card>
      )}

      {cat === 'custom' && (
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <h2 className="font-display" style={{ margin: 0 }}>Custom</h2>
            <Badge tone="info">private · casual · invite link</Badge>
          </div>
          <CustomRoomForm />
          <h3 className="font-display" style={{ margin: '14px 0 8px', fontSize: 14 }}>Local 2P</h3>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/play/local?size=9&walls=10"><Button variant="ghost">9×9</Button></Link>
            <Link to="/play/local?size=15&walls=20"><Button variant="ghost">15×15</Button></Link>
            <Link to="/play/local?size=17&walls=30"><Button variant="ghost">17×17</Button></Link>
          </div>
        </Card>
      )}

      {searching && (
        <Modal title="Finding opponent…" onClose={cancelSearch}>          <p style={{ color: 'var(--muted)' }}>{timeControlName(tc)} · {mode} · widening… <span style={{ animation: 'nexus-pulse 1.2s infinite' }}>●</span></p>
          <Button variant="ghost" onClick={cancelSearch}>Cancel</Button>
        </Modal>
      )}
      {authOpen && <AuthModal next="/play" onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

const CUSTOM_SIZES = [9, 13, 15, 17, 19] as const;
const CUSTOM_WALLS = [0, 5, 10, 20, 30] as const;

function CustomRoomForm() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [size, setSize] = useState<(typeof CUSTOM_SIZES)[number]>(9);
  const [walls, setWalls] = useState<(typeof CUSTOM_WALLS)[number]>(10);
  const [tc, setTc] = useState<(typeof TCS)[number]>('3+0');
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'unlisted' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (user === null) { navigate('/login?next=/play'); return; }
    setBusy(true);
    setError(null);
    try {
      const g = await api.createGame({ boardSize: size, wallsPerPlayer: walls, timeControl: tc, visibility });
      navigate(`/game/${g.id}`);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not create room');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Board</span>
        <Segmented options={CUSTOM_SIZES.map(String) as unknown as string[]} active={String(size)} onChange={(t) => setSize(Number(t) as (typeof CUSTOM_SIZES)[number])} ariaLabel="board size" />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Walls</span>
        <Segmented options={CUSTOM_WALLS.map(String) as unknown as string[]} active={String(walls)} onChange={(t) => setWalls(Number(t) as (typeof CUSTOM_WALLS)[number])} ariaLabel="walls per player" />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Clock</span>
        <Segmented options={TCS as unknown as string[]} active={tc} onChange={(t) => setTc(t as (typeof TCS)[number])} ariaLabel="time control" />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>Who can watch</span>
        <Segmented options={['public', 'friends', 'unlisted', 'private'] as const} active={visibility} onChange={setVisibility} ariaLabel="room visibility" />
      </div>
      {error !== null && <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>{error}</p>}
      <div>
        <Button onClick={create} disabled={busy}>Create private link</Button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
        Share the link on the next screen — first to join plays. Links expire after 24h.
      </p>
    </div>
  );
}
