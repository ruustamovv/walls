/**
 * Command dashboard: vitals + weekly series + AI usage.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Badge, Button, Card, Field, H, Input, Spinner } from '../components/ui.js';

function Bars({ data }: { data: { day: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 70 }}>
      {data.map((d) => (
        <div key={d.day} title={`${d.day}: ${d.count}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <div style={{ width: '100%', height: Math.max(3, (d.count / max) * 52), background: 'var(--primary)', borderRadius: 3, opacity: 0.85 }} />
          <span style={{ fontSize: 9, color: 'var(--muted)' }}>{d.day.slice(5)}</span>
        </div>
      ))}
      {data.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 13 }}>no data this week</span>}
    </div>
  );
}

export function Dashboard() {
  const [ov, setOv] = useState<Awaited<ReturnType<typeof api.overview>> | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.stats>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.overview(), api.stats()])
      .then(([o, s]) => { if (live) { setOv(o); setStats(s); } })
      .catch((err: unknown) => { if (live) setError(err instanceof Error ? err.message : 'Failed to load'); });
    return () => { live = false; };
  }, []);

  if (error !== null) return <Card><p role="alert" style={{ color: 'var(--bad)' }}>{error}</p></Card>;
  if (ov === null) return <Spinner />;

  const cards: [string, string, 'neutral' | 'good' | 'bad' | 'warn' | 'info'][] = [
    ['Users', String(ov.users), 'neutral'],
    ['Games total', String(ov.games.total), 'neutral'],
    ['Games live', String(ov.games.liveInMemory), 'good'],
    ['Ratings', String(ov.ratings), 'neutral'],
    ['Replays', String(ov.replays), 'neutral'],
    ['Tournaments', String(ov.tournaments), 'neutral'],
    ['Clubs', String(ov.clubs), 'neutral'],
    ['Open reports', String(ov.reportsOpen), ov.reportsOpen > 0 ? 'warn' : 'good'],
    ['Fair-play cases', String(ov.fairplayOpen), ov.fairplayOpen > 0 ? 'warn' : 'good'],
    ['Queue depth', String(ov.queueDepth), 'neutral'],
    ['Premium subs', String(ov.premiumSubs), 'info'],
    ['Puzzle packs', String(ov.puzzlePacks), 'neutral'],
    ['Redis', ov.redis, ov.redis === 'OK' ? 'good' : 'bad'],
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12 }}>
        {cards.map(([k, v, tone]) => (
          <Card key={k}>
            <div style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 700 }}>{k}</div>
            <div style={{ fontSize: 24, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            <Badge tone={tone}>{k === 'Redis' ? v : 'ok'}</Badge>
          </Card>
        ))}
      </div>
      <Card>
        <H>Signups / week</H>
        {stats !== null ? <Bars data={stats.usersPerDay} /> : <Spinner />}
      </Card>
      <Card>
        <H>Games / week</H>
        {stats !== null ? <Bars data={stats.gamesPerDay} /> : <Spinner />}
      </Card>
      <Card>
        <H>Puzzle attempts / week</H>
        {stats !== null ? <Bars data={stats.puzzlesPerDay} /> : <Spinner />}
      </Card>
      <Card>
        <H>Top events / week</H>
        {stats === null ? <Spinner /> : stats.topEvents.length === 0 ? (
          <p style={{ color: 'var(--muted)', margin: 0 }}>No telemetry yet.</p>
        ) : (
          <table>
            <thead><tr><th>Event</th><th>Count</th></tr></thead>
            <tbody>
              {stats.topEvents.map((e) => (
                <tr key={e.name}><td><code>{e.name}</code></td><td>{e.count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export function Announce() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.announcements>>['announcements']>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [days, setDays] = useState('7');
  const load = useCallback(() => {
    api.announcements().then((r) => setRows(r.announcements)).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <H>Publish broadcast</H>
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Body">
          <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
        </Field>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Audience">
            <select value={audience} onChange={(e) => setAudience(e.target.value)} style={{ background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 11px' }}>
              <option value="all">all</option>
              <option value="premium">premium</option>
              <option value="new">new</option>
            </select>
          </Field>
          <Field label="Days live">
            <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" style={{ width: 90 }} />
          </Field>
          <div style={{ paddingBottom: 12 }}>
            <Button
              disabled={title.trim().length < 3 || body.trim().length < 3}
              onClick={() => {
                void api.announcementCreate(title.trim(), body.trim(), audience, Number(days) || 7).then(() => {
                  setTitle('');
                  setBody('');
                  load();
                });
              }}
            >
              Publish
            </Button>
          </div>
        </div>
      </Card>
      <Card>
        <H>Active & past</H>
        {rows.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>Nothing published.</p> : (
          <table>
            <thead><tr><th>Title</th><th>Audience</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a._id}>
                  <td><strong>{a.title}</strong><br /><span style={{ color: 'var(--muted)', fontSize: 13 }}>{a.body.slice(0, 90)}</span></td>
                  <td><Badge tone="info">{a.audience}</Badge></td>
                  <td><Button kind="danger" onClick={() => { void api.announcementDelete(a._id).then(load); }}>Retract</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
