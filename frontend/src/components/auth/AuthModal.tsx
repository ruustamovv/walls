/**
 * Auth modal: real application dialog for auth-gated actions (quick match
 * as a visitor, challenging from search). Offers login, guest, register.
 */
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '../ui/primitives.js';
import { useSession } from '../../stores/session.js';

export function AuthModal({ onClose, next }: { onClose: () => void; next: string }) {
  const navigate = useNavigate();
  const loginAsGuest = useSession((s) => s.loginAsGuest);
  const busy = useSession((s) => s.busy);
  return (
    <Modal title="Join the arena" onClose={onClose}>
      <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 14 }}>
        Log in for rated games, or jump in as a guest — casual, no rating, keepable later.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        <Button onClick={() => { onClose(); navigate(`/login?next=${encodeURIComponent(next)}`); }}>Log in</Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => { void loginAsGuest().then((ok) => { if (ok) onClose(); }); }}
        >
          Continue as guest
        </Button>
        <Button variant="subtle" onClick={() => { onClose(); navigate(`/signup?next=${encodeURIComponent(next)}`); }}>
          Create an account
        </Button>
      </div>
    </Modal>
  );
}
