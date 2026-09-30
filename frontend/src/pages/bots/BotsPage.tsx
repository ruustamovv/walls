/**
 * Bot roster: every personality is playable right now via the engine.
 * Ratings are internal difficulty anchors pending calibration.
 */
import { Link } from 'react-router-dom';
import { BOTS } from '../../../../engine/typescript/index.js';
import { Avatar, Badge, Button, Card, DivisionBadge } from '../../components/ui/primitives.js';

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
        <Card>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <Avatar name="Nemesis" size={40} />
            <div>
              <h3 className="font-display" style={{ margin: 0 }}>Nemesis</h3>
              <DivisionBadge rating={1700} />
            </div>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 12px', minHeight: 60 }}>
            Built from your own mistakes. Requires an account with rated games.
          </p>
          <Link to="/nemesis" style={{ display: 'inline-block', textDecoration: 'none' }}>
            <Button size="sm">Meet your Nemesis</Button>
          </Link>
        </Card>
        {BOTS.map((b) => (
          <Card key={b.id}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <Avatar name={b.name} size={40} />
              <div>
                <h3 className="font-display" style={{ margin: 0 }}>{b.name}</h3>
                <DivisionBadge rating={b.rating} />
              </div>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {b.experimental === true && <Badge tone="warn">Experimental</Badge>}
                <Badge tone={b.difficulty >= 4 ? 'bad' : b.difficulty >= 2 ? 'warn' : 'good'}>Tier {b.difficulty}</Badge>
              </span>
            </div>
            <p style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13, margin: '6px 0' }}>{b.style}</p>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 12px', minHeight: 60 }}>{b.description}</p>
            <Link to={`/play/bot?bot=${b.id}`} style={{ display: 'inline-block', textDecoration: 'none' }}>
              <Button size="sm">Play {b.name}</Button>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
