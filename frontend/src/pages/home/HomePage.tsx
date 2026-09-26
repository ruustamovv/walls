/**
 * Product landing: hero, live-feel board preview, modes, ladder, FAQ.
 */
import { Link } from 'react-router-dom';
import { createGame } from '../../../../engine/typescript/index.js';
import GameBoard from '../../components/game/GameBoard.js';
import { Button, Card } from '../../components/ui/primitives.js';
import { BRAND } from '../../lib/brand.js';

const preview = (() => {
  const s = createGame({ size: 9, wallsPerPlayer: 10 });
  return s;
})();

export default function HomePage() {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,420px)', gap: 24, alignItems: 'center' }} className="nexus-hero">
        <div>
          <p style={{ color: 'var(--primary)', fontWeight: 800, letterSpacing: '.06em', fontSize: 13, margin: 0 }}>ORIGINAL WALL-AND-PAWN STRATEGY</p>
          <h1 style={{ fontSize: 46, lineHeight: 1.05, margin: '8px 0 12px' }}>{BRAND.TAGLINE}</h1>
          <p style={{ color: 'var(--muted)', fontSize: 17, maxWidth: 520, margin: '0 0 20px' }}>
            {BRAND.APP_DESCRIPTION} Easy to learn in a minute, deep enough to study for months.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/play"><Button>Play now</Button></Link>
            <Link to="/play/bot?bot=rookie"><Button variant="ghost">Play demo — no account</Button></Link>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {['1+1', '3+1', '5+1'].map((tc) => (
              <Link key={tc} to="/play" style={{ border: '1px solid var(--line)', borderRadius: 999, padding: '6px 14px', background: '#fff', fontWeight: 700 }}>{tc}</Link>
            ))}
          </div>
        </div>
        <div style={{ maxWidth: 420 }}>
          <GameBoard
            state={preview}
            humanSeats={[]}
            interactive={false}
            onMove={() => undefined}
            onWall={() => undefined}
          />
          <p style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>Race to the far side. Move — or spend a wall to bend their route.</p>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {[
          ['Learn in 1 minute', 'One rule: move, or wall. The rest is out-thinking a human.'],
          ['Ranked 15×15', 'The Standard arena with server clocks and Glicko ratings.'],
          ['Ten bots', 'From Rookie to Grandmaster — all running the real engine.'],
          ['Review every game', 'Replays, timelines and ratings on every profile.'],
        ].map(([t, d]) => (
          <Card key={t}>
            <strong>{t}</strong>
            <p style={{ color: 'var(--muted)', margin: '6px 0 0', fontSize: 14 }}>{d}</p>
          </Card>
        ))}
      </section>

      <Card>
        <h2 style={{ margin: '0 0 8px' }}>How a turn works</h2>
        <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, color: 'var(--muted)' }}>
          <li><strong style={{ color: 'var(--ink)' }}>Move</strong> your pawn one step toward the far side (jump over adjacent pawns).</li>
          <li>Or <strong style={{ color: 'var(--ink)' }}>place a wall</strong> to force a detour — a path must always remain.</li>
          <li>Reach the opposite edge first. The server validates every action and owns the clock.</li>
        </ol>
        <div style={{ marginTop: 14 }}>
          <Link to="/play"><Button variant="ghost">Enter the arena</Button></Link>
        </div>
      </Card>
      <style>{`@media (max-width: 900px) { .nexus-hero { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
