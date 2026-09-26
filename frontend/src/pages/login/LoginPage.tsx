/**
 * Login / register with real session backend + demo entry.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';
import { BRAND } from '../../lib/brand.js';

export default function LoginPage() {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [login, setLogin] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/play';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = tab === 'login'
      ? await session.login(login, password)
      : await session.register(email, username, password);
    if (ok) navigate(next);
  }

  return (
    <div style={{ maxWidth: 440, margin: '24px auto' }}>
      <Card>
        <p style={{ color: 'var(--muted)', margin: '0 0 4px', fontSize: 13 }}>{BRAND.APP_NAME}</p>
        <h1 style={{ margin: '0 0 12px' }}>{tab === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['login', 'register'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 10, fontWeight: 700, textTransform: 'capitalize',
                border: tab === t ? '2px solid var(--primary)' : '1px solid var(--line)',
                background: tab === t ? '#e8effd' : '#fff', color: 'var(--ink)',
              }}
            >
              {t === 'login' ? 'Log in' : 'Register'}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          {tab === 'login'
            ? (
              <Field label="Username or email">
                <TextInput value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
              </Field>
            )
            : (
              <>
                <Field label="Email">
                  <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                </Field>
                <Field label="Username (letters, numbers, _)">
                  <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required minLength={3} maxLength={24} />
                </Field>
              </>
            )}
          <Field label="Password">
            <div style={{ display: 'flex', gap: 8 }}>
              <TextInput
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
              />
              <Button variant="ghost" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Button>
            </div>
          </Field>
          {session.error !== null && <p role="alert" style={{ color: '#b91c1c' }}>{session.error}</p>}
          <Button type="submit" disabled={session.busy} style={{ width: '100%' }}>
            {session.busy ? 'Please wait…' : tab === 'login' ? 'Log in' : 'Create account'}
          </Button>
        </form>
        <p style={{ textAlign: 'center', color: 'var(--muted)', margin: '14px 0 0' }}>
          No account? <Link to="/play/bot?bot=rookie">Play a bot instantly</Link>
        </p>
      </Card>
    </div>
  );
}
