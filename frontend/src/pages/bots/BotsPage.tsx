/**
 * Bot roster: every personality is playable right now via the engine.
 * Ratings are internal difficulty anchors pending calibration.
 */
import { Link } from 'react-router-dom';
import { BOTS } from '../../../../engine/typescript/index.js';
import { Badge, Card } from '../../components/ui/primitives.js';

export default function BotsPage() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h1 style={{ margin: '0 0 4px' }}>Bots</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>
          Ten sparring partners, all running the platform strategy engine — no fake moves.
          Ratings are difficulty guides, not proven skill ratings.
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
        {BOTS.map((b) => (
          <Card key={b.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{b.name}</h3>
              <Badge tone={b.difficulty >= 4 ? 'bad' : b.difficulty >= 2 ? 'warn' : 'good'}>★ {b.rating}</Badge>
            </div>
            <p style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13, margin: '6px 0' }}>{b.style}</p>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 12px', minHeight: 60 }}>{b.description}</p>
            <Link
              to={`/play/bot?bot=${b.id}`}
              style={{ display: 'inline-block', background: 'var(--primary)', color: '#fff', padding: '8px 16px', borderRadius: 10, fontWeight: 700 }}
            >
              Play {b.name}
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
