/**
 * Password recovery: request link, then set a new password from the link.
 * The backend never reveals whether an address exists.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, TextInput } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.forgot(email);
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '24px auto' }}>
      <Card>
        <h1 className="font-display" style={{ margin: '0 0 8px' }}>Forgot password</h1>
        {sent ? (
          <p style={{ color: 'var(--muted)' }}>
            If that address exists, a reset link is on its way (valid 60 minutes).
            In local dev without SMTP, check the backend log for the link.
          </p>
        ) : (
          <form onSubmit={submit}>
            <Field label="Account email">
              <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Sending…' : 'Send reset link'}</Button>
          </form>
        )}
        <p style={{ textAlign: 'center', margin: '14px 0 0' }}><Link to="/login">Back to login</Link></p>
      </Card>
    </div>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '24px auto' }}>
      <Card>
        <h1 className="font-display" style={{ margin: '0 0 8px' }}>Set a new password</h1>
        {token === '' ? (
          <p role="alert" style={{ color: 'var(--bad)' }}>This link is missing its token. Request a fresh one.</p>
        ) : done ? (
          <p>Password updated. <Link to="/login">Log in with the new one.</Link></p>
        ) : (
          <form onSubmit={submit}>
            <Field label="New password (min 8 chars)">
              <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
            </Field>
            {error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
            <Button type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Saving…' : 'Save new password'}</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
