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
  const [peer, setPeer] = useState<string | null>(null);

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

  return (    <div style={{ display: 'grid', gap: 16 }}>
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
                        <Button variant="ghost" onClick={() => setPeer(peer === f.username ? null : f.username)}>Message</Button>
                        <Button variant="subtle" onClick={() => { void api.friendBlock(f.username).then(load); }}>Block</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </Card>
          {peer !== null && <DmThread peer={peer} myId={user?.id ?? ''} onClose={() => setPeer(null)} />}
        </>
      )}
    </div>
  );
}

function DmThread({ peer, myId, onClose }: { peer: string; myId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<{ _id: string; userId: string; body: string; createdAt: string }[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.dmHistory(peer)
      .then((r) => setMessages(r.messages))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load messages'));
  }, [peer]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (draft.trim().length === 0) return;
    setError(null);
    try {
      await api.dmSend(peer, draft.trim());
      setDraft('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    }
  }

  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Messages · {peer}</h3>
        <span style={{ marginLeft: 'auto' }}>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </span>
      </div>
      <div aria-live="polite" style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto', marginBottom: 8 }}>
        {messages.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No messages yet — say hi.</p>}
        {messages.map((m) => (
          <p key={m._id} style={{ margin: 0, fontSize: 14 }}>
            <strong>{m.userId === myId ? 'You' : peer}</strong>{' '}
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{new Date(m.createdAt).toLocaleString()}</span>
            <br />{m.body}
          </p>
        ))}
      </div>
      {error !== null && <p role="alert" style={{ color: 'var(--bad)', fontSize: 13 }}>{error}</p>}
      <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
        <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Message…" aria-label="direct message" />
        <Button type="submit" variant="ghost">Send</Button>
      </form>
    </Card>
  );
}
