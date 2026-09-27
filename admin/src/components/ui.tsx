/**
 * Admin console primitives — ops-room styling, independent of player UI.
 */
import type { CSSProperties, ReactNode } from 'react';

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', padding: 16, ...style,
    }}>
      {children}
    </section>
  );
}

export function H({ children }: { children: ReactNode }) {
  return <h2 style={{ margin: '0 0 12px', fontSize: 18, fontFamily: 'var(--font-display)' }}>{children}</h2>;
}

export function Button({ children, onClick, kind = 'primary', size = 'md', disabled, type = 'button' }: {
  children: ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const base: CSSProperties = {
    borderRadius: 8, fontWeight: 700, border: '1px solid var(--line)',
    padding: size === 'sm' ? '5px 10px' : '9px 16px',
    fontSize: size === 'sm' ? 13 : 14, opacity: disabled ? 0.5 : 1,
  };
  const kinds: Record<string, CSSProperties> = {
    primary: { background: 'var(--primary)', borderColor: 'var(--primary)', color: 'var(--primary-ink)' },
    ghost: { background: 'transparent', color: 'var(--ink)' },
    danger: { background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' },
  };
  return <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...kinds[kind] }}>{children}</button>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }) {
  const tones: Record<string, CSSProperties> = {
    neutral: { background: 'var(--surface-2)', color: 'var(--muted)' },
    good: { background: 'var(--good-soft)', color: 'var(--good)' },
    bad: { background: 'var(--bad-soft)', color: 'var(--bad)' },
    warn: { background: 'var(--warn-soft)', color: 'var(--warn)' },
    info: { background: 'var(--primary-soft)', color: 'var(--primary)' },
  };
  return (
    <span style={{
      display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 999,
      padding: '2px 9px', ...(tones[tone] ?? {}),
    }}>
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
      <span style={{ display: 'block', marginBottom: 6, color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%', padding: '9px 11px', borderRadius: 8, fontSize: 14,
        border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)', ...props.style,
      }}
    />
  );
}

export function Spinner() {
  return <span role="status" style={{ color: 'var(--muted)' }}>Loading…</span>;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
      <strong style={{ color: 'var(--ink)' }}>{title}</strong>
      <p style={{ margin: '6px 0 0' }}>{body}</p>
    </div>
  );
}
