/**
 * Player settings: theme, sound, board coordinates.Persisted locally.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card, Tabs, TextInput } from '../../components/ui/primitives.js';
import { setThemeNow } from '../../hooks/useTheme.js';
import { useSettings, type BoardTheme, type LangChoice, type PawnSet, type ThemeChoice } from '../../stores/settings.js';
import { playSound } from '../../lib/sound.js';
import { api } from '../../lib/api.js';
import { useSession } from '../../stores/session.js';

function Row({ label, body, control }: { label: string; body: string; control: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}>
      <div>
        <strong>{label}</strong>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '4px 0 0' }}>{body}</p>
      </div>
      {control}
    </div>
  );
}

function Toggle({ on, onFlip, label }: { on: boolean; onFlip: () => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onFlip}
      style={{
        width: 52, height: 30, borderRadius: 999, border: '1px solid var(--line)',
        background: on ? 'var(--primary)' : 'var(--surface-2)', position: 'relative', flexShrink: 0,
      }}
    >
      <span aria-hidden style={{
        position: 'absolute', top: 3, left: on ? 24 : 4, width: 22, height: 22,
        borderRadius: '50%', background: '#fff', transition: 'left var(--dur-fast) ease',
        boxShadow: '0 1px 3px rgba(0,0,0,.3)',
      }} />
    </button>
  );
}

const THEMES: ThemeChoice[] = ['auto', 'site', 'arena'];

const BOARD_THEMES: BoardTheme[] = ['midnight', 'paper', 'ember'];
const PAWN_SETS: PawnSet[] = ['classic', 'ring'];

export default function SettingsPage() {
  const {
    theme, sound, volume, showCoords, boardTheme, pawnSet, confirmWall, language,
    setTheme, setSound, setVolume, setShowCoords, setBoardTheme, setPawnSet, setConfirmWall, setLanguage,
  } = useSettings();
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Settings</h1>
      <Card>
        <h3 className="font-display" style={{ margin: '0 0 4px' }}>Appearance & sound</h3>
        <Row
          label="Theme"
          body="Auto follows the route: light site, dark arena."
          control={<Tabs tabs={THEMES} active={theme} onChange={(t) => { setTheme(t); setThemeNow(t === 'auto' ? 'site' : t); }} />}
        />
        <Row
          label="Sound effects"
          body="Move hops, wall plunks, clocks and results. Fully mutable."
          control={<Toggle on={sound} onFlip={() => { setSound(!sound); if (!sound) setTimeout(() => playSound('notify'), 50); }} label="Sound effects" />}
        />
        <Row
          label="Volume"
          body="Master game-sound level."
          control={
            <input
              type="range" min={0} max={100} value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="sound volume" style={{ width: 160 }}
            />
          }
        />
        <Row
          label="Board theme"
          body="Arena felt for every board."
          control={<Tabs tabs={BOARD_THEMES} active={boardTheme} onChange={setBoardTheme} />}
        />
        <Row
          label="Pawn set"
          body="Classic discs or hollow rings."
          control={<Tabs tabs={PAWN_SETS} active={pawnSet} onChange={setPawnSet} />}
        />
        <Row
          label="Confirm walls"
          body="Two-tap wall placement — safer on touch screens."
          control={<Toggle on={confirmWall} onFlip={() => setConfirmWall(!confirmWall)} label="Confirm walls" />}
        />
        <Row
          label="Board coordinates"
          body="Show file/rank hints on hover titles (full coordinate labels arrive with the analysis board)."
          control={<Toggle on={showCoords} onFlip={() => setShowCoords(!showCoords)} label="Board coordinates" />}
        />
      </Card>
      <Card>
        <h3 className="font-display" style={{ margin: '0 0 4px' }}>Language</h3>
        <Tabs tabs={(['en', 'ru', 'uz'] as LangChoice[])} active={language} onChange={setLanguage} />
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 0 0' }}>
          Shell navigation is translated; game content stays English-first for now.
        </p>
      </Card>
      <AccountCard />
      <Card>
        <h3 className="font-display" style={{ margin: '0 0 4px' }}>Keyboard shortcuts</h3>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, display: 'grid', gap: 4, color: 'var(--muted)' }}>
          <li><Kbd>←</Kbd> / <Kbd>→</Kbd> step through replays</li>
          <li><Kbd>Space</Kbd> play / pause a replay</li>
          <li><Kbd>Esc</Kbd> close any dialog</li>
          <li><Kbd>Tab</Kbd> reach every board cell and wall groove</li>
        </ul>
      </Card>
      <Card>
        <h3 className="font-display" style={{ margin: '0 0 4px' }}>Accessibility</h3>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: 0 }}>
          The app honors your OS reduced-motion setting everywhere. All dialogs close with Escape.
          Board cells expose screen-reader labels; a full text-move list accompanies every game.
        </p>
      </Card>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      background: 'var(--surface-2)', border: '1px solid var(--line)', borderBottomWidth: 2,
      borderRadius: 6, padding: '1px 7px', fontFamily: 'var(--font-mono)', fontSize: 12,
    }}>
      {children}
    </kbd>
  );
}

function AccountCard() {
  const { user, logout } = useSession();
  const [prefs, setPrefs] = useState<{
    showRating: boolean; allowChallenges: boolean; chatScope: string;
    notifyMatches: boolean; notifyResults: boolean;
  } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (user === null) return;
    api.accountSettings().then(setPrefs).catch(() => setPrefs(null));
  }, [user === null]);

  if (user === null) {
    return (
      <Card>
        <h3 className="font-display" style={{ margin: '0 0 4px' }}>Account</h3>
        <p style={{ color: 'var(--muted)', margin: 0 }}><Link to="/login">Log in</Link> to manage privacy and security.</p>
      </Card>
    );
  }

  async function save(patch: Record<string, unknown>) {
    try {
      const updated = await api.accountSettingsSave(patch);
      setPrefs(updated);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <Card>
      <h3 className="font-display" style={{ margin: '0 0 4px' }}>Account & privacy</h3>
      {prefs !== null && (
        <>
          <Row
            label="Public ratings"
            body="Off hides your ratings from other players' views."
            control={<Toggle on={prefs.showRating} onFlip={() => void save({ showRating: !prefs.showRating })} label="Public ratings" />}
          />
          <Row
            label="Challenges"
            body="Off declines all direct game challenges."
            control={<Toggle on={prefs.allowChallenges} onFlip={() => void save({ allowChallenges: !prefs.allowChallenges })} label="Challenges" />}
          />
          <Row
            label="Who can chat with me"
            body="Friends-only restricts game chat to befriended opponents."
            control={<Tabs tabs={(['everyone', 'friends', 'nobody'] as const)} active={prefs.chatScope as 'everyone' | 'friends' | 'nobody'} onChange={(v) => void save({ chatScope: v })} />}
          />
          <Row
            label="Match notifications"
            body="Inbox ping when matchmaking pairs you."
            control={<Toggle on={prefs.notifyMatches} onFlip={() => void save({ notifyMatches: !prefs.notifyMatches })} label="Match notifications" />}
          />
          <Row
            label="Result notifications"
            body="Inbox ping when your games finish."
            control={<Toggle on={prefs.notifyResults} onFlip={() => void save({ notifyResults: !prefs.notifyResults })} label="Result notifications" />}
          />
        </>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          api.passwordChange(current, next).then(
            () => { setMsg('Password updated.'); setCurrent(''); setNext(''); },
            (err: unknown) => setMsg(err instanceof Error ? err.message : 'Update failed'),
          );
        }}
        style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 12 }}
      >
        <strong>Change password</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <TextInput type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current" autoComplete="current-password" style={{ flex: '1 1 160px' }} aria-label="current password" />
          <TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New (min 8)" autoComplete="new-password" style={{ flex: '1 1 160px' }} aria-label="new password" />
          <Button type="submit" variant="ghost" disabled={current === '' || next.length < 8}>Update</Button>
        </div>
      </form>
      {msg !== null && <p role="status" style={{ color: 'var(--muted)', fontSize: 13 }}>{msg}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Button
          variant="ghost"
          onClick={() => {
            void api.logoutAll().then(() => logout().then(() => navigate('/')));
          }}
        >
          Log out everywhere
        </Button>
        {confirmDelete ? (
          <>
            <Button
              variant="danger"
              onClick={() => {
                void api.deleteAccount().then(() => logout().then(() => navigate('/')));
              }}
            >
              Confirm: close my account
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          </>
        ) : (
          <Button variant="subtle" onClick={() => setConfirmDelete(true)}>Close account…</Button>
        )}
      </div>
    </Card>
  );
}
