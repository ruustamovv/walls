/**
 * Dev-only live TODO drawer (BUILD STATUS).
 * Visible only when VITE_DEV_TOOLS=true. Toggle: Ctrl/Cmd + Shift + T.
 * Reads /live-todo.json (synced from PROJECT_LIVE_TODO.json).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

const ENABLED = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.['VITE_DEV_TOOLS'] === 'true';

interface LiveTask {
  id: string;
  phase: string;
  epic: string;
  title: string;
  status: string;
  priority: string;
}

interface LiveFile {
  meta?: {
    currentPhase?: string;
    currentEpic?: string;
    currentTask?: string;
    next?: string[];
    tests?: Record<string, string>;
    build?: string;
    database?: string;
    redis?: string;
    engine?: string;
    ai?: string;
    backend?: string;
    frontend?: string;
    lastChange?: string;
    lastTestRun?: string;
  };
  tasks?: LiveTask[];
}

const ACTIVE = new Set(['IN_PROGRESS', 'PARTIAL', 'BLOCKED', 'EXPERIMENTAL']);

export function DevTodoDrawer() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LiveFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/live-todo.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<LiveFile>;
      })
      .then((j) => {
        setData(j);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'load failed'));
  }, []);

  useEffect(() => {
    if (!ENABLED) return;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (ENABLED && open && data === null) load();
  }, [open, data, load]);

  const summary = useMemo(() => {
    const tasks = data?.tasks ?? [];
    const byStatus: Record<string, number> = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const done = byStatus['COMPLETE'] ?? 0;
    const total = tasks.length;
    const attention = tasks.filter((t) => ACTIVE.has(t.status)).slice(0, 8);
    const upcoming = tasks.filter((t) => t.status === 'NOT_STARTED').slice(0, 5);
    return { byStatus, done, total, attention, upcoming };
  }, [data]);

  if (!ENABLED) return null;

  const m = data?.meta;
  const sys: [string, string | undefined][] = [
    ['Tests', data === null ? undefined : `eng ${m?.tests?.['engine'] ?? '?'} · be ${m?.tests?.['backend'] ?? '?'} · fe ${m?.tests?.['frontend'] ?? '?'}`],
    ['Build', m?.build],
    ['MongoDB', m?.database],
    ['Redis', m?.redis],
    ['Engine', m?.engine],
    ['AI', m?.ai],
    ['Backend', m?.backend],
    ['Frontend', m?.frontend],
  ];

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Build status (Ctrl/Cmd+Shift+T)"
        style={{
          position: 'fixed', right: 12, bottom: 12, zIndex: 90, width: 36, height: 36,
          borderRadius: '50%', border: '1px solid var(--line)', background: 'var(--surface)',
          color: 'var(--muted)', fontSize: 15, fontFamily: 'var(--font-mono)',
        }}
      >
        T
      </button>
      {open && (
        <aside
          aria-label="Build status"
          style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(380px, 92vw)', zIndex: 95,
            background: 'var(--surface)', borderLeft: '1px solid var(--line)',
            boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column',
            fontSize: 13,
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong className="font-display">Build status</strong>
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>dev only</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button onClick={load} style={chip} title="Reload live-todo.json">Reload</button>
              <button onClick={() => setOpen(false)} style={chip} aria-label="Close build status">✕</button>
            </span>
          </div>
          <div style={{ overflowY: 'auto', padding: '12px 14px', display: 'grid', gap: 12 }}>
            {error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>live-todo.json: {error} (run scripts/setup/sync-live-todo.mjs)</p>}
            {data === null && error === null && <p style={{ color: 'var(--muted)' }}>Loading…</p>}
            {data !== null && (
              <>
                <section>
                  <div style={h}>Now</div>
                  <div>Phase {m?.currentPhase ?? '?'} — {m?.currentEpic ?? '?'}</div>
                  <div style={{ fontWeight: 700 }}>{m?.currentTask ?? '?'}</div>
                  <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div style={{ width: `${summary.total === 0 ? 0 : Math.round((summary.done / summary.total) * 100)}%`, height: '100%', background: 'var(--good)' }} />
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {summary.done}/{summary.total} complete
                    {Object.entries(summary.byStatus).map(([k, v]) => ` · ${k.toLowerCase()} ${v}`).join('')}
                  </div>
                </section>
                <section>
                  <div style={h}>Attention</div>
                  {summary.attention.length === 0 && <div style={{ color: 'var(--muted)' }}>—</div>}
                  {summary.attention.map((t) => (
                    <div key={t.id} style={row}>
                      <span className="font-mono" style={{ color: 'var(--muted)' }}>{t.id}</span> {t.title}
                      <span style={{ marginLeft: 'auto', ...pill(t.status) }}>{t.status}</span>
                    </div>
                  ))}
                </section>
                <section>
                  <div style={h}>Next</div>
                  {(m?.next ?? []).map((n) => <div key={n} style={row}>→ {n}</div>)}
                  {summary.upcoming.map((t) => (
                    <div key={t.id} style={row}>
                      <span className="font-mono" style={{ color: 'var(--muted)' }}>{t.id}</span> {t.title}
                    </div>
                  ))}
                </section>
                <section>
                  <div style={h}>Systems</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {sys.map(([k, v]) => (
                      <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '6px 8px' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{k.toUpperCase()}</div>
                        <div style={{ fontSize: 12 }}>{v ?? '…'}</div>
                      </div>
                    ))}
                  </div>
                </section>
                <section style={{ color: 'var(--muted)', fontSize: 12 }}>
                  <div>Last change: {m?.lastChange ?? '—'}</div>
                  <div>Last test run: {m?.lastTestRun ?? '—'}</div>
                </section>
              </>
            )}
          </div>
        </aside>
      )}
    </>
  );
}

const chip: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8,
  padding: '3px 9px', fontSize: 12, color: 'var(--ink)',
};

const h: React.CSSProperties = { fontWeight: 800, fontSize: 11, letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 4 };

const row: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0', borderTop: '1px solid var(--line)' };

function pill(status: string): React.CSSProperties {
  const bg = status === 'BLOCKED' ? 'var(--bad-soft)' : status === 'IN_PROGRESS' ? 'var(--primary-soft)' : 'var(--warn-soft)';
  const fg = status === 'BLOCKED' ? 'var(--bad)' : status === 'IN_PROGRESS' ? 'var(--primary)' : 'var(--warn)';
  return { background: bg, color: fg, borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 800, flexShrink: 0 };
}
