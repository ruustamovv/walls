/**
 * Dedicated signup window: benefits, strength meter, terms, OAuth.
 *
 * Email and username are checked against the server WHILE you type (debounced)
 * so "already taken" appears before submitting, and the charset rule for
 * usernames is enforced on every keystroke rather than at submit time.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import OAuthButtons from '../../components/auth/OAuthButtons.js';
import { Button, Card } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';
import { BRAND } from '../../lib/brand.js';
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

const PERKS = [
  'Rated games on every time control',
  'Glicko ratings, divisions & leaderboards',
  'Daily puzzles, streaks & personal training',
  'Friends, clubs & replays',
];

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

  // Charset rule, enforced live: letters, digits and underscore only.
  const usernameCharsetOk = username.length === 0 || USERNAME_RE.test(username);
  const emailShapeOk = email.length === 0 || EMAIL_RE.test(email);

  // Debounced availability probe. AbortController keeps a slow reply from
  // overwriting a newer one.
  const reqId = useRef(0);
  useEffect(() => {
    const cleanEmail = email.trim();
    const cleanUser = username.trim();
    if (!EMAIL_RE.test(cleanEmail) || cleanUser.length < 3 || !USERNAME_RE.test(cleanUser)) {
      setAvail((a) => ({ email: 'idle', username: 'idle' }));
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
    // Guests convert in place (same id → history preserved); others register.
    if (session.user?.guest === true) {
      if (await session.convertGuest(email.trim(), username.trim(), password)) navigate(next);
      return;
    }
    if (await session.register(email.trim(), username.trim(), password)) navigate(next);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 20, alignItems: 'start', maxWidth: 900, margin: '0 auto' }} className="nexus-auth-split">
      <div>
        <p style={{ color: 'var(--primary)', fontWeight: 800, letterSpacing: '.06em', fontSize: 13, margin: '8px 0' }}>JOIN {BRAND.APP_SHORT_NAME}</p>
        <h1 className="font-display" style={{ fontSize: 'var(--text-hero)', lineHeight: 1.05, margin: '0 0 12px' }}>
          Your arena awaits.
        </h1>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
          {PERKS.map((p) => (
            <li key={p} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 15 }}>
              <span aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--good-soft)', color: 'var(--good)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>✓</span>
              {p}
            </li>
          ))}
        </ul>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>
          Everything core is free, forever — every game mode, rating and puzzle.
        </p>
      </div>
      <Card>
        <h2 className="font-display" style={{ margin: '0 0 12px' }}>{session.user?.guest === true ? 'Keep your progress' : 'Create your account'}</h2>
        {session.user?.guest === true && (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 12px' }}>
            You're playing as {session.user.username}. Register now and your games carry over — same identity, no lost progress.
          </p>
        )}
        <form onSubmit={submit}>
          <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
            <span style={{ display: 'block', marginBottom: 6 }}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              aria-invalid={!emailShapeOk || avail.email === 'taken'}
              aria-describedby="email-hint"
              style={{ ...inputStyle, borderColor: !emailShapeOk || avail.email === 'taken' ? 'var(--bad)' : undefined }}
            />
            <FieldHint
              id="email-hint"
              tone={!emailShapeOk ? 'bad' : avail.email === 'taken' ? 'bad' : avail.email === 'free' ? 'good' : 'muted'}
            >
              {!emailShapeOk
                ? 'Enter a valid email address.'
                : avail.email === 'taken'
                  ? 'That email is already registered — each address can be used once.'
                  : avail.email === 'free'
                    ? 'Email is available.'
                    : 'One account per email address.'}
            </FieldHint>
          </label>
          <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
            <span style={{ display: 'block', marginBottom: 6 }}>Username</span>
            <input
              value={username}
              onChange={(e) => {
                // Reject illegal characters at the keystroke, so the field can
                // never hold anything outside letters / digits / underscore.
                const raw = e.target.value;
                const clean = USERNAME_RE.test(raw) ? raw : raw.replace(/[^a-zA-Z0-9_]/g, '');
                setUsername(clean);
              }}
              autoComplete="username"
              required
              minLength={3}
              maxLength={24}
              aria-invalid={!usernameCharsetOk || avail.username === 'taken'}
              aria-describedby="username-hint"
              style={{ ...inputStyle, borderColor: avail.username === 'taken' ? 'var(--bad)' : undefined }}
            />
            <FieldHint
              id="username-hint"
              tone={!usernameCharsetOk ? 'bad' : avail.username === 'taken' ? 'bad' : avail.username === 'free' ? 'good' : 'muted'}
            >
              {!usernameCharsetOk
                ? 'Letters, numbers and underscore only.'
                : avail.username === 'taken'
                  ? 'That username is taken.'
                  : avail.username === 'free'
                    ? 'Username is available.'
                    : 'Letters, numbers and _ only (3–24).'}
            </FieldHint>
          </label>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>
            <span style={{ display: 'block', marginBottom: 6 }}>Password</span>
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
          </label>
          {password.length > 0 && (
            <div style={{ marginBottom: 12 }} aria-live="polite">
              <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                <div style={{ width: meter.width, height: '100%', background: meter.color, transition: 'width var(--dur-med) ease' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Password strength: {meter.label}</div>
            </div>
          )}
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 12 }}>
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I accept the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy Policy</Link>, and I confirm fair play.</span>
          </label>
          {session.error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{session.error}</p>}
          <Button type="submit" disabled={session.busy || !terms || blocked} style={{ width: '100%' }}>
            {session.busy ? 'Creating…' : 'Create account'}
          </Button>
        </form>
        <OAuthButtons next={next} />
        <p style={{ textAlign: 'center', color: 'var(--muted)', margin: '14px 0 0' }}>
          Have an account? <Link to={`/login?next=${encodeURIComponent(next)}`}>Log in</Link>
        </p>
      </Card>
      <style>{`@media (max-width: 820px) { .nexus-auth-split { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}

function FieldHint({ id, tone, children }: { id: string; tone: 'good' | 'bad' | 'muted'; children: React.ReactNode }) {
  return (
    <span
      id={id}
      role="status"
      style={{
        display: 'block', marginTop: 5, fontSize: 12, fontWeight: 600,
        color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--muted)',
      }}
    >
      {children}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 15,
  border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)',
};
