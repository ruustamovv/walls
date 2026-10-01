/**
 * Moderation: users (search/detail/suspend/ban/entitlements) + reports queue.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../stores/session.js';
import { Badge, Button, Card, Empty, Field, H, Input, Spinner } from '../components/ui.js';

const ENTITLEMENT_IDS = ['AI_REVIEW_ADVANCED', 'AI_COACH_UNLIMITED', 'ADVANCED_STATS', 'PREMIUM_COSMETICS', 'REPLAY_ANALYTICS'];

export function Moderation({ tab }: { tab: 'users' | 'reports' }) {
  return tab === 'users' ? <Users /> : <Reports />;
}

function Users() {
  const me = useSession((s) => s.user);
  const isAdmin = me?.role === 'admin' || me?.role === 'owner';
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.users>>['users']>([]);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.user>> | null>(null);
  const [ents, setEnts] = useState<string[]>([]);

  const search = useCallback(() => {
    api.users(q).then((r) => setRows(r.users)).catch(() => setRows([]));
  }, [q]);
  useEffect(() => { search(); }, [search]);

  async function open(id: string) {
    const d = await api.user(id).catch(() => null);
    setDetail(d);
    if (d !== null) {
      api.entitlements(id).then((r) => setEnts(r.entitlements)).catch(() => setEnts([]));
    }
  }
  async function act(fn: () => Promise<unknown>) {
    await fn().catch(() => undefined);
    if (detail !== null) open(detail.user.id);
    search();
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="username prefix…" aria-label="search users" /></div>
          <Button kind="ghost" onClick={search}>Search</Button>
        </div>
      </Card>
      <Card>
        <H>Results</H>
        {rows.length === 0 ? <Empty title="No users match" body="Try a different prefix." /> : (
          <table>
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Email</th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td><button onClick={() => void open(u.id)} style={{ background: 'none', border: 'none', fontWeight: 700, color: 'var(--primary)', padding: 0 }}>{u.username}</button></td>
                  <td><Badge tone="info">{u.role}</Badge></td>
                  <td><Badge tone={u.status === 'ACTIVE' ? 'good' : 'bad'}>{u.status}</Badge></td>
                  <td style={{ color: 'var(--muted)' }}>{u.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {detail !== null && (
        <Card>
          <H>{detail.user.username}</H>
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>
            {detail.user.email} · {detail.user.role} · {detail.user.status}
          </p>
          <p style={{ fontSize: 14 }}>
            {detail.ratings.map((r) => `${r.mode}: ${r.rating ?? '—'} (${r.games})`).join(' · ')}
          </p>
          {isAdmin && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <Button kind="ghost" onClick={() => void act(() => api.userStatus(detail.user.id, 'SUSPENDED'))}>Suspend</Button>
                <Button kind="danger" onClick={() => void act(() => api.userStatus(detail.user.id, 'BANNED'))}>Ban</Button>
                <Button kind="ghost" onClick={() => void act(() => api.userStatus(detail.user.id, 'ACTIVE'))}>Restore</Button>
                <Button
                  kind="ghost"
                  onClick={() => {
                    const msg = window.prompt('Warning text for ' + detail.user.username + ':');
                    if (msg !== null && msg.trim().length >= 3) void act(() => api.warn(detail.user.id, msg.trim()));
                  }}
                >
                  Warn
                </Button>
                <Button
                  kind="ghost"
                  onClick={() => {
                    const minutes = Number(window.prompt('Mute chat for how many minutes?', '60') ?? '0');
                    if (Number.isFinite(minutes) && minutes > 0) {
                      void act(() => api.mute(detail.user.id, minutes, 'moderator action'));
                    }
                  }}
                >
                  Mute chat
                </Button>
              </div>
              <h4 style={{ margin: '0 0 6px' }}>Entitlements</h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ENTITLEMENT_IDS.map((e) => (
                  <button
                    key={e}
                    onClick={() => void act(() => (ents.includes(e) ? api.revoke(detail.user.id, e) : api.grant(detail.user.id, e)))}
                    style={{
                      borderRadius: 999, padding: '5px 10px', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)',
                      border: '1px solid var(--line)',
                      background: ents.includes(e) ? 'var(--good-soft)' : 'var(--surface-2)',
                      color: ents.includes(e) ? 'var(--good)' : 'var(--muted)',
                    }}
                    title={ents.includes(e) ? 'click to revoke' : 'click to grant'}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

function Reports() {
  const [status, setStatus] = useState('OPEN');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.reports>>['reports']>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [verdict, setVerdict] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    api.reports(status).then((r) => setRows(r.reports)).catch(() => setRows([]));
  }, [status]);
  useEffect(() => { load(); }, [load]);
  return (
    <Card>
      <H>Moderation queue</H>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {['OPEN', 'RESOLVED', 'DISMISSED', 'ALL'].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              borderRadius: 999, padding: '6px 12px', fontSize: 13, fontWeight: 700,
              border: status === s ? '2px solid var(--primary)' : '1px solid var(--line)',
              background: status === s ? 'var(--primary-soft)' : 'transparent', color: 'var(--ink)',
            }}
          >
            {s}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <Empty title="Queue clear" body="Nothing awaiting review." /> : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <li key={r._id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8, fontSize: 14 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge tone={r.status === 'OPEN' ? 'warn' : 'neutral'}>{r.status}</Badge>
                <code>{r.targetType}:{r.targetId.slice(0, 12)}</code>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</span>
              </div>
              <p style={{ margin: '6px 0' }}>{r.reason}</p>
              {verdict[r._id] !== undefined && (
                <p style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px' }}>
                  AI triage: {verdict[r._id]}
                </p>
              )}
              {r.status === 'OPEN' ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <Field label="">
                    <Input
                      value={note[r._id] ?? ''}
                      onChange={(e) => setNote((n) => ({ ...n, [r._id]: e.target.value }))}
                      placeholder="resolution note (optional)"
                      aria-label="resolution note"
                    />
                  </Field>
                  <div style={{ alignSelf: 'end', paddingBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Button kind="ghost" disabled={aiBusy !== null} onClick={() => {
                      setAiBusy(r._id);
                      void api.reportAiReview(r._id)
                        .then((v) => setVerdict((m) => ({ ...m, [r._id]: v.available && v.verdict !== undefined ? v.verdict : (v.message ?? 'unavailable') })))
                        .catch((e: unknown) => setVerdict((m) => ({ ...m, [r._id]: e instanceof Error ? e.message : 'failed' })))
                        .finally(() => setAiBusy(null));
                    }}>
                      {aiBusy === r._id ? 'Asking…' : 'Ask AI'}
                    </Button>
                    <Button onClick={() => { void api.reportResolve(r._id, 'RESOLVED', note[r._id] ?? '').then(load); }}>Resolve</Button>
                    <Button kind="ghost" onClick={() => { void api.reportResolve(r._id, 'DISMISSED', note[r._id] ?? '').then(load); }}>Dismiss</Button>
                  </div>
                </div>
              ) : (
                typeof (r as { resolution?: string }).resolution === 'string' && (r as { resolution?: string }).resolution !== '' && (
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>Resolution: {(r as { resolution?: string }).resolution}</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
