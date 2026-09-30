/**
 * Dedicated login window: lean credential form + social buttons + recovery.
 * New here? The signup window sells the account.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import OAuthButtons from '../../components/auth/OAuthButtons.js';
import { Button, Card, Field, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';
import { BRAND } from '../../lib/brand.js';

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/play';
  const oauthFailed = params.get('oauth') === 'failed';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await session.login(login, password)) navigate(next);
  }

  return (
    <div style={{ maxWidth: 440, margin: '24px auto' }}>
      <Card>
        <p style={{ color: 'var(--muted)', margin: '0 0 4px', fontSize: 13 }}>{BRAND.APP_NAME}</p>
        <h1 className="font-display" style={{ margin: '0 0 12px' }}>Welcome back</h1>
        {oauthFailed && <p role="alert" style={{ color: 'var(--bad)' }}>Social sign-in failed — try again or use your password.</p>}
        <form onSubmit={submit}>
          <Field label="Username or email">
            <TextInput value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
          </Field>
          <Field label="Password">
            <div style={{ display: 'flex', gap: 8 }}>
              <TextInput
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <Button variant="ghost" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Button>
            </div>
          </Field>
          {session.error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{session.error}</p>}
          <Button type="submit" disabled={session.busy} style={{ width: '100%' }}>
            {session.busy ? 'Please wait…' : 'Log in'}
          </Button>
        </form>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button
            variant="ghost"
            disabled={session.busy}
            style={{ width: '100%' }}
            onClick={() => { void session.loginAsGuest().then((ok) => { if (ok) navigate(next); }); }}
          >
            Continue as guest
          </Button>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '8px 0 0', textAlign: 'center' }}>
          Guests play casual instantly — no rating. Register later to keep progress.
        </p>
        <OAuthButtons next={next} />
        <p style={{ textAlign: 'center', color: 'var(--muted)', margin: '14px 0 0' }}>
          <Link to="/forgot-password">Forgot password?</Link>
          {' · '}New here? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
        </p>
      </Card>
    </div>
  );
}
