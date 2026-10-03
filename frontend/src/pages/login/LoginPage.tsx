/**
 * Log in: lean credential form on a standalone page (no sidebar).
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell.js';
import OAuthButtons from '../../components/auth/OAuthButtons.js';
import { Button, Field, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';

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
    <AuthShell
      title="Welcome back"
      foot={<>New here? <Link to={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
    >
      {oauthFailed && <p role="alert" style={{ color: 'var(--bad)', marginTop: 0 }}>Social sign-in failed — try again.</p>}
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
      <Button
        variant="ghost"
        disabled={session.busy}
        style={{ width: '100%', marginTop: 8 }}
        onClick={() => { void session.loginAsGuest().then((ok) => { if (ok) navigate(next); }); }}
      >
        Continue as guest
      </Button>
      <OAuthButtons next={next} />
      <p style={{ textAlign: 'center', margin: '12px 0 0' }}>
        <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--muted)' }}>Forgot password?</Link>
      </p>
    </AuthShell>
  );
}
