/**
 * Quoridor Play: categories without extra words.
 * 1v1 ranked/casual + bots + party 2-4P + local.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BOTS } from '../../../../engine/typescript/index.js';
import { api } from '../../lib/api.js';
import { timeControlName } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';
import { playSound } from '../../lib/sound.js';
import { Avatar, Badge, Button, Card, DivisionBadge, Modal, Segmented } from '../../components/ui/primitives.js';
import { PartyOnlineActions } from './MultiGamePage.js';

const TCS = ['1+0', '1+1', '3+0', '3+1', '5+0', '5+1'] as const;
type Cat = '1v1' | 'bots' | 'party' | 'local';

export default function PlayPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [cat, setCat] = useState<Cat>('1v1');
  const [tc, setTc] = useState<(typeof TCS)[number]>('3+1');
  const [mode, setMode] = useState<'ranked' | 'casual'>('ranked');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await api.mmStatus();
        if (!cancelled && res.status === 'matched') {
          setSearching(false);
          playSound('match');
          navigate(`/game/${res.gameId}`);
        }
      } catch { /* keep polling */ }
    }, 1500);
    return () => { cancelled = true; clearInterval(id); };
  }, [searching, navigate]);

  async function quickPlay() {
    if (user === null) { navigate('/login?next=/play'); return; }
    if (user.guest && mode === 'ranked') {
      setSearchError('Ranked needs an account — play casual now or register to keep a rating.');
      return;
    }
    setSearchError(null);
    setSearching(true);
    try {
      const res = await api.mmJoin({ mode, timeControl: tc });
      if (res.status === 'matched') { setSearching(false); playSound('match'); navigate(`/game/${res.gameId}`); }
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
        <Segmented options={['1v1', 'bots', 'party', 'local'] as const} active={cat} onChange={setCat} ariaLabel="game categories" />
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
            <Badge tone="info">2–4 seats · bots + humans + online</Badge>
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
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>Fog/Chaos next. 5–6 seats need 15×15+ custom.</p>
        </Card>
      )}

      {cat === 'local' && (
        <Card>
          <h2 className="font-display" style={{ margin: '0 0 8px' }}>Local</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link to="/play/local?size=9&walls=10"><Button variant="ghost">9×9</Button></Link>
            <Link to="/play/local?size=15&walls=20"><Button variant="ghost">15×15</Button></Link>
            <Link to="/play/local?size=17&walls=30"><Button variant="ghost">17×17</Button></Link>
          </div>
        </Card>
      )}

      {searching && (
        <Modal title="Finding opponent…" onClose={cancelSearch}>
          <p style={{ color: 'var(--muted)' }}>{timeControlName(tc)} · {mode} · widening… <span style={{ animation: 'nexus-pulse 1.2s infinite' }}>●</span></p>
          <Button variant="ghost" onClick={cancelSearch}>Cancel</Button>
        </Modal>
      )}
    </div>
  );
}
