/**
 * Admin console shell: staff gate, sidebar sections, live content.
 * Talks to the same backend as the player app — different host, port, folder.
 */
import { useEffect, useState } from 'react';
import { isStaff, useSession } from '../stores/session.js';
import { Badge, Button, Card, Field, H, Input } from '../components/ui.js';
import { Announce, Dashboard } from '../pages/Dashboard.js';
import { Moderation } from '../pages/Moderation.js';
import { Ops } from '../pages/Ops.js';
import { System } from '../pages/System.js';

type Tab = 'dashboard' | 'users' | 'games' | 'tournaments' | 'clubs' | 'reports' | 'ai' | 'flags' | 'audit' | 'announce';
type Group = 'command' | 'moderation' | 'ops' | 'system';

const TABS: { id: Tab; label: string; group: Group }[] = [
  { id: 'dashboard', label: 'Dashboard', group: 'command' },
  { id: 'announce', label: 'Announce', group: 'command' },
  { id: 'users', label: 'Users', group: 'moderation' },
  { id: 'reports', label: 'Reports', group: 'moderation' },
  { id: 'games', label: 'Games', group: 'ops' },
  { id: 'tournaments', label: 'Tournaments', group: 'ops' },
  { id: 'clubs', label: 'Clubs', group: 'ops' },
  { id: 'ai', label: 'AI', group: 'system' },
  { id: 'flags', label: 'Flags', group: 'system' },
  { id: 'audit', label: 'Audit', group: 'system' },
];

const GROUPS: { id: Group; label: string }[] = [
  { id: 'command', label: 'Command' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'ops', label: 'Operations' },
  { id: 'system', label: 'System' },
];

function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const session = useSession();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: 400, maxWidth: '100%' }}>
        <H>Control center sign-in</H>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 16px' }}>
          Staff accounts only. Bootstrap one with <code>pnpm owner:create</code>.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); void session.login(login, password); }}>
          <Field label="Username or email">
            <Input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {session.error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{session.error}</p>}
          <Button type="submit" disabled={session.busy} kind="primary">
            {session.busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function App() {
  const { user, checked, logout } = useSession();
  const refresh = useSession((s) => s.refresh);
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!checked) return null;
  if (user === null) return <Login />;
  if (!isStaff(user)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card>
          <H>Forbidden</H>
          <p style={{ color: 'var(--muted)' }}>This console is staff-only.</p>
          <Button kind="ghost" onClick={() => void logout()}>Log out</Button>
        </Card>
      </div>
    );
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <aside style={{
        width: 240, flexShrink: 0, borderRight: '1px solid var(--line)',
        background: 'var(--surface)', position: 'sticky', top: 0, height: '100vh',
        display: 'flex', flexDirection: 'column', padding: 14,
      }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginBottom: 16 }}>
          <svg width={28} height={28} viewBox="0 0 20 20" aria-hidden>
            <path d="M10 2l7 3v6c0 4-3 6.5-7 7-4-.5-7-3-7-7V5z" fill="none" stroke="var(--primary)" strokeWidth={1.8} />
          </svg>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>NEXUS Admin</div>
            <Badge tone="info">{user.role}</Badge>
          </div>
        </div>
        <nav aria-label="Admin" style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, overflowY: 'auto' }}>
          {GROUPS.map((g) => (
            <div key={g.id}>
              <div style={{ color: 'var(--muted)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.07em', margin: '4px 4px' }}>
                {g.label}
              </div>
              {TABS.filter((t) => t.group === g.id).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', borderRadius: 8, padding: '8px 12px',
                    fontWeight: tab === t.id ? 800 : 500, fontSize: 14, border: 'none',
                    background: tab === t.id ? 'var(--primary-soft)' : 'transparent', color: 'var(--ink)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.username}</strong>
          <Button kind="ghost" size="sm" onClick={() => void logout()}>Out</Button>
        </div>
      </aside>
      <main style={{ flex: 1, minWidth: 0, padding: 20, maxWidth: 1180 }}>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'announce' && <Announce />}
        {(tab === 'users' || tab === 'reports') && <Moderation tab={tab} />}
        {(tab === 'games' || tab === 'tournaments' || tab === 'clubs') && <Ops tab={tab} />}
        {(tab === 'ai' || tab === 'flags' || tab === 'audit') && <System tab={tab} />}
      </main>
    </div>
  );
}
