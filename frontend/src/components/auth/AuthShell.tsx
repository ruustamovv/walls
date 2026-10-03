/**
 * Standalone auth frame: centered card on the themed backdrop, no sidebar.
 * Used by /login and /signup (App renders those routes bare).
 */
import { Link } from 'react-router-dom';
import { Logo } from '../ui/primitives.js';
import { BRAND } from '../../lib/brand.js';

export default function AuthShell({ title, sub, children, foot }: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 16px', width: '100%', animation: 'nexus-fade .3s ease',
    }}>
      <Link to="/" style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', marginBottom: 20 }}>
        <Logo size={34} />
        <span className="font-display" style={{ fontWeight: 800, fontSize: 22 }}>{BRAND.APP_SHORT_NAME}</span>
      </Link>
      <div style={{
        width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)', padding: '28px 26px', boxShadow: 'var(--shadow-pop)',
      }}>
        <h1 className="font-display" style={{ margin: '0 0 4px', fontSize: 24 }}>{title}</h1>
        {sub !== undefined && <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 18px' }}>{sub}</p>}
        {children}
        {foot !== undefined && (
          <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, margin: '16px 0 0' }}>{foot}</p>
        )}
      </div>
    </div>
  );
}
