/**
 * Personal AI: your Nemesis (counter-strategy), your Mirror (your style),
 * and ghost races (rematch an exact opponent script).
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';
import type { Action, BotDef } from '../../../../engine/typescript/index.js';

type Profile = Awaited<ReturnType<typeof api.nemesis>>;
type Mirror = Awaited<ReturnType<typeof api.mirror>>;
type GhostList = Awaited<ReturnType<typeof api.ghostGames>>;

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
    depth: 2,
    maxNodes: 500,
  };
}

export function mirrorBotDef(p: Mirror): BotDef {
  return {
    id: 'mirror',
    name: 'Your Mirror',
    rating: 1500,
    difficulty: 4,
    style: 'Plays like you',
    description: p.explanation,
    weights: { ...p.weights },
    wallCandidates: p.wallCandidates,
    noise: p.noise,
    wallBias: p.wallBias,
    replySearch: p.replySearch,
    budgetMs: p.budgetMs,
    depth: 2,
    maxNodes: 400,
  };
}

export default function NemesisPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [ghosts, setGhosts] = useState<GhostList | null>(null);
  const [ghostBusy, setGhostBusy] = useState<string | null>(null);

  useEffect(() => {
    if (user === null) return;
    let live = true;
    api.nemesis().then((p) => { if (live) setProfile(p); }).catch(() => undefined);
    api.mirror().then((p) => { if (live) setMirror(p); }).catch(() => undefined);
    api.ghostGames().then((g) => { if (live) setGhosts(g); }).catch(() => undefined);
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
      <h2 className="font-display" style={{ margin: '8px 0 0' }}>Your Mirror</h2>
      {user !== null && (mirror === null ? <Spinner /> : (
        <Card>
          <p style={{ margin: '0 0 8px' }}>{mirror.explanation}</p>
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
            Built from {mirror.games} recent game{mirror.games === 1 ? '' : 's'} ·{' '}
            walls {Math.round(mirror.wallRate * 100)}% of turns · +{mirror.avgGain.toFixed(1)} avg pressure ·{' '}
            {Math.round(mirror.efficiency * 100)}% sound moves
          </p>
          <Button
            size="lg"
            onClick={() => {
              try {
                sessionStorage.setItem('quoridor-mirror', JSON.stringify(mirrorBotDef(mirror)));
              } catch {
                // private mode: bot falls back to stock below
              }
              navigate('/play/bot?bot=mirror');
            }}
          >
            Face your Mirror
          </Button>
        </Card>
      ))}
      <h2 className="font-display" style={{ margin: '8px 0 0' }}>Ghost races</h2>
      {user !== null && (ghosts === null ? <Spinner /> : (
        <Card>
          {ghosts.games.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              No raceable games yet — finish a 10+ move game and its ghost appears here.
            </p>
          ) : (
            <>
              <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 8px' }}>
                The ghost replays your opponent's exact moves. Diverged positions fall back to rookie search.
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {ghosts.games.map((g) => (
                  <li key={g.gameId} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                    <Badge tone={g.result === 'win' ? 'good' : g.result === 'loss' ? 'bad' : 'neutral'}>{g.result ?? 'draw'}</Badge>
                    <span style={{ fontSize: 14 }}>{g.timeControl} · {g.moves} moves</span>
                    <span style={{ marginLeft: 'auto' }}>
                      <Button
                        size="sm"
                        disabled={ghostBusy !== null}
                        onClick={() => {
                          setGhostBusy(g.gameId);
                          void api.ghostGame(g.gameId)
                            .then((full) => {
                              try {
                                sessionStorage.setItem('quoridor-ghost', JSON.stringify({
                                  actions: full.actions as Action[],
                                  size: full.size,
                                  wallsPerPlayer: full.wallsPerPlayer,
                                }));
                              } catch {
                                // private mode: rookie fallback covers every turn
                              }
                              navigate('/play/bot?bot=ghost');
                            })
                            .catch(() => undefined)
                            .finally(() => setGhostBusy(null));
                        }}
                      >
                        {ghostBusy === g.gameId ? 'Loading…' : 'Race ghost'}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
