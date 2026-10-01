/**
 * System: AI providers + usage, feature flags, audit trail.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSession } from '../stores/session.js';
import { Badge, Button, Card, Empty, Field, H, Input, Spinner } from '../components/ui.js';

export function System({ tab }: { tab: 'ai' | 'flags' | 'audit' | 'billing' }) {
  if (tab === 'ai') return <AI />;
  if (tab === 'flags') return <Flags />;
  if (tab === 'billing') return <Billing />;
  return <Audit />;
}

function Billing() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.billing>> | null>(null);
  useEffect(() => {
    let live = true;
    api.billing().then((r) => { if (live) setData(r); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <H>Payments</H>
        {data === null ? <Spinner /> : (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 15 }}>
              Provider <strong className="font-mono">{data.provider}</strong>{' '}
              <Badge tone={data.checkoutReady ? 'good' : 'neutral'}>{data.checkoutReady ? 'checkout live' : 'disabled'}</Badge>
            </p>
            <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>{data.reason}</p>
          </>
        )}
      </Card>
      <Card>
        <H>Entitlement grants</H>
        {data === null ? <Spinner /> : data.grantsByEntitlement.length === 0 ? (
          <Empty title="No grants yet" body="Admin grants and Stripe bundles land here." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {data.grantsByEntitlement.map((g) => (
              <li key={g.entitlement} style={{ fontSize: 14 }}><code>{g.entitlement}</code> × <strong className="font-mono">{g.count}</strong></li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <H>Recent Stripe events</H>
        {data === null ? <Spinner /> : data.recentEvents.length === 0 ? (
          <Empty title="No events" body="Verified webhooks appear here newest-first." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {data.recentEvents.map((e) => (
              <li key={e.eventId} style={{ fontSize: 13 }}>
                <code>{e.type}</code> <span style={{ color: 'var(--muted)' }}>{e.eventId.slice(0, 16)} · {String(e.userId).slice(0, 12)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AI() {
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof api.aiStatus>> | null>(null);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.stats>> | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.overview>> | null>(null);
  const [quotaUser, setQuotaUser] = useState('');
  const [quotaLimit, setQuotaLimit] = useState('50');
  const [quotaMsg, setQuotaMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.aiStatus().then((r) => { if (live) setProviders(r); }).catch(() => undefined);
    api.stats().then((r) => { if (live) setStats(r); }).catch(() => undefined);
    api.overview().then((r) => { if (live) setOverview(r); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <H>Monthly budget</H>
        {overview === null ? <Spinner /> : (
          <p style={{ margin: 0, fontSize: 15 }}>
            Spend <strong className="font-mono">${overview.aiSpendUsd.toFixed(4)}</strong>
            {' '}of <strong className="font-mono">${overview.aiBudget.toFixed(2)}</strong>{' '}
            <Badge tone={overview.aiSpendUsd >= overview.aiBudget ? 'bad' : overview.aiSpendUsd >= overview.aiBudget * 0.8 ? 'warn' : 'good'}>
              {overview.aiSpendUsd >= overview.aiBudget ? 'exhausted' : 'healthy'}
            </Badge>
          </p>
        )}
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 0' }}>
          Estimates from logged tokens (rough per-model rates). Coach calls stop automatically at the cap.
          Kill-switch: turn the <code>AI_COACH</code> feature flag off.
        </p>
      </Card>
      <Card>
        <H>Providers</H>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
          Keys live in <code>.env</code> (<code>GROQ_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>GEMINI_API_KEY</code>, <code>OPENROUTER_API_KEY</code> + <code>AI_MODEL_COACH</code>). Paste a key, restart the backend, it lights up here. Full keys are never displayed.
        </p>
        {providers === null ? <Spinner /> : (
          <table>
            <thead><tr><th>Provider</th><th>Status</th><th>Model</th></tr></thead>
            <tbody>
              {providers.providers.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.id}</code></td>
                  <td><Badge tone={p.configured ? 'good' : 'neutral'}>{p.configured ? `on ${p.keyHint ?? ''}` : 'missing key'}</Badge></td>
                  <td style={{ color: 'var(--muted)' }}>{p.model ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <H>Usage (7 days)</H>
        {stats === null ? <Spinner /> : stats.aiUsage.length === 0 ? (
          <Empty title="No AI calls" body="Coach explanations will appear here." />
        ) : (
          <table>
            <thead><tr><th>Provider</th><th>Requests</th><th>Errors</th><th>Est. spend</th></tr></thead>
            <tbody>
              {stats.aiUsage.map((u) => (
                <tr key={u.provider}>
                  <td><code>{u.provider}</code></td>
                  <td>{u.requests}</td>
                  <td style={{ color: u.errors > 0 ? 'var(--bad)' : 'var(--muted)' }}>{u.errors}</td>
                  <td>${u.spendUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <H>Per-user quota override</H>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="User ID">
            <Input value={quotaUser} onChange={(e) => setQuotaUser(e.target.value)} style={{ width: 260 }} />
          </Field>
          <Field label="Daily limit (0 = block)">
            <Input value={quotaLimit} onChange={(e) => setQuotaLimit(e.target.value)} inputMode="numeric" style={{ width: 120 }} />
          </Field>
          <div style={{ paddingBottom: 12 }}>
            <Button
              disabled={quotaUser.trim() === ''}
              onClick={() => {
                setQuotaMsg(null);
                api.quotaSet(quotaUser.trim(), Number(quotaLimit) || 0).then(
                  () => setQuotaMsg('Override saved for today.'),
                  (err: unknown) => setQuotaMsg(err instanceof Error ? err.message : 'Save failed'),
                );
              }}
            >
              Save override
            </Button>
          </div>
        </div>
        {quotaMsg !== null && <p role="status" style={{ color: 'var(--muted)', fontSize: 13 }}>{quotaMsg}</p>}
      </Card>
    </div>
  );
}

function Flags() {
  const me = useSession((s) => s.user);
  const canWrite = me?.role === 'admin' || me?.role === 'owner';
  const [flags, setFlags] = useState<{ key: string; enabled: boolean }[]>([]);
  const load = useCallback(() => {
    api.flags().then((r) => setFlags(r.flags)).catch(() => setFlags([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <Card>
      <H>Feature flags</H>
      {flags.length === 0 ? <Empty title="No flags" body="Flags gate experimental features." /> : (
        <table>
          <thead><tr><th>Key</th><th>State</th><th></th></tr></thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.key}>
                <td><code>{f.key}</code></td>
                <td><Badge tone={f.enabled ? 'good' : 'neutral'}>{f.enabled ? 'on' : 'off'}</Badge></td>
                <td>
                  {canWrite && (
                    <Button kind="ghost" onClick={() => { void api.flagSet(f.key, !f.enabled).then(load); }}>
                      Turn {f.enabled ? 'off' : 'on'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Audit() {
  const [entries, setEntries] = useState<Awaited<ReturnType<typeof api.audit>>['entries']>([]);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const load = useCallback(() => {
    api.audit({ action: action.trim(), actor: actor.trim() }).then((r) => setEntries(r.entries)).catch(() => setEntries([]));
  }, [action, actor]);
  useEffect(() => { load(); }, [load]);

  function exportCsv(): void {
    const rows = [['id', 'action', 'actor', 'target', 'at'],
      ...entries.map((e) => [e._id, e.action, e.actorId, e.target ?? '', e.createdAt])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexus-audit.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <Card>
      <H>Audit trail</H>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
        <Field label="Action prefix">
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="admin.users" style={{ width: 180 }} />
        </Field>
        <Field label="Actor ID">
          <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="user id" style={{ width: 180 }} />
        </Field>
        <div style={{ paddingBottom: 12, display: 'flex', gap: 8 }}>
          <Button onClick={load}>Filter</Button>
          <Button kind="ghost" onClick={exportCsv} disabled={entries.length === 0}>Export CSV</Button>
        </div>
      </div>
      {entries.length === 0 ? <Empty title="No entries" body="Admin actions append here." /> : (
        <table>
          <thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>At</th></tr></thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e._id}>
                <td><code>{e.action}</code></td>
                <td><code>{e.actorId.slice(0, 8)}…</code></td>
                <td>{e.target !== undefined ? <code>{e.target.slice(0, 12)}…</code> : '—'}</td>
                <td style={{ color: 'var(--muted)' }}>{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
