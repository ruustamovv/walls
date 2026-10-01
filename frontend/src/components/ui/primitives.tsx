/**
 * Quoridor design-system primitives — every visual variant lives here.
 * All color comes from theme.css variables (both themes supported).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { divisionFor, GLYPH } from '../../lib/brand.js';

/* ── Brand mark ─────────────────────────────────────────── */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox={GLYPH.viewBox} aria-hidden style={{ display: 'block', flexShrink: 0 }}>
      {GLYPH.pawns.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={10} height={10} rx={2.5} fill={p.fill} />
      ))}
      {GLYPH.walls.map((w, i) => (
        <rect key={`w${i}`} x={w.x} y={w.y} width={w.w} height={w.h} rx={2} fill="var(--wall)" />
      ))}
    </svg>
  );
}

/* ── Buttons ────────────────────────────────────────────── */
type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BTN_BASE: CSSProperties = {
  borderRadius: 'var(--radius-md)',
  fontWeight: 700,
  border: '1px solid var(--line)',
  fontFamily: 'var(--font-display)',
  letterSpacing: '.01em',
  transition: 'transform var(--dur-fast) ease, box-shadow var(--dur-med) ease, background var(--dur-med) ease',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

const BTN_SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { padding: '6px 12px', fontSize: 13 },
  md: { padding: '10px 18px', fontSize: 15 },
  lg: { padding: '14px 26px', fontSize: 17 },
};

const BTN_VARIANTS: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--primary)', borderColor: 'var(--primary)', color: 'var(--primary-ink)', boxShadow: '0 2px 10px rgba(26,86,219,.28)' },
  ghost: { background: 'var(--surface)', color: 'var(--ink)' },
  subtle: { background: 'var(--surface-2)', color: 'var(--ink)', borderColor: 'transparent' },
  danger: { background: 'var(--bad)', borderColor: 'var(--bad)', color: '#fff' },
};

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled, loading, type = 'button', title, style }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  style?: CSSProperties;
}) {
  const off = disabled === true || loading === true;
  return (
    <button
      type={type}
      disabled={off}
      title={title}
      onClick={onClick}
      style={{ ...BTN_BASE, ...BTN_SIZES[size], ...BTN_VARIANTS[variant], opacity: off ? 0.55 : 1, ...style }}
    >
      {loading === true && <span aria-hidden style={{ animation: 'nexus-pulse 1s infinite' }}>●</span>}
      {children}
    </button>
  );
}

/* ── Surfaces ───────────────────────────────────────────── */
export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-4)', boxShadow: 'var(--shadow-card)', ...style,
    }}>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 'var(--text-tiny)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div className="font-display" style={{ fontSize: 'var(--text-h1)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub !== undefined && <div style={{ color: 'var(--muted)', fontSize: 'var(--text-small)' }}>{sub}</div>}
    </div>
  );
}

/* ── Forms ──────────────────────────────────────────────── */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--space-3)', fontSize: 'var(--text-small)', fontWeight: 600 }}>
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
        width: '100%', padding: '10px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-body)',
        border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', ...props.style,
      }}
    />
  );
}

/* ── Identity ───────────────────────────────────────────── */
function sigilHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** Generated geometric avatar — deterministic per name, no assets. */
export function Avatar({ name, size = 36, frame }: { name: string; size?: number; frame?: string }) {
  const hue = sigilHue(name);
  const initial = name.slice(0, 1).toUpperCase();
  return (
    <span aria-hidden style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `conic-gradient(from 40deg, hsl(${hue} 55% 45%), hsl(${(hue + 70) % 360} 60% 40%), hsl(${hue} 55% 45%))`,
      color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.45, fontFamily: 'var(--font-display)',
      boxShadow: frameToShadow(frame),
    }}>
      {initial}
    </span>
  );
}

const FRAME_SHADOWS: Record<string, string> = {
  'frame-bronze': 'inset 0 0 0 2px #b45309, 0 0 10px rgba(180,83,9,.45)',
  'frame-silver': 'inset 0 0 0 2px #9aa4b5, 0 0 10px rgba(154,164,180,.45)',
  'frame-gold': 'inset 0 0 0 2px #d97706, 0 0 14px rgba(217,119,6,.55)',
  'frame-diamond': 'inset 0 0 0 2px #38bdf8, 0 0 14px rgba(56,189,248,.55)',
  'frame-apex': 'inset 0 0 0 2px #a78bfa, 0 0 16px rgba(167,139,250,.65)',
};

function frameToShadow(frame: string | undefined): string {
  if (frame !== undefined && FRAME_SHADOWS[frame] !== undefined) return FRAME_SHADOWS[frame] as string;
  return 'inset 0 0 0 2px rgba(255,255,255,.25)';
}

export function DivisionBadge({ rating }: { rating: number }) {
  const d = divisionFor(rating);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-tiny)', fontWeight: 700,
      borderRadius: 'var(--radius-pill)', padding: '3px 10px',
      background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--line)',
    }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: d.color }} />
      {d.name} · <span className="font-mono">{rating}</span>
    </span>
  );
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
      display: 'inline-block', fontSize: 'var(--text-tiny)', fontWeight: 700, borderRadius: 'var(--radius-pill)',
      padding: '3px 10px', ...(tones[tone] ?? {}),
    }}>
      {children}
    </span>
  );
}

/* ── Feedback ───────────────────────────────────────────── */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span role="status" style={{ color: 'var(--muted)', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span aria-hidden style={{ display: 'inline-flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', animation: `nexus-pulse 1s ${i * 0.18}s infinite` }} />
        ))}
      </span>
      {label}
    </span>
  );
}

export function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: string | number }) {
  return (
    <div aria-hidden style={{
      width, height, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)',
      animation: 'nexus-pulse 1.4s ease-in-out infinite',
    }} />
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ background: 'var(--bad-soft)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}>
      <strong>Something went wrong.</strong>
      <p style={{ margin: '6px 0 0', fontSize: 'var(--text-small)' }}>{message}</p>
      {onRetry !== undefined && <div style={{ marginTop: 10 }}><Button variant="ghost" size="sm" onClick={onRetry}>Retry</Button></div>}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-6) var(--space-4)', color: 'var(--muted)' }}>
      <Logo size={40} />
      <h3 className="font-display" style={{ color: 'var(--ink)', margin: '12px 0 6px' }}>{title}</h3>
      <p style={{ margin: '0 0 14px' }}>{body}</p>
      {action}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = (): void => {
    setClosing(true);
    setTimeout(onClose, 120);
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={close}
      onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(8,10,16,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)',
        animation: closing ? undefined : 'nexus-fade var(--dur-med) ease', opacity: closing ? 0 : 1,
        transition: 'opacity 120ms ease',
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', maxWidth: 480, width: '100%',
        boxShadow: 'var(--shadow-pop)', animation: 'nexus-pop var(--dur-med) ease', position: 'relative',
      }}>
        <button
          onClick={close}
          aria-label="Close dialog"
          style={{ position: 'absolute', top: 12, right: 12, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-pill)', width: 30, height: 30, color: 'var(--muted)' }}
        >
          ✕
        </button>
        <h2 className="font-display" style={{ margin: '0 0 12px', paddingRight: 32 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: readonly T[]; active: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          style={{
            borderRadius: 'var(--radius-pill)', padding: '7px 14px', fontWeight: 700, fontSize: 'var(--text-small)',
            textTransform: 'capitalize', fontFamily: 'var(--font-display)',
            border: active === t ? '2px solid var(--primary)' : '1px solid var(--line)',
            background: active === t ? 'var(--primary-soft)' : 'var(--surface)', color: 'var(--ink)',
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* ── Quoridor additions: categories, move badges, eval ── */

export function Segmented<T extends string>({ options, active, onChange, ariaLabel }: {
  options: readonly T[]; active: T; onChange: (t: T) => void; ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel ?? 'options'} style={{
      display: 'inline-flex', gap: 4, background: 'var(--surface-2)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-pill)', padding: 4,
    }}>
      {options.map((o) => (
        <button key={o} role="tab" aria-selected={active === o} onClick={() => onChange(o)} style={{
          border: 'none', borderRadius: 'var(--radius-pill)', padding: '7px 14px', fontWeight: 800,
          fontSize: 13, fontFamily: 'var(--font-display)', textTransform: 'capitalize',
          background: active === o ? 'var(--surface)' : 'transparent',
          color: active === o ? 'var(--ink)' : 'var(--muted)',
          boxShadow: active === o ? 'var(--shadow-card)' : 'none',
        }}>{o}</button>
      ))}
    </div>
  );
}

const MOVE_META: Record<string, { symbol: string; bg: string; fg: string; label: string }> = {
  BRILLIANT: { symbol: '!!', bg: 'var(--brilliant)', fg: '#fff', label: 'Brilliant' },
  GREAT: { symbol: '!', bg: 'var(--great)', fg: '#fff', label: 'Great' },
  BEST: { symbol: '★', bg: 'var(--good)', fg: '#fff', label: 'Best' },
  EXCELLENT: { symbol: '+', bg: 'var(--good-soft)', fg: 'var(--good)', label: 'Excellent' },
  GOOD: { symbol: '✓', bg: 'var(--surface-2)', fg: 'var(--muted)', label: 'Good' },
  BOOK: { symbol: 'Bk', bg: 'var(--surface-2)', fg: 'var(--muted)', label: 'Book' },
  INACCURACY: { symbol: '?!', bg: 'var(--warn-soft)', fg: 'var(--warn)', label: 'Inaccuracy' },
  MISTAKE: { symbol: '?', bg: 'var(--warn-soft)', fg: 'var(--warn)', label: 'Mistake' },
  MISS: { symbol: '×', bg: 'var(--bad-soft)', fg: 'var(--bad)', label: 'Miss' },
  BLUNDER: { symbol: '??', bg: 'var(--bad)', fg: '#fff', label: 'Blunder' },
  GREAT_WALL: { symbol: 'W!', bg: 'var(--great)', fg: '#fff', label: 'Great wall' },
  WALL_BLUNDER: { symbol: 'W?', bg: 'var(--bad-soft)', fg: 'var(--bad)', label: 'Wall blunder' },
  PATH_BLUNDER: { symbol: 'P?', bg: 'var(--bad-soft)', fg: 'var(--bad)', label: 'Path blunder' },
  TEMPO_LOSS: { symbol: '◷', bg: 'var(--warn-soft)', fg: 'var(--warn)', label: 'Tempo loss' },
  MISSED_CHOKE: { symbol: '◎', bg: 'var(--warn-soft)', fg: 'var(--warn)', label: 'Missed choke' },
  CLUTCH: { symbol: '♛', bg: 'var(--gold)', fg: '#fff', label: 'Clutch' },
};

export function MoveBadge({ kind, size = 22 }: { kind: string; size?: number }) {
  const m = MOVE_META[kind] ?? MOVE_META.GOOD!;
  return (
    <span title={m.label} aria-label={m.label} style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', background: m.bg, color: m.fg, fontSize: size * 0.42, fontWeight: 900,
      fontFamily: 'var(--font-mono)', flexShrink: 0, boxShadow: 'var(--shadow-card)',
    }}>{m.symbol}</span>
  );
}

export function EvalBar({ whitePct, label }: { whitePct: number; label?: string }) {
  const pct = Math.min(100, Math.max(0, whitePct));
  return (
    <div aria-label={label ?? `Win chance ${pct.toFixed(1)}%`} title={label ?? `${pct.toFixed(1)}%`} style={{
      width: 30, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)',
      background: '#0a0b16', display: 'flex', flexDirection: 'column', minHeight: 280,
    }}>
      <div style={{ flex: `${100 - pct} 1 0%`, background: '#0a0b16', transition: 'flex .3s ease', minHeight: pct >= 100 ? 0 : 4 }} />
      <div style={{
        flex: `${pct} 1 0%`, background: 'linear-gradient(180deg,#fff,#e8e2d4)', transition: 'flex .3s ease',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', minHeight: pct <= 0 ? 0 : 18,
      }}>
        <span className="font-mono" style={{ fontSize: 10, fontWeight: 800, color: '#13122e', paddingBottom: 3 }}>{pct.toFixed(0)}</span>
      </div>
    </div>
  );
}
