/**
 * Clubs: browse, found, join, view roster, members-only chat.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, Field, Spinner, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';
import { useClubChat } from '../../hooks/useClubChat.js';

interface ClubEntry {
  club: { _id: string; name: string; description: string; ownerId: string };
  members: number;
}

export default function ClubsPage() {
  const { id } = useParams();
  return id === undefined ? <ClubsList /> : <ClubDetail id={id} />;
}

function ClubsList() {
  const { user } = useSession();
  const [clubs, setClubs] = useState<ClubEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.clubs()
      .then((r) => { setClubs(r.clubs); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'Failed to load clubs'); setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function found() {
    setError(null);
    try {
      await api.clubCreate(name.trim(), description.trim());
      setName('');
      setDescription('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Club creation failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Clubs</h1>
      {user !== null && (
        <Card>
          <h3 className="font-display" style={{ margin: '0 0 8px' }}>Found a club</h3>
          <Field label="Name (min 3 chars)">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          </Field>
          <Field label="Description">
            <TextInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          {error !== null && <p role="alert" style={{ color: 'var(--bad)' }}>{error}</p>}
          <Button onClick={found} disabled={name.trim().length < 3}>Create club</Button>
        </Card>
      )}
      {loading ? <Spinner /> : clubs.length === 0 ? (
        <Card><EmptyState title="No clubs yet" body="Found the first one and gather your rivals." /></Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
          {clubs.map(({ club, members }) => (
            <Card key={club._id}>
              <h3 className="font-display" style={{ margin: '0 0 4px' }}>
                <Link to={`/clubs/${club._id}`} style={{ textDecoration: 'none' }}>{club.name}</Link>
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 8px' }}>{club.description || 'No description.'}</p>
              <Badge tone="info">{members} member{members === 1 ? '' : 's'}</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ClubDetail({ id }: { id: string }) {
  const { user } = useSession();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.club>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.club(id)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Club not found'));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (error !== null) {
    return (
      <div>
        <Link to="/clubs" style={{ color: 'var(--muted)', fontSize: 14 }}>← Clubs</Link>
        <div style={{ marginTop: 16 }}><ErrorBox message={error} /></div>
      </div>
    );
  }
  if (data === null) return <Spinner />;

  const isMember = user !== null && data.members.some((m) => m.id === user.id);
  const isOwner = user !== null && data.club.ownerId === user.id;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Link to="/clubs" style={{ color: 'var(--muted)', fontSize: 14 }}>← Clubs</Link>
      <div>
        <h1 className="font-display" style={{ margin: '0 0 4px' }}>{data.club.name}</h1>
        <p style={{ color: 'var(--muted)', margin: 0 }}>{data.club.description || 'No description.'}</p>
      </div>
      {user !== null && !isMember && <div><Button onClick={() => { void api.clubJoin(id).then(load); }}>Join club</Button></div>}
      {user !== null && isMember && !isOwner && <div><Button variant="ghost" onClick={() => { void api.clubLeave(id).then(load); }}>Leave club</Button></div>}
      {user !== null && isMember && <ClubChatBox clubId={id} userId={user.id} members={data.members} />}
      <Card>
        <h3 className="font-display" style={{ margin: '0 0 8px' }}>Members ({data.members.length})</h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {data.members.map((m) => (
            <li key={m.id} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Avatar name={m.username} size={28} />
              <Link to={`/profile/${encodeURIComponent(m.username)}`} style={{ fontWeight: 700 }}>{m.username}</Link>
              <Badge tone={m.role === 'OWNER' ? 'warn' : m.role === 'ADMIN' ? 'info' : 'neutral'}>{m.role}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function ClubChatBox({ clubId, userId, members }: {
  clubId: string;
  userId: string;
  members: { id: string; username: string }[];
}) {
  const { messages, connected, send } = useClubChat(clubId, userId, true);
  const [draft, setDraft] = useState('');
  const nameOf = (id: string): string => members.find((m) => m.id === id)?.username ?? 'member';
  return (
    <Card>
      <h3 className="font-display" style={{ margin: '0 0 8px' }}>
        Club chat {!connected && <span style={{ color: 'var(--muted)', fontSize: 12 }}>(connecting…)</span>}
      </h3>
      <div aria-live="polite" style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
        {messages.length === 0 && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>No messages yet — say hi.</p>}
        {messages.map((m, i) => {
          const from = m.from ?? m.userId ?? '?';
          const at = m.at !== undefined ? new Date(m.at).toLocaleTimeString() : m.createdAt !== undefined ? new Date(m.createdAt).toLocaleTimeString() : '';
          return (
            <p key={m._id ?? m.id ?? i} style={{ margin: 0, fontSize: 14 }}>
              <strong>{from === userId ? 'you' : nameOf(from)}</strong>{' '}
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>{at}</span>
              <br />{m.body}
            </p>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim().length === 0) return;
          send(draft.trim());
          setDraft('');
        }}
        style={{ display: 'flex', gap: 8 }}
      >
        <TextInput value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500} placeholder="Message the club…" aria-label="club message" />
        <Button type="submit" variant="ghost">Send</Button>
      </form>
    </Card>
  );
}
