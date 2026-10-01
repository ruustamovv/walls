/**
 * Tournaments: browse, found, enter, run (owner), report, standings.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Spinner, Tabs, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';

type Format = 'single-elim' | 'round-robin' | 'swiss' | 'arena';
const FORMATS: Format[] = ['single-elim', 'round-robin', 'swiss', 'arena'];

export default function TournamentsPage() {
  const { id } = useParams();
  return id === undefined ? <TournamentList /> : <TournamentDetail id={id} />;
}

function TournamentList() {
  const { user } = useSession();
  const [rows, setRows] = useState<{ _id: string; title: string; status: string; format: string; timeControl: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<Format>('single-elim');
  const [recurrence, setRecurrence] = useState<'once' | 'daily' | 'weekly'>('once');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.tournaments()
      .then((r) => { setRows(r.tournaments); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Failed to load'); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setError(null);
    try {
      await api.tournamentCreate(title.trim(), format, recurrence === 'once' ? undefined : recurrence);
      setTitle('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Tournaments</h1>
      {user !== null && (
        <Card>
          <h3 className="font-display" style={{ margin: '0 0 8px' }}>Found a tournament</h3>
          <Field label="Title">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </Field>
          <div style={{ marginBottom: 12 }}><Tabs tabs={FORMATS} active={format} onChange={setFormat} /></div>
          <div style={{ marginBottom: 12 }}><Tabs tabs={(['once', 'daily', 'weekly'] as const)} active={recurrence} onChange={setRecurrence} /></div>
          {error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
          <Button onClick={create} disabled={title.trim().length < 3}>Create</Button>
        </Card>
      )}
      {loading ? <Spinner /> : rows.length === 0 ? (
        <Card><EmptyState title="No tournaments yet" body="Found the first one — single elimination, league, or Swiss." /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
          {rows.map((t) => (
            <Card key={t._id}>
              <h3 className="font-display" style={{ margin: '0 0 4px' }}>
                <Link to={`/tournaments/${t._id}`} style={{ textDecoration: 'none' }}>{t.title}</Link>
              </h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Badge tone={t.status === 'LIVE' ? 'good' : t.status === 'FINISHED' ? 'neutral' : 'info'}>{t.status}</Badge>
                <Badge tone="neutral">{t.format}</Badge>
                <Badge tone="neutral">{t.timeControl}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

type Detail = Awaited<ReturnType<typeof api.tournament>>;

function TournamentDetail({ id }: { id: string }) {
  const { user } = useSession();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.tournament(id)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Tournament not found'));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error !== null) {
    return (
      <div>
        <Link to="/tournaments" style={{ color: 'var(--muted)', fontSize: 14 }}>← Tournaments</Link>
        <div style={{ marginTop: 16 }}><ErrorBox message={error} /></div>
      </div>
    );
  }
  if (data === null) return <Spinner />;

  const t = data.tournament;
  const isOwner = user !== null && t.ownerId === user.id;
  const isMember = user !== null && data.players.some((p) => p.id === user.id);
  const nameOf = (uid: string | null): string =>
    uid === null ? 'bye' : (data.players.find((p) => p.id === uid)?.username ?? data.standings.find((s) => s.userId === uid)?.username ?? uid.slice(0, 8));

  async function act(fn: () => Promise<unknown>, msg: string) {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? `${msg}: ${err.message}` : msg);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Link to="/tournaments" style={{ color: 'var(--muted)', fontSize: 14 }}>← Tournaments</Link>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h1 className="font-display" style={{ margin: 0 }}>{t.title}</h1>
        <Badge tone={t.status === 'LIVE' ? 'good' : t.status === 'FINISHED' ? 'neutral' : 'info'}>{t.status}</Badge>
        <Badge tone="neutral">{t.format}</Badge>
        <Badge tone="neutral">{t.timeControl}</Badge>
        {t.champion !== null && t.champion !== undefined && <Badge tone="good">Champion: {nameOf(t.champion)}</Badge>}
      </div>
      {error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {user !== null && !isMember && (t.status === 'DRAFT' || t.status === 'OPEN') && (
          <Button onClick={() => void act(() => api.tournamentJoin(id), 'Join failed')}>Enter tournament</Button>
        )}
        {isOwner && t.status === 'DRAFT' && (
          <Button variant="ghost" onClick={() => void act(() => api.tournamentOpen(id), 'Open failed')}>Open entries</Button>
        )}
        {isOwner && (t.status === 'DRAFT' || t.status === 'OPEN') && (
          <Button variant="ghost" onClick={() => void act(() => api.tournamentStart(id), 'Start failed')}>Start now</Button>
        )}
        {isOwner && t.status === 'LIVE' && (
          <Button variant="ghost" onClick={() => void act(() => api.tournamentFinish(id), 'Finish failed')}>Finish & crown</Button>
        )}
      </div>
      {t.format === 'arena' && (
        <ArenaPanel id={id} status={t.status} endAt={(t as { endAt?: string }).endAt ?? null} isMember={isMember} onChanged={load} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ display: 'grid', gap: 12 }}>
          {data.rounds.length === 0 && (
            <Card><p style={{ color: 'var(--muted)', margin: 0 }}>No rounds yet — the organizer starts when entries close.</p></Card>
          )}
          {data.rounds.map((rd) => (
            <Card key={rd.round}>
              <h3 className="font-display" style={{ margin: '0 0 8px' }}>Round {rd.round}</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {rd.matches.map((m, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: m.winner === m.a ? 800 : 400 }}>{nameOf(m.a)}</span>
                    <span style={{ color: 'var(--muted)' }}>vs</span>
                    <span style={{ fontWeight: m.winner === m.b ? 800 : 400 }}>{nameOf(m.b)}</span>
                    {m.winner !== null
                      ? <Badge tone="good">won: {nameOf(m.winner)}</Badge>
                      : m.b !== null && t.status === 'LIVE' && (isMember || isOwner) && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void act(() => api.tournamentReport(id, rd.round, i, m.a as string), 'Report failed')}>
                            {nameOf(m.a)} won
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void act(() => api.tournamentReport(id, rd.round, i, m.b as string), 'Report failed')}>
                            {nameOf(m.b)} won
                          </Button>
                        </>
                      )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Standings</h3>
            {data.standings.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>Live once play begins.</p> : (
              <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 14 }}>
                {data.standings.map((s) => (
                  <li key={s.userId}>
                    <Avatar name={s.username ?? s.userId} size={20} /> {s.username ?? s.userId.slice(0, 8)}{' '}
                    <span className="font-mono">{s.points} pts</span>{' '}
                    <span style={{ color: 'var(--muted)' }}>({s.wins}W/{s.losses}L)</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Players ({data.players.length})</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 14 }}>
              {data.players.map((p) => (
                <li key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Avatar name={p.username ?? p.id} size={24} />
                  <Link to={`/profile/${encodeURIComponent(p.username ?? p.id)}`}>{p.username ?? p.id.slice(0, 8)}</Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

function ArenaPanel({ id, status, endAt, isMember, onChanged }: {
  id: string;
  status: string;
  endAt: string | null;
  isMember: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'LIVE') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

  async function queue() {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.tournamentArena(id);
      if (res.status === 'matched' && res.gameId !== undefined) {
        navigate(`/game/${res.gameId}`);
      } else {
        setNote('In the pool — stay on this page, you will be paired as rivals arrive.');
      }
      onChanged();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Queue failed');
    } finally {
      setBusy(false);
    }
  }

  const msLeft = endAt === null ? null : new Date(endAt).getTime() - now;
  return (
    <Card>
      <h3 className="font-display" style={{ margin: '0 0 4px' }}>Arena floor</h3>
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>
        Continuous re-pairing while live. Every reported win scores a point.
        {msLeft !== null && msLeft > 0 && (
          <> Ends in <strong className="font-mono">{Math.floor(msLeft / 60000)}m {Math.floor((msLeft % 60000) / 1000)}s</strong>.</>
        )}
        {msLeft !== null && msLeft <= 0 && <> The clock has run out — organizer crowns the leader.</>}
      </p>
      {status === 'LIVE' && isMember && (
        <Button onClick={() => void queue()} disabled={busy}>
          {busy ? 'Pairing…' : 'Find arena game'}
        </Button>
      )}
      {note !== null && <p style={{ color: 'var(--muted)', fontSize: 14 }}>{note}</p>}
    </Card>
  );
}
