/**
 * Social login buttons — rendered only for configured providers.
 * Nothing renders when no OAuth keys exist (never fake buttons).
 */
import { useEffect, useState } from 'react';

export default function OAuthButtons({ next }: { next: string }) {
  const [providers, setProviders] = useState<{ google: boolean; github: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/v1/auth/oauth/status')
      .then((r) => r.json())
      .then((s: { google?: boolean; github?: boolean }) => {
        if (live) setProviders({ google: s.google === true, github: s.github === true });
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  if (providers === null) return null;
  const shown = (Object.keys(providers) as ('google' | 'github')[]).filter((p) => providers[p]);
  if (shown.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
        <span style={{ flex: 1, borderTop: '1px solid var(--line)' }} />
        or continue with
        <span style={{ flex: 1, borderTop: '1px solid var(--line)' }} />
      </div>
      {shown.map((p) => (
        <a
          key={p}
          href={`/api/v1/auth/oauth/${p}?next=${encodeURIComponent(next)}`}
          style={{
            display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px',
            fontWeight: 700, textDecoration: 'none', background: 'var(--surface)',
          }}
        >
          <span aria-hidden style={{
            width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
            background: p === 'google' ? 'conic-gradient(#4285F4,#EA4335,#FBBC05,#34A853,#4285F4)' : 'var(--ink)',
            color: '#fff', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {p === 'google' ? 'G' : 'GH'}
          </span>
          Continue with {p === 'google' ? 'Google' : 'GitHub'}
        </a>
      ))}
    </div>
  );
}
