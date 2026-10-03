/**
 * Sign up: live availability + strength meter on a standalone page.
 * Email and username are checked against the server while you type.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AuthShell from '../../components/auth/AuthShell.js';
import OAuthButtons from '../../components/auth/OAuthButtons.js';
import { Button } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';
import { api } from '../../lib/api.js';

const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strength(password: string): { label: string; width: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { label: 'weak', width: '20%', color: 'var(--bad)' };
  if (score <= 3) return { label: 'fair', width: '55%', color: 'var(--warn)' };
  return { label: 'strong', width: '100%', color: 'var(--good)' };
}

type Availability = { email: 'idle' | 'free' | 'taken'; username: 'idle' | 'free' | 'taken' };

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [terms, setTerms] = useState(false);
  const [avail, setAvail] = useState<Availability>({ email: 'idle', username: 'idle' });
  const session = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/play';
  const meter = strength(password);
  const isGuest = session.user?.guest === true;

  const usernameCharsetOk = username.length === 0 || USERNAME_RE.test(username);
  const emailShapeOk = email.length === 0 || EMAIL_RE.test(email);

  const reqId = useRef(0);
  useEffect(() => {
    const cleanEmail = email.trim();
    const cleanUser = username.trim();
    if (!EMAIL_RE.test(cleanEmail) || cleanUser.length < 3 || !USERNAME_RE.test(cleanUser)) {
      setAvail({ email: 'idle', username: 'idle' });
      return;
    }
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      api.availability({ email: cleanEmail, username: cleanUser })
        .then((r) => {
          if (id !== reqId.current) return;
          setAvail({
            email: r.emailAvailable ? 'free' : 'taken',
            username: r.usernameAvailable ? 'free' : 'taken',
          });
        })
        .catch(() => { /* offline: register remains the judge */ });
    }, 350);
    return () => clearTimeout(timer);
  }, [email, username]);

  const blocked = useMemo(
    () => avail.email === 'taken' || avail.username === 'taken' || !usernameCharsetOk || !emailShapeOk,
    [avail, usernameCharsetOk, emailShapeOk],
  );

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!terms || blocked) return;
    if (isGuest) {
      if (await session.convertGuest(email.trim(), username.trim(), password)) navigate(next);
      return;
    }
    if (await session.register(email.trim(), username.trim(), password)) navigate(next);
  }

  return (
    <AuthShell
      title={isGuest ? 'Keep your progress' : 'Create account'}
      sub={isGuest ? `Playing as ${session.user?.username} — games carry over.` : 'Free forever. Rated games, puzzles, friends.'}
      foot={<>Have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Log in</Link></>}
    >
      <form onSubmit={submit}>
        <label style={labelStyle}>
          <span style={labelText}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            aria-invalid={!emailShapeOk || avail.email === 'taken'}
            style={{ ...inputStyle, borderColor: !emailShapeOk || avail.email === 'taken' ? 'var(--bad)' : undefined }}
          />
          <Hint tone={!emailShapeOk || avail.email === 'taken' ? 'bad' : avail.email === 'free' ? 'good' : 'muted'}>
            {!emailShapeOk ? 'Invalid email.'
              : avail.email === 'taken' ? 'Already registered.'
              : avail.email === 'free' ? 'Available.' : 'One account per email.'}
          </Hint>
        </label>
        <label style={labelStyle}>
          <span style={labelText}>Username</span>
          <input
            value={username}
            onChange={(e) => {
              const raw = e.target.value;
              setUsername(USERNAME_RE.test(raw) ? raw : raw.replace(/[^a-zA-Z0-9_]/g, ''));
            }}
            autoComplete="username"
            required
            minLength={3}
            maxLength={24}
            aria-invalid={!usernameCharsetOk || avail.username === 'taken'}
            style={{ ...inputStyle, borderColor: avail.username === 'taken' ? 'var(--bad)' : undefined }}
          />
          <Hint tone={avail.username === 'taken' ? 'bad' : avail.username === 'free' ? 'good' : 'muted'}>
            {avail.username === 'taken' ? 'Taken.'
              : avail.username === 'free' ? 'Available.' : 'Letters, digits, _ · 3–24.'}
          </Hint>
        </label>
        <label style={labelStyle}>
          <span style={labelText}>Password</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
              style={{ ...inputStyle, flex: 1 }}
            />
            <Button variant="ghost" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</Button>
          </div>
          {password.length > 0 && (
            <span style={{ display: 'block', marginTop: 6 }} aria-live="polite">
              <span style={{ display: 'block', height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <span style={{ display: 'block', width: meter.width, height: '100%', background: meter.color, transition: 'width var(--dur-med) ease' }} />
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{meter.label}</span>
            </span>
          )}
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, margin: '4px 0 14px' }}>
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I accept the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>.</span>
        </label>
        {session.error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{session.error}</p>}
        <Button type="submit" disabled={session.busy || !terms || blocked} style={{ width: '100%' }}>
          {session.busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <OAuthButtons next={next} />
    </AuthShell>
  );
}

function Hint({ tone, children }: { tone: 'good' | 'bad' | 'muted'; children: React.ReactNode }) {
  return (
    <span role="status" style={{
      display: 'block', marginTop: 5, fontSize: 12, fontWeight: 600,
      color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--muted)',
    }}>
      {children}
    </span>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600 };
const labelText: React.CSSProperties = { display: 'block', marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 15,
  border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)',
};
