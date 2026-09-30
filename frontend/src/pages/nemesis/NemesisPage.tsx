/**
 * Your Nemesis: a counter-strategy built from your own mistake profile.
 * Play it on the standard arena; it punishes exactly what you do worst.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import type { BotDef } from '../../../../engine/typescript/index.js';

type Profile = Awaited<ReturnType<typeof api.nemesis>>;

export function nemesisBotDef(p: Profile): BotDef {
  return {
    id: 'nemesis',
    name: 'Your Nemesis',
    rating: 1700,
    difficulty: 5,
    style: `Counter to your game (cf. ${p.baseName})`,
    description: p.explanation,
    weights: { ...p.weights },
    wallCandidates: p.wallCandidates,
    noise: p.noise,
    wallBias: p.wallBias,
    replySearch: p.replySearch,
    budgetMs: p.budgetMs,
  };
}

export default function NemesisPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (user === null) return;
    let live = true;
    api.nemesis().then((p) => { if (live) setProfile(p); }).catch(() => undefined);
    return () => { live = false; };
  }, [user === null]);

  if (user === null) {
    return <EmptyState title="Meet your Nemesis" body="Log in so it can study your games." action={<Link to="/login?next=/nemesis">Log in</Link>} />;
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 680 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Your Nemesis</h1>
      {profile === null ? <Spinner /> : (
        <>
          <Card>
            <p style={{ margin: '0 0 8px' }}>{profile.explanation}</p>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
              Built from {profile.games} recent game{profile.games === 1 ? '' : 's'} ·
              wasted walls {profile.flaws.wallWaste} · route errors {profile.flaws.pathErrors} ·
              passive stretches {profile.flaws.passive} · missed chokes {profile.flaws.missedChokes}
            </p>
            <Button
              size="lg"
              onClick={() => {
                try {
                  sessionStorage.setItem('nexus-nemesis', JSON.stringify(nemesisBotDef(profile)));
                } catch {
                  // private mode: bot falls back to stock below
                }
                navigate('/play/bot?bot=nemesis');
              }}
            >
              Face your Nemesis
            </Button>
          </Card>
          <Card>
            <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
              Standard 15×15 arena. Beat it to prove the flaw is fixed — your next games rewrite its profile.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
