/**
 * Minimal design-system primitives (tokens in styles/tokens.css).
 * Keep variants centralized here — no ad-hoc button styles in pages.
 */
import type { CSSProperties, ReactNode } from 'react';

export function Button({ children, onClick, variant = 'primary', disabled, type = 'button', style }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  disabled?: boolean;
  type?: 'button' | 'submit';
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    borderRadius: 10,
    padding: '10px 18px',
    fontWeight: 700,
    fontSize: 15,
    border: '1px solid var(--line)',
    transition: 'transform .08s ease, box-shadow .15s ease, background .15s ease',
    opacity: disabled ? 0.55 : 1,
  };
  const variants: Record<string, CSSProperties> = {
    primary: { background: 'var(--primary)', borderColor: 'var(--primary)', color: '#fff', boxShadow: '0 2px 8px rgba(26,86,219,.25)' },
    ghost: { background: '#fff', color: 'var(--ink)' },
    subtle: { background: 'var(--bg)', color: 'var(--ink)' },
    danger: { background: '#dc2626', borderColor: '#dc2626', color: '#fff' },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{ ...base, ...(variants[variant] ?? {}), ...style }}
    >
      {children}
    </button>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14,
      padding: 18, boxShadow: '0 1px 3px rgba(16,20,24,.06)', ...style,
    }}>
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600 }}>
      <span style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 10, fontSize: 15,
        border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', ...props.style,
      }}
    />
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }) {
  const tones: Record<string, CSSProperties> = {
    neutral: { background: 'var(--bg)', color: 'var(--muted)' },
    good: { background: '#e7f6ec', color: '#15803d' },
    bad: { background: '#fdecec', color: '#b91c1c' },
    warn: { background: '#fef6e7', color: '#b45309' },
    info: { background: '#e8effd', color: '#1a56db' },
  };
  return (
    <span style={{
      display: 'inline-block', fontSize: 12, fontWeight: 700, borderRadius: 999,
      padding: '3px 10px', ...(tones[tone] ?? {}),
    }}>
      {children}
    </span>
  );
}

export function Spinner() {
  return <span role="status" aria-label="loading" style={{ color: 'var(--muted)' }}>Loading…</span>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ background: '#fdecec', border: '1px solid #f3c2c2', borderRadius: 12, padding: 14 }}>
      <strong>Something went wrong.</strong>
      <p style={{ margin: '6px 0 0', color: '#7f1d1d', fontSize: 14 }}>{message}</p>
      {onRetry !== undefined && <div style={{ marginTop: 10 }}><Button variant="ghost" onClick={onRetry}>Retry</Button></div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--muted)' }}>
      <h3 style={{ color: 'var(--ink)', margin: '0 0 6px' }}>{title}</h3>
      <p style={{ margin: '0 0 14px' }}>{body}</p>
      {action}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(16,20,24,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        animation: 'nexus-fade .18s ease',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, padding: 24, maxWidth: 480, width: '100%',
        boxShadow: '0 20px 60px rgba(16,20,24,.25)', animation: 'nexus-pop .18s ease',
      }}>
        <h2 style={{ margin: '0 0 12px' }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
