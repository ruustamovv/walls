/**
 * App shell: persistent sidebar (desktop), top bar + drawer (tablet),
 * bottom tabs (mobile), session bootstrap, route map.
 */
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui/primitives.js';

const HomePage = lazy(() => import('../pages/home/HomePage.js'));
const LoginPage = lazy(() => import('../pages/login/LoginPage.js'));
const SignupPage = lazy(() => import('../pages/login/SignupPage.js'));
const ForgotPage = lazy(() => import('../pages/login/ForgotPage.js').then((m) => ({ default: m.ForgotPage })));
const ResetPage = lazy(() => import('../pages/login/ForgotPage.js').then((m) => ({ default: m.ResetPage })));
const VerifyPage = lazy(() => import('../pages/login/ForgotPage.js').then((m) => ({ default: m.VerifyPage })));
const LobbyPage = lazy(() => import('../pages/lobby/LobbyPage.js'));
const PlayPage = lazy(() => import('../pages/play/PlayPage.js'));
const LocalGamePage = lazy(() => import('../pages/play/LocalGamePage.js'));
const MultiGamePage = lazy(() => import('../pages/play/MultiGamePage.js'));
const GamePage = lazy(() => import('../pages/game/GamePage.js'));
const ReplayPage = lazy(() => import('../pages/replay/ReplayPage.js'));
const PuzzlesPage = lazy(() => import('../pages/puzzles/PuzzlesPage.js'));
const RushPage = lazy(() => import('../pages/rush/RushPage.js'));
const LearnPage = lazy(() => import('../pages/learn/LearnPage.js'));
const DesignerPage = lazy(() => import('../pages/designer/DesignerPage.js'));
const TrainingPage = lazy(() => import('../pages/training/TrainingPage.js'));
const FriendsPage = lazy(() => import('../pages/friends/FriendsPage.js'));
const ClubsPage = lazy(() => import('../pages/clubs/ClubsPage.js'));
const TournamentsPage = lazy(() => import('../pages/tournaments/TournamentsPage.js'));
const PremiumPage = lazy(() => import('../pages/premium/PremiumPage.js'));
const ProfilePage = lazy(() => import('../pages/profile/ProfilePage.js'));
import { useLocation } from 'react-router-dom';
const NotificationsPage = lazy(() => import('../pages/notifications/NotificationsPage.js'));
const SearchPage = lazy(() => import('../pages/search/SearchPage.js'));
const TermsPage = lazy(() => import('../pages/legal/LegalPages.js').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('../pages/legal/LegalPages.js').then((m) => ({ default: m.PrivacyPage })));
const FairPlayPage = lazy(() => import('../pages/legal/LegalPages.js').then((m) => ({ default: m.FairPlayPage })));
const BotsPage = lazy(() => import('../pages/bots/BotsPage.js'));
const NemesisPage = lazy(() => import('../pages/nemesis/NemesisPage.js'));
const LeaderboardPage = lazy(() => import('../pages/leaderboard/LeaderboardPage.js'));
const WatchPage = lazy(() => import('../pages/watch/WatchPage.js'));
const SettingsPage = lazy(() => import('../pages/settings/SettingsPage.js'));
import { BRAND } from '../lib/brand.js';
import { useT } from '../lib/i18n.js';
import { useSession } from '../stores/session.js';
import { useSettings } from '../stores/settings.js';
import { Avatar, Logo } from '../components/ui/primitives.js';
import { DevTodoDrawer } from '../components/dev/DevTodoDrawer.js';
import { useToasts } from '../stores/toasts.js';

function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div aria-live="polite" style={{ position: 'fixed', bottom: 18, right: 14, zIndex: 95, display: 'grid', gap: 8, width: 'min(340px, calc(100vw - 28px))' }}>
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          style={{
            textAlign: 'left', background: 'var(--surface)', color: 'var(--ink)',
            border: '1px solid var(--line)', borderLeft: `4px solid ${t.kind === 'good' ? 'var(--good)' : t.kind === 'bad' ? 'var(--bad)' : 'var(--primary)'}`,
            borderRadius: 'var(--radius-md)', padding: '10px 12px', fontSize: 13, fontWeight: 600,
            boxShadow: 'var(--shadow-pop)', cursor: 'pointer',
          }}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden style={{ flexShrink: 0 }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PATHS = {
  play: 'M10 2l8 8-8 8V2zM4 4h2v12H4z',
  bots: 'M10 3a7 7 0 017 7v1h1a1 1 0 011 1v3a1 1 0 01-1 1h-1a7 7 0 01-14 0H2a1 1 0 01-1-1v-3a1 1 0 011-1h1V10a7 7 0 017-7zm-2.5 6.5A1.5 1.5 0 109 11a1.5 1.5 0 00-1.5-1.5zm5 0A1.5 1.5 0 1014 11a1.5 1.5 0 00-1.5-1.5zM8 14h4v1.5H8z',
  puzzles: 'M9 2h6v4h4v6h-4v2h-2v4H7v-4H3V8h4V2h2zm0 2v4H5v4h4v2h2v-2h4V8h-4V4H9z',
  board: 'M3 3h14v14H3zM3 8h14M3 13h14M8 3v14M13 3v14',
  watch: 'M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zm8 2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  friends: 'M10 8a3 3 0 100-6 3 3 0 000 6zm-7 9c0-3.5 3-6 7-6s7 2.5 7 6v1H3v-1z',
  clubs: 'M10 2l7 3v6c0 4-3 6.8-7 7-4-.2-7-3-7-7V5l7-3zm0 2.2L5 6v5c0 3 2.2 5 5 5.4 2.8-.4 5-2.4 5-5.4V6l-5-1.8zm-3 5h6v2H7V9zm1 3h4v4H8v-4z',
  trophy: 'M7 3h6v2h4v2c0 3.5-2.5 5.8-5 6.3V15h2v3H6v-3h2v-1.7C5.5 12.8 3 10.5 3 7V5h4V3zm-2 4H4v1c0 1.8 1 3.2 2.3 3.8L6 7zm8 0v4.8c1.3-.6 2.3-2 2.3-3.8V7H13z',
  training: 'M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 110 12 6 6 0 010-12zm0 2a4 4 0 100 8 4 4 0 000-8zm0 3l2.5 2.5-1.4 1.4L10 11.8l-1.1 1.1-1.4-1.4L10 9z',
  gem: 'M10 2l7 5-7 11L3 7l7-5zm0 2.3L5 7.5 10 15l5-7.5-5-3.2zM3 7h14',
  settings: 'M10 7a3 3 0 100 6 3 3 0 000-6zm8 3a8 8 0 01-.2 1.7l2 1.6-2 3.4-2.4-.9a8 8 0 01-2.9 1.7L12 20h-4l-.5-2.5a8 8 0 01-2.9-1.7l-2.4.9-2-3.4 2-1.6A8 8 0 012 10V8l2.2-.3 1-2.1L4 4l2-3 2 1.4 2-1V0h4v1.4l2 1-2-1.4 2 3-1.2 1.6 1 2.1L18 8v2z',
  admin: 'M10 2l7 3v6c0 4-3 6.5-7 7-4-.5-7-3-7-7V5z',
} as const;

interface NavItem {
  to: string;
  label: string;
  i18n: string;
  icon: keyof typeof PATHS;
  adminOnly?: boolean;
  authOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { to: '/play', label: 'Play', i18n: 'play', icon: 'play' },
  { to: '/bots', label: 'Bots', i18n: 'bots', icon: 'bots' },
  { to: '/puzzles', label: 'Puzzles', i18n: 'puzzles', icon: 'puzzles' },
  { to: '/learn', label: 'Learn', i18n: 'learn', icon: 'training' },
  { to: '/leaderboard', label: 'Ranks', i18n: 'ranks', icon: 'board' },
  { to: '/watch', label: 'Watch', i18n: 'watch', icon: 'watch' },
  { to: '/friends', label: 'Friends', i18n: 'friends', icon: 'friends', authOnly: true },
  { to: '/clubs', label: 'Clubs', i18n: 'clubs', icon: 'clubs', authOnly: true },
  { to: '/tournaments', label: 'Cups', i18n: 'cups', icon: 'trophy' },
  { to: '/premium', label: 'Premium', i18n: 'premium', icon: 'gem' },
  { to: '/settings', label: 'Settings', i18n: 'settings', icon: 'settings' },
];

const MOBILE_TABS: NavItem[] = [
  { to: '/play', label: 'Play', i18n: 'play', icon: 'play' },
  { to: '/puzzles', label: 'Puzzles', i18n: 'puzzles', icon: 'puzzles' },
  { to: '/training', label: 'Training', i18n: 'training', icon: 'training', authOnly: true },
  { to: '/watch', label: 'Watch', i18n: 'watch', icon: 'watch' },
  { to: '/settings', label: 'More', i18n: 'settings', icon: 'settings' },
];

function useIsAdmin(): boolean {
  const user = useSession((s) => s.user);
  const role = user?.role ?? 'user';
  return role === 'admin' || role === 'moderator' || role === 'owner';
}

function itemStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', gap: 12, alignItems: 'center', textDecoration: 'none',
    padding: '10px 14px', borderRadius: 'var(--radius-md)', fontWeight: active ? 800 : 500,
    background: active ? 'var(--primary-soft)' : 'transparent', color: 'var(--ink)',
  };
}

function useUnread(): number {
  const user = useSession((s) => s.user);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (user === null) {
      setUnread(0);
      return;
    }
    let live = true;
    const pull = (): void => {
      void import('../lib/api.js').then(({ api }) => {
        api.notifications().then((r) => { if (live) setUnread(r.unread); }).catch(() => undefined);
      });
    };
    pull();
    const id = setInterval(pull, 60000);
    return () => { live = false; clearInterval(id); };
  }, [user === null]);
  return unread;
}

function Sidebar() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const t = useT();
  const isAdmin = useIsAdmin();
  const unread = useUnread();
  const collapsed = useSettings((s) => s.navCollapsed);
  const setCollapsed = useSettings((s) => s.setNavCollapsed);
  // Guests see the public shelf; account features prompt registration (SHL-006).
  const isGuest = user?.guest === true;
  const visible = ITEMS.filter((i) => (!i.adminOnly || isAdmin) && (!i.authOnly || (user !== null && !isGuest)));
  return (
    <aside className="nexus-sidebar" style={{
      width: collapsed ? 76 : 248, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--surface)',
      position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', padding: 'var(--space-4)',
      transition: 'width var(--dur-med) ease',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <Link to="/" style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', flex: 1, minWidth: 0 }} aria-label={BRAND.APP_NAME}>
          <Logo size={32} />
          {!collapsed && (
            <span className="font-display" style={{ fontWeight: 700, fontSize: 20, letterSpacing: '.02em' }}>
              {BRAND.APP_SHORT_NAME}
            </span>
          )}
        </Link>
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, width: 28, height: 28, color: 'var(--muted)', flexShrink: 0 }}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>
      <nav aria-label="Primary" style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {visible.map((i) => (
          <NavLink key={i.to} to={i.to} title={collapsed ? t(i.i18n) : undefined} style={({ isActive }) => itemStyle(isActive)}>
            <Icon d={PATHS[i.icon]} />{!collapsed && t(i.i18n)}
          </NavLink>
        ))}
        {user !== null && (
          <>
            <NavLink to="/notifications" title={collapsed ? 'Inbox' : undefined} style={({ isActive }) => itemStyle(isActive)}>
              <Icon d="M6 16v-5a4 4 0 018 0v5l1.5 2.5h-11zM8.5 19a1.5 1.5 0 003 0" />
              {!collapsed && 'Inbox'}
              {unread > 0 && (
                <span aria-label={`${unread} unread`} style={{ marginLeft: collapsed ? 0 : 'auto', background: 'var(--primary)', color: 'var(--primary-ink)', borderRadius: 999, fontSize: 11, fontWeight: 800, padding: '1px 7px' }}>
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </NavLink>
            <NavLink to="/search" title={collapsed ? 'Search' : undefined} style={({ isActive }) => itemStyle(isActive)}>
              <Icon d="M9 3a6 6 0 104.2 10.3L18 18l1.5-1.5-4.6-4.6A6 6 0 009 3zm0 2a4 4 0 110 8 4 4 0 010-8z" />
              {!collapsed && 'Search'}
            </NavLink>
          </>
        )}
      </nav>
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--space-3)' }}>
        {user === null ? (
          collapsed
            ? <Link to="/login" title={t('login')} aria-label={t('login')} style={{ ...itemStyle(false), justifyContent: 'center' }}><Icon d="M10 3a7 7 0 017 7v1h1a1 1 0 011 1v3a1 1 0 01-1 1h-1a7 7 0 01-14 0H2a1 1 0 01-1-1v-3a1 1 0 011-1h1V10a7 7 0 017-7z" /></Link>
            : <Link to="/login" style={{ ...itemStyle(false), fontWeight: 700 }}>{t('login')}</Link>
        ) : isGuest ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {!collapsed && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Guest — progress not saved</span>}
            <Link to="/signup?next=/play" style={{ ...itemStyle(false), fontWeight: 700, justifyContent: collapsed ? 'center' : undefined }} title="Create an account">
              <Icon d="M10 3a7 7 0 017 7v1h1a1 1 0 011 1v3a1 1 0 01-1 1h-1a7 7 0 01-14 0H2a1 1 0 01-1-1v-3a1 1 0 011-1h1V10a7 7 0 017-7z" />{!collapsed && 'Register'}
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link to="/profile/me" title={collapsed ? user.username : undefined} style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', fontWeight: 700, flex: 1, minWidth: 0, justifyContent: collapsed ? 'center' : undefined }}>
              <Avatar name={user.username} size={30} />
              {!collapsed && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.username}</span>}
            </Link>
            {!collapsed && (
              <button
                onClick={() => { void logout().then(() => navigate('/')); }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13 }}
              >
                {t('logout')}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user } = useSession();
  const t = useT();
  return (
    <header className="nexus-topbar" style={{
      borderBottom: '1px solid var(--line)', background: 'var(--surface)',
      position: 'sticky', top: 0, zIndex: 50, display: 'none',
    }}>
      <nav style={{ padding: '10px 16px', display: 'flex', gap: 12, alignItems: 'center' }} aria-label="Primary">
        <button onClick={onMenu} aria-label="Open menu" style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', color: 'var(--ink)' }}>☰</button>
        <Link to="/" style={{ display: 'flex', gap: 8, alignItems: 'center', textDecoration: 'none' }}>
          <Logo size={26} />
          <span className="font-display" style={{ fontWeight: 700, fontSize: 17 }}>{BRAND.APP_SHORT_NAME}</span>
        </Link>
        <span style={{ marginLeft: 'auto' }}>
          {user === null ? (
            <Link to="/login" style={{ fontSize: 14 }}>{t('login')}</Link>
          ) : (
            <Link to="/profile/me" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>
              <Avatar name={user.username} size={24} />{user.username}
            </Link>
          )}
        </span>
      </nav>
    </header>
  );
}

function BottomTabs() {
  const { user } = useSession();
  const t = useT();
  const isAdmin = useIsAdmin();
  const visible = MOBILE_TABS.filter((i) => (!i.adminOnly || isAdmin) && (!i.authOnly || (user !== null && user.guest !== true)));
  return (
    <nav className="nexus-tabs" aria-label="Primary" style={{
      display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
      background: 'var(--surface)', borderTop: '1px solid var(--line)',
      padding: '6px 4px calc(6px + env(safe-area-inset-bottom))',
    }}>
      {visible.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          style={({ isActive }) => ({
            flex: 1, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center',
            textDecoration: 'none', fontSize: 11, fontWeight: isActive ? 800 : 500,
            color: isActive ? 'var(--primary)' : 'var(--muted)', padding: '4px 0',
          })}
        >
          <Icon d={PATHS[i.icon]} />{t(i.i18n)}
        </NavLink>
      ))}
    </nav>
  );
}

function Broadcast() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof import('../lib/api.js').api.announcements>>['announcements']>([]);
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('nexus-dismissed') ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    let live = true;
    void import('../lib/api.js').then(({ api }) => {
      api.announcements().then((r) => { if (live) setItems(r.announcements); }).catch(() => undefined);
    });
    return () => { live = false; };
  }, []);
  const visible = items.filter((a) => !dismissed.includes(a._id));
  if (visible.length === 0) return null;
  const dismiss = (id: string): void => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      localStorage.setItem('nexus-dismissed', JSON.stringify(next));
    } catch {
      // private mode
    }
  };
  return (
    <div style={{ position: 'fixed', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 80, display: 'grid', gap: 8, width: 'min(560px, calc(100vw - 32px))' }}>
      {visible.map((a) => (
        <div key={a._id} role="status" style={{ background: 'var(--surface)', border: '1px solid var(--primary)', borderRadius: 12, padding: '10px 14px', boxShadow: 'var(--shadow-pop)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <strong>{a.title}</strong>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--muted)' }}>{a.body}</p>
          </div>
          <button onClick={() => dismiss(a._id)} aria-label="Dismiss announcement" style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 16 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

/** The console moved out: staff work happens in the standalone admin app. */
function AdminMoved() {
  return (
    <div style={{ maxWidth: 560 }}>
      <h1 className="font-display">Admin console moved</h1>
      <p style={{ color: 'var(--muted)' }}>
        Staff tools now run as a separate app at <code>http://localhost:5174</code> (same
        backend, own folder <code>admin/</code>). Start it with <code>pnpm dev:admin</code>.
      </p>
    </div>
  );
}

function Telemetry() {
  const location = useLocation();
  const user = useSession((s) => s.user);
  useEffect(() => {
    if (user === null) return;
    void import('../lib/api.js').then(({ api }) => {
      api.track('page_view', { path: location.pathname }).catch(() => undefined);
    });
  }, [location.pathname, user === null]);
  return null;
}

export default function App() {
  const refresh = useSession((s) => s.refresh);
  const t = useT();
  const me = useSession((s) => s.user);
  const amAdmin = useIsAdmin();
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (me === null) return;
    void import('../lib/api.js').then(({ api }) => {
      api.heartbeat().catch(() => undefined);
    });
    const id = setInterval(() => {
      void import('../lib/api.js').then(({ api }) => {
        api.heartbeat().catch(() => undefined);
      });
    }, 90000);
    return () => clearInterval(id);
  }, [me === null]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      <a
        href="#main"
        style={{
          position: 'absolute', left: -9999, top: 0, zIndex: 100,
          background: 'var(--surface)', color: 'var(--ink)', padding: '8px 14px',
        }}
        onFocus={(e) => { (e.target as HTMLElement).style.left = '8px'; }}
        onBlur={(e) => { (e.target as HTMLElement).style.left = '-9999px'; }}
      >
        Skip to content
      </a>
      <Telemetry />
      <Broadcast />
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar onMenu={() => setDrawer(true)} />
        <main id="main" style={{ maxWidth: 1280, margin: '0 auto', padding: 20, width: '100%', flex: 1, paddingBottom: 90 }} className="nexus-main">
          <Suspense fallback={<div style={{ padding: 24 }}><Spinner /></div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/forgot-password" element={<ForgotPage />} />
            <Route path="/reset-password" element={<ResetPage />} />
            <Route path="/verify-email" element={<VerifyPage />} />
            <Route path="/lobby" element={<LobbyPage />} />
            <Route path="/play" element={<PlayPage />} />
          <Route path="/play/local" element={<LocalGamePage />} />
          <Route path="/play/bot" element={<LocalGamePage />} />
          <Route path="/play/multi" element={<MultiGamePage />} />
            <Route path="/game/:id" element={<GamePage />} />
            <Route path="/replay/:id" element={<ReplayPage />} />
            <Route path="/puzzles" element={<PuzzlesPage />} />
            <Route path="/rush" element={<RushPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/designer" element={<DesignerPage />} />
          <Route path="/rush" element={<RushPage />} />
          <Route path="/training" element={<TrainingPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/clubs" element={<ClubsPage />} />
            <Route path="/clubs/:id" element={<ClubsPage />} />
            <Route path="/tournaments" element={<TournamentsPage />} />
            <Route path="/tournaments/:id" element={<TournamentsPage />} />
            <Route path="/premium" element={<PremiumPage />} />
            <Route path="/admin" element={<AdminMoved />} />
            <Route path="/bots" element={<BotsPage />} />
          <Route path="/nemesis" element={<NemesisPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/watch" element={<WatchPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile/:id" element={<ProfilePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/fair-play" element={<FairPlayPage />} />
            <Route path="*" element={<div><h1>404</h1><p>Arena not found. <Link to="/">Go home</Link></p></div>} />
          </Routes>
          </Suspense>
        </main>
      </div>
      <BottomTabs />
      <Toaster />
      <DevTodoDrawer />
      {drawer && (
        <div role="dialog" aria-label="Menu" onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(8,10,16,.5)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 280, height: '100%', background: 'var(--surface)', padding: 'var(--space-4)', overflowY: 'auto' }}>
            <Link to="/" onClick={() => setDrawer(false)} style={{ display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', marginBottom: 'var(--space-4)' }}>
              <Logo size={30} />
              <span className="font-display" style={{ fontWeight: 700, fontSize: 19 }}>{BRAND.APP_SHORT_NAME}</span>
            </Link>
            <nav aria-label="Drawer" style={{ display: 'flex', flexDirection: 'column', gap: 2 }} onClick={() => setDrawer(false)}>
              {ITEMS.filter((i) => (!i.adminOnly || amAdmin) && (!i.authOnly || (me !== null && me.guest !== true))).map((i) => (
                <NavLink key={i.to} to={i.to} style={({ isActive }) => itemStyle(isActive)}>
                  <Icon d={PATHS[i.icon]} />{t(i.i18n)}
                </NavLink>
              ))}
            </nav>
          </div>
        </div>
      )}
      <style>{`
        @media (max-width: 1023px) {
          .nexus-sidebar { display: none !important; }
          .nexus-topbar { display: block !important; }
        }
        @media (max-width: 640px) {
          .nexus-tabs { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
