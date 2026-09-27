/**
 * Premium: honest tier status. No pay-to-win ever — premium buys analysis,
 * coaching quota, cosmetics and convenience. Checkout stays disabled until
 * a payment provider is configured; entitlements come from admins/promos.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Card, Spinner } from '../../components/ui/primitives.js';

const PERKS: { id: string; name: string; body: string }[] = [
  { id: 'AI_REVIEW_ADVANCED', name: 'Advanced review', body: 'Full per-move engine breakdowns on every game.' },
  { id: 'AI_COACH_UNLIMITED', name: 'Coach quota ×10', body: '200 AI explanations a day instead of the free quota.' },
  { id: 'ADVANCED_STATS', name: 'Advanced statistics', body: 'Deeper fingerprints, trends and comparisons.' },
  { id: 'PREMIUM_COSMETICS', name: 'Cosmetics', body: 'Board themes, pawn skins, profile frames (as they land).' },
  { id: 'REPLAY_ANALYTICS', name: 'Replay analytics', body: 'Richer timeline insights on saved games.' },
];

export default function PremiumPage() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.premium>> | null>(null);

  useEffect(() => {
    let live = true;
    api.premium().then((s) => { if (live) setStatus(s); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <h1 className="font-display" style={{ margin: 0 }}>Premium</h1>
        {status !== null && <Badge tone={status.tier === 'premium' ? 'good' : 'neutral'}>{status.tier}</Badge>}
      </div>
      <p style={{ color: 'var(--muted)', margin: 0 }}>
        Competitive integrity is not for sale: premium never buys walls, moves, time or ratings.
      </p>
      {status === null ? <Spinner /> : (
        <>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Your access</h3>
            {status.entitlements.length === 0 ? (
              <p style={{ color: 'var(--muted)', margin: 0 }}>Free tier — core play, ratings, puzzles and reviews included.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>
                {status.entitlements.map((e) => <li key={e}><code>{e}</code></li>)}
              </ul>
            )}
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '10px 0 0' }}>
              Payments: {status.payments}. {status.reason}
            </p>
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
            {PERKS.map((p) => (
              <Card key={p.id}>
                <strong>{p.name}</strong>
                <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0' }}>{p.body}</p>
                {status.entitlements.includes(p.id)
                  ? <Badge tone="good">unlocked</Badge>
                  : <Badge tone="neutral">locked</Badge>}
              </Card>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13 }}>
            Want premium? Ask an admin — or <Link to="/settings">manage settings</Link>.
          </p>
        </>
      )}
    </div>
  );
}
