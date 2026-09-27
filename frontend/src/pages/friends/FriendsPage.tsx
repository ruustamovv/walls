/**
 * Friends: requests, roster with presence, challenges, blocks.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Badge, Button, Card, EmptyState, Field, Spinner, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';

export default function FriendsPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<{ id: string; username: string; online: boolean }[]>([]);
  const [requests, setRequests] = useState<{ id: string; from: string }[]>([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api.friends(), api.friendRequests(), api.heartbeat().catch(() => ({ ok: false }))])
      .then(([f, r]) => {
        setFriends(f.friends);
        setRequests(r.requests);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setMessage(err instanceof Error ? err.message : 'Failed to load friends');
        setLoading(false);
      });
  }, []);

  useEffect(() => { if (user !== null) load(); }, [user, load]);

  if (user === null) {
    return <EmptyState title="Friends need an account" body="Log in to add rivals and challenge them." action={<Link to="/login?next=/friends">Log in</Link>} />;
  }

  async function send() {
    setMessage(null);
    try {
      const res = await api.friendRequest(name.trim());
      setMessage(`Request sent to ${res.to}.`);
      setName('');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Request failed');
    }
  }

  async function challenge(opponentId: string) {
    try {
      const g = await api.createGame({ opponentId });
      navigate(`/game/${g.id}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Challenge failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={{ margin: 0 }}>Friends</h1>
      {message !== null && <p role="status" style={{ color: 'var(--muted)' }}>{message}</p>}
      <Card>
        <h3 style={{ margin: '0 0 8px' }}>Add a friend</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label="Username">
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="rival42" />
            </Field>
          </div>
          <div style={{ alignSelf: 'end', paddingBottom: 12 }}>
            <Button onClick={send} disabled={name.trim().length < 3}>Send request</Button>
          </div>
        </div>
      </Card>
      {loading ? <Spinner /> : (
        <>
          {requests.length > 0 && (
            <Card>
              <h3 style={{ margin: '0 0 8px' }}>Pending requests</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {requests.map((r) => (
                  <li key={r.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <strong>{r.from}</strong>
                    <Button variant="ghost" onClick={() => { void api.friendAccept(r.id).then(load); }}>Accept</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <h3 style={{ margin: '0 0 8px' }}>Your rivals ({friends.length})</h3>
            {friends.length === 0
              ? <p style={{ color: 'var(--muted)', margin: 0 }}>No friends yet — challenge the bots or add someone above.</p>
              : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {friends.map((f) => (
                    <li key={f.id} style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                      <Link to={`/profile/${encodeURIComponent(f.username)}`} style={{ fontWeight: 700 }}>{f.username}</Link>
                      <Badge tone={f.online ? 'good' : 'neutral'}>{f.online ? 'online' : 'offline'}</Badge>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        <Button variant="ghost" onClick={() => void challenge(f.id)}>Challenge</Button>
                        <Button variant="subtle" onClick={() => { void api.friendBlock(f.username).then(load); }}>Block</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
        </>
      )}
    </div>
  );
}
