/**
 * App shell: brand nav, session bootstrap, route map.
 */
import { useEffect } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import HomePage from '../pages/home/HomePage.js';
import LoginPage from '../pages/login/LoginPage.js';
import LobbyPage from '../pages/lobby/LobbyPage.js';
import PlayPage from '../pages/play/PlayPage.js';
import LocalGamePage from '../pages/play/LocalGamePage.js';
import GamePage from '../pages/game/GamePage.js';
import ProfilePage from '../pages/profile/ProfilePage.js';
import BotsPage from '../pages/bots/BotsPage.js';
import LeaderboardPage from '../pages/leaderboard/LeaderboardPage.js';
import WatchPage from '../pages/watch/WatchPage.js';
import { BRAND } from '../lib/brand.js';
import { useSession } from '../stores/session.js';

function Nav() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const link = { textDecoration: 'none', fontSize: 15 } as const;
  return (
    <header style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)', position: 'sticky', top: 0, zIndex: 50 }}>
      <nav style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 20px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }} aria-label="Primary">
        <Link to="/" style={{ fontWeight: 800, letterSpacing: '.02em', textDecoration: 'none' }}>
          {BRAND.APP_SHORT_NAME}
          {BRAND.PROVISIONAL && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}> beta</span>}
        </Link>
        <Link to="/play" style={link}>Play</Link>
        <Link to="/bots" style={link}>Bots</Link>
        <Link to="/leaderboard" style={link}>Leaderboard</Link>
        <Link to="/watch" style={link}>Watch</Link>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          {user === null ? (
            <Link to="/login" style={link}>Login</Link>
          ) : (
            <>
              <Link to="/profile/me" style={{ ...link, fontWeight: 700 }}>{user.username}</Link>
              <button
                onClick={() => { void logout().then(() => navigate('/')); }}
                style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 14 }}
              >
                Logout
              </button>
            </>
          )}
        </span>
      </nav>
    </header>
  );
}

export default function App() {
  const refresh = useSession((s) => s.refresh);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Nav />
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 20, width: '100%', flex: 1 }}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/lobby" element={<LobbyPage />} />
          <Route path="/play" element={<PlayPage />} />
          <Route path="/play/local" element={<LocalGamePage />} />
          <Route path="/play/bot" element={<LocalGamePage />} />
          <Route path="/game/:id" element={<GamePage />} />
          <Route path="/bots" element={<BotsPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/watch" element={<WatchPage />} />
          <Route path="/profile/:id" element={<ProfilePage />} />
          <Route path="*" element={<div><h1>404</h1><p>Arena not found. <Link to="/">Go home</Link></p></div>} />
        </Routes>
      </main>
      <footer style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)', fontSize: 13 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '12px 20px' }}>
          {BRAND.APP_NAME} — original wall-and-pawn strategy platform. No affiliation with any existing product.
        </div>
      </footer>
    </div>
  );
}
