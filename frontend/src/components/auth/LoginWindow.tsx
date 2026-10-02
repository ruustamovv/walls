/**
 * Login window — a centred, self-contained dialog rendered WITHOUT the app
 * sidebar. Opened by the Login button, it floats over the current page with a
 * spring animation so the user never loses their place.
 *
 * Kept deliberately small: identity + password, guest entry, and a link to
 * the full signup page (which still carries the availability checks).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/primitives.js';
import { useSession } from '../../stores/session.js';
import { BRAND } from '../../lib/brand.js';
import { Logo } from '../ui/primitives.js';

export function LoginWindow({
  open,
  next,
  onClose,
}: {
  open: boolean;
  next: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const login = useSession((s) => s.login);
  const loginAsGuest = useSession((s) => s.loginAsGuest);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [entered, setEntered] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  // Open: reset, focus, and lock background scroll.
  useEffect(() => {
    if (!open) return;
    setEntered(false);
    setLoginId('');
    setPassword('');
    const t = setTimeout(() => firstField.current?.focus(), 240);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (loginId.trim().length === 0 || password.length === 0) {
        setEntered(true);
        return;
      }
      setEntered(true);
      const ok = await login(loginId.trim(), password);
      if (ok) {
        onClose();
        navigate(next);
      }
    },
    [login, loginId, password, navigate, next, onClose],
  );

  if (!open) return null;

  return (
    <div className="nexus-win-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="nexus-win"
        role="dialog"
        aria-modal="true"
        aria-label="Log in"
      >
        <div className="nexus-win-glow" aria-hidden />
        <header className="nexus-win-head">
          <Logo size={30} />
          <div>
            <div className="font-display" style={{ fontWeight: 800, fontSize: 19, lineHeight: 1.1 }}>
              Welcome back
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{BRAND.APP_NAME}</div>
          </div>
          <button className="nexus-win-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <form className="nexus-win-body" onSubmit={submit} noValidate>
          <label className="nexus-win-field">
            <span>Username or email</span>
            <input
              ref={firstField}
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              autoComplete="username"
              aria-invalid={entered && loginId.trim().length === 0}
            />
          </label>
          <label className="nexus-win-field">
            <span>Password</span>
            <span className="nexus-win-password">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-invalid={entered && password.length === 0}
              />
              <button type="button" onClick={() => setShow((s) => !s)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>

          {entered && (loginId.trim().length === 0 || password.length === 0) && (
            <p role="alert" className="nexus-win-error">Enter your username and password.</p>
          )}
          {error !== null && <p role="alert" className="nexus-win-error">{error}</p>}

          <Button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Log in'}
          </Button>

          <div className="nexus-win-or" aria-hidden>or</div>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            style={{ width: '100%' }}
            onClick={() => { void loginAsGuest().then((ok) => { if (ok) { onClose(); navigate(next); } }); }}
          >
            Continue as guest
          </Button>

          <p className="nexus-win-foot">
            New here?{' '}
            <button
              type="button"
              className="nexus-win-link"
              onClick={() => { onClose(); navigate(`/signup?next=${encodeURIComponent(next)}`); }}
            >
              Create an account
            </button>
          </p>
          <p className="nexus-win-note">Guests play casual instantly — no rating. Register later to keep progress.</p>
        </form>
      </div>
      <style>{LoginWindowStyles}</style>
    </div>
  );
}

const LoginWindowStyles = `
.nexus-win-scrim {
  position: fixed; inset: 0; z-index: 120;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, var(--ink) 55%, transparent);
  backdrop-filter: blur(6px);
  animation: nw-scrim .28s ease both;
}
@keyframes nw-scrim { from { opacity: 0; } to { opacity: 1; } }

.nexus-win {
  position: relative;
  width: min(420px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 30px 80px rgba(8,10,16,.32), 0 2px 0 rgba(255,255,255,.5) inset;
  overflow: hidden;
  animation: nw-window .52s cubic-bezier(.16,1.1,.3,1) both;
}
@keyframes nw-window {
  from { opacity: 0; transform: translateY(22px) scale(.9); }
  60%  { opacity: 1; transform: translateY(-3px) scale(1.012); }
  to   { opacity: 1; transform: none; }
}
.nexus-win-glow {
  position: absolute; inset: -40% -10% auto; height: 160px;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--primary) 26%, transparent), transparent);
  pointer-events: none;
  animation: nw-glow 1.1s ease-out .18s both;
}
@keyframes nw-glow { from { transform: translateY(-40px) scale(.7); opacity: 0; } to { transform: none; opacity: 1; } }

.nexus-win-head {
  position: relative; display: flex; gap: 12px; align-items: center;
  padding: 18px 20px 12px;
}
.nexus-win-x {
  margin-left: auto; background: none; border: none; color: var(--muted);
  font-size: 15px; line-height: 1; padding: 6px; border-radius: 8px;
  transition: background .2s ease, color .2s ease;
}
.nexus-win-x:hover { background: var(--surface-2); color: var(--ink); }

.nexus-win-body { position: relative; display: grid; gap: 12px; padding: 0 20px 20px; }
.nexus-win-field { display: grid; gap: 6px; font-size: 13px; font-weight: 700; color: var(--muted); }
.nexus-win-field input {
  width: 100%; padding: 11px 12px; font-size: 15px; font-weight: 400;
  border-radius: 12px; border: 1px solid var(--line);
  background: var(--surface-2); color: var(--ink);
  transition: border-color .2s ease, box-shadow .2s ease, background .2s ease;
}
.nexus-win-field input:focus {
  outline: none; border-color: var(--primary); background: var(--surface);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 16%, transparent);
}
.nexus-win-field input[aria-invalid="true"] { border-color: var(--bad); }
.nexus-win-password { position: relative; display: block; }
.nexus-win-password input { padding-right: 62px; }
.nexus-win-password button {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  background: none; border: none; color: var(--muted);
  font-size: 12px; font-weight: 800; padding: 6px 8px; border-radius: 8px;
}
.nexus-win-password button:hover { color: var(--ink); background: var(--surface); }
.nexus-win-error { margin: 0; color: var(--bad); font-size: 13px; font-weight: 600; }
.nexus-win-or { text-align: center; font-size: 11px; color: var(--muted); position: relative; }
.nexus-win-foot { margin: 0; text-align: center; font-size: 13px; color: var(--muted); }
.nexus-win-link {
  background: none; border: none; padding: 0; font: inherit; font-weight: 800;
  color: var(--primary); cursor: pointer; text-decoration: underline;
}
.nexus-win-note { margin: 0; text-align: center; font-size: 11px; color: var(--muted); }

@media (prefers-reduced-motion: reduce) {
  .nexus-win-scrim, .nexus-win, .nexus-win-glow { animation: none !important; }
  .nexus-win-field input, .nexus-win-x { transition: none !important; }
}
`;