/**
 * Landing: the arena calls. Light editorial surface, dark game-theater
 * preview, live platform proof, three-step rules, bot ladder, final CTA.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createGame } from '../../../../engine/typescript/index.js';
import { BOTS } from '../../../../engine/typescript/index.js';
import GameBoard from '../../components/game/GameBoard.js';
import { Badge, Button, Card, Logo, Spinner, Stat } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { BRAND } from '../../lib/brand.js';
import { useSession } from '../../stores/session.js';

const preview = createGame({ size: 9, wallsPerPlayer: 10 });

export default function HomePage() {
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const { user } = useSession();
  const [mine, setMine] = useState<{ rating: number; streak: number; streakWon: boolean; views: number } | null>(null);
  useEffect(() => {
    let live = true;
    api.liveGames().then((r) => { if (live) setLiveCount(r.games.length); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (user === null) {
      setMine(null);
      return;
    }
    let live = true;
    api.profile(user.username).then((p) => {
      if (!live) return;
      const top = p.ratings.length > 0 ? Math.max(...p.ratings.map((r) => r.rating)) : 0;
      setMine({ rating: top, streak: p.stats?.streak ?? 0, streakWon: p.stats?.streakWon ?? false, views: p.views ?? 0 });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [user === null]);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      {user !== null && (
        <Card>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong className="font-display">Your arena</strong>
            {mine === null ? <Spinner /> : (
              <>
                <span style={{ fontSize: 14 }}>Top <strong className="font-mono">{mine.rating}</strong></span>
                {mine.streak > 1 && <span style={{ fontSize: 14 }}>{mine.streak} {mine.streakWon ? 'wins' : 'losses'} in a row</span>}
                <span style={{ fontSize: 14, color: 'var(--muted)' }}>{mine.views} profile views</span>
              </>
            )}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <Link to="/puzzles"><Button size="sm" variant="ghost">Daily puzzle</Button></Link>
              <Link to="/training"><Button size="sm" variant="ghost">Train mistakes</Button></Link>
            </span>
          </div>
        </Card>
      )}
      <section
        style={{
          borderRadius: 'var(--radius-lg)', padding: 'clamp(24px, 5vw, 56px)',
          background: 'linear-gradient(135deg, #0b0e14 0%, #131a2e 55%, #1a1440 100%)',
          color: '#eef1f6', position: 'relative', overflow: 'hidden',
        }}
      >
        <div aria-hidden style={{
          position: 'absolute', inset: 0, opacity: 0.5,
          background: 'radial-gradient(600px 300px at 80% 20%, rgba(34,211,238,.18), transparent 60%), radial-gradient(500px 260px at 15% 85%, rgba(245,158,11,.14), transparent 60%)',
        }} />
        <div className="nexus-hero" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,400px)', gap: 32, alignItems: 'center', position: 'relative' }}>
          <div>
            <p style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#9aa4b5', fontWeight: 800, letterSpacing: '.1em', fontSize: 12, margin: 0 }}>
              <Logo size={22} /> ORIGINAL WALL-AND-PAWN ARENA
            </p>
            <h1 className="font-display" style={{ fontSize: 'var(--text-hero)', lineHeight: 1.02, margin: '12px 0' }}>
              {BRAND.TAGLINE}
            </h1>
            <p style={{ color: '#9aa4b5', fontSize: 17, maxWidth: 520, margin: '0 0 24px' }}>
              {BRAND.APP_DESCRIPTION} Server-validated moves, server-owned clocks, Glicko ratings.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link to="/play"><Button size="lg">Enter the arena</Button></Link>
              <Link to="/play/bot?bot=rookie"><Button size="lg" variant="ghost" style={{ background: 'transparent', color: '#eef1f6', borderColor: '#263049' }}>Play demo — no account</Button></Link>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 24, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14, color: '#9aa4b5' }}>
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: liveCount !== null && liveCount > 0 ? '#34d399' : '#5d6678', animation: 'nexus-pulse 1.6s infinite' }} />
                {liveCount === null ? 'checking the arena…' : liveCount === 0 ? 'no live battles right now' : `${liveCount} live battle${liveCount === 1 ? '' : 's'}`}
              </span>
              <span style={{ fontSize: 14, color: '#9aa4b5' }}>{BOTS.length} engine bots · daily puzzle · ranked 15×15</span>
            </div>
          </div>
          <div style={{ maxWidth: 400, width: '100%', margin: '0 auto' }}>
            <div style={{ borderRadius: 18, padding: 14, background: 'rgba(8,11,18,.7)', border: '1px solid #263049', boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}>
              <div data-theme="arena">
                <GameBoard state={preview} humanSeats={[]} interactive={false} onMove={() => undefined} onWall={() => undefined} />
              </div>
            </div>
            <p style={{ color: '#5d6678', fontSize: 13, textAlign: 'center', margin: '10px 0 0' }}>Every turn: move — or bend their route with a wall.</p>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        {[
          ['01 · Race', 'Reach the far edge first. Jumps and diagonal jumps included.'],
          ['02 · Wall', 'Spend walls to force detours — a path must always remain.'],
          ['03 · Rank up', 'Glicko ratings per time control. Review, train, climb.'],
        ].map(([t, d]) => (
          <Card key={t}>
            <strong className="font-display">{t}</strong>
            <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 14 }}>{d}</p>
          </Card>
        ))}
      </section>

      <Card>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
          <h2 className="font-display" style={{ margin: 0 }}>Sparring ladder</h2>
          <Badge tone="info">all running the real engine</Badge>
        </div>
        <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 14 }}>From Rookie to Apex. <Link to="/bots">Meet them all →</Link></p>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {BOTS.slice(0, 6).map((b) => (
            <Link
              key={b.id}
              to={`/play/bot?bot=${b.id}`}
              style={{ minWidth: 150, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 12, textDecoration: 'none' }}
            >
              <div className="font-display" style={{ fontWeight: 700 }}>{b.name}</div>
              <div className="font-mono" style={{ fontSize: 13, color: 'var(--muted)' }}>★ {b.rating}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{b.style}</div>
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 16 }}>
          <Stat label="Board" value="15×15" sub="Standard ranked arena" />
          <Stat label="Controls" value="1+0 – 5+1" sub="server-owned clocks" />
          <Stat label="Ratings" value="Glicko-2" sub="per time control" />
          <Stat label="Daily" value="Puzzle" sub="same for everyone" />
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/play"><Button>Play now</Button></Link>
          <Link to="/watch"><Button variant="ghost">Watch live</Button></Link>
        </div>
      </Card>
      <style>{`@media (max-width: 900px) { .nexus-hero { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
