/**
 * Play lobby: quick match (real matchmaking), vs bot, local 2P, custom.
 * Every button performs a real action — no decorative controls.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BOTS } from '../../../../engine/typescript/index.js';
import { api } from '../../lib/api.js';
import { timeControlName } from '../../lib/format.js';
import { useSession } from '../../stores/session.js';
import { playSound } from '../../lib/sound.js';
import { Avatar, Badge, Button, Card, DivisionBadge, Modal, Tabs } from '../../components/ui/primitives.js';

const TIME_CONTROLS = ['1+0', '1+1', '3+0', '3+1', '5+0', '5+1'] as const;
const MODES = ['ranked', 'casual'] as const;

export default function PlayPage() {
  const navigate = useNavigate();
  const { user } = useSession();
  const [tc, setTc] = useState<(typeof TIME_CONTROLS)[number]>('3+1');
  const [mode, setMode] = useState<(typeof MODES)[number]>('ranked');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Matchmaking poll while the searching modal is open.
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
      } catch {
        // Keep polling; the modal offers cancel.
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [searching, navigate]);

  async function quickPlay() {
    if (user === null) {
      navigate('/login?next=/play');
      return;
    }
    setSearchError(null);
    setSearching(true);
    try {
      const res = await api.mmJoin({ mode, timeControl: tc });
      if (res.status === 'matched') {
        setSearching(false);
        playSound('match');
        navigate(`/game/${res.gameId}`);
      }
      // else: modal stays open, poll picks up the match.
    } catch (err) {
      setSearching(false);
      setSearchError(err instanceof Error ? err.message : 'Matchmaking failed');
    }
  }

  async function cancelSearch() {
    try {
      await api.mmCancel();
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Play</h1>

      <Card>
        <h2 className="font-display" style={{ margin: '0 0 4px' }}>Quick match</h2>
        <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 14 }}>
          {user === null ? 'Log in to play rated online games.' : `Playing as ${user.username}. Ranked uses the 15×15 Standard arena.`}
        </p>
        <div style={{ marginBottom: 12 }}>
          <Tabs tabs={TIME_CONTROLS.map(timeControlName)} active={timeControlName(tc)} onChange={(label) => {
            const found = TIME_CONTROLS.find((t) => timeControlName(t) === label);
            if (found !== undefined) setTc(found);
          }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Tabs tabs={MODES} active={mode} onChange={setMode} />
        </div>
        {searchError !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{searchError}</p>}
        <Button onClick={quickPlay} size="lg">Play {timeControlName(tc)}</Button>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h2 className="font-display" style={{ margin: 0 }}>Play a bot</h2>
          <Badge tone="info">no account needed</Badge>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 10 }}>
          {BOTS.map((b) => (
            <button
              key={b.id}
              onClick={() => navigate(`/play/bot?bot=${b.id}`)}
              style={{ textAlign: 'left', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12 }}
            >
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

      <Card>
        <h2 className="font-display" style={{ margin: '0 0 8px' }}>Local & custom</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/play/local?size=9&walls=10"><Button variant="ghost">Classic 9×9 · 2P</Button></Link>
          <Link to="/play/local?size=15&walls=20"><Button variant="ghost">Standard 15×15 · 2P</Button></Link>
          <Link to="/play/local?size=17&walls=30"><Button variant="ghost">Siege 17×17 · 2P</Button></Link>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <h2 className="font-display" style={{ margin: 0 }}>Party table</h2>
          <Badge tone="info">2–4 seats · humans + bots</Badge>
        </div>
        <p style={{ color: 'var(--muted)', margin: '0 0 12px', fontSize: 14 }}>
          Four pawns, four goal edges, five walls each on 9×9. Turns rotate — first to its glowing edge wins.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/play/multi?players=4&humans=1&size=9&walls=5"><Button variant="ghost">4P vs 3 bots</Button></Link>
          <Link to="/play/multi?players=4&humans=4&size=9&walls=5"><Button variant="ghost">4P local</Button></Link>
          <Link to="/play/multi?players=3&humans=1&size=13&walls=10"><Button variant="ghost">3P vs 2 bots</Button></Link>
        </div>
      </Card>

      {searching && (
        <Modal title="Searching for opponent…" onClose={cancelSearch}>
          <p style={{ color: 'var(--muted)' }}>
            {timeControlName(tc)} · {mode} · widening rating range…
            <span style={{ animation: 'nexus-pulse 1.2s ease-in-out infinite' }}> ●</span>
          </p>
          <Button variant="ghost" onClick={cancelSearch}>Cancel</Button>
        </Modal>
      )}
    </div>
  );
}
