/**
 * Quoridor search: players + instant 1v1 challenge.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { toast } from '../../stores/toasts.js';
import { Avatar, Button, Card, Spinner, TextInput } from '../../components/ui/primitives.js';
import { useSession } from '../../stores/session.js';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Record<string, string>>({});
  const { user } = useSession();

  useEffect(() => {
    const term = (params.get('q') ?? '').trim();
    setQ(term);
    if (term.length < 2) { setData(null); return; }
    setBusy(true);
    let live = true;
    api.search(term).then((r) => { if (live) { setData(r); setBusy(false); } }).catch(() => { if (live) { setData(null); setBusy(false); } });
    return () => { live = false; };
  }, [params]);

  async function challenge(username: string) {
    try {
      await api.challenge(username, '3+1', 'ranked');
      setSent((s) => ({ ...s, [username]: 'Sent!' }));
      toast('good', `Challenge sent to ${username}`);
    } catch (err) {
      setSent((s) => ({ ...s, [username]: err instanceof Error ? err.message : 'Failed' }));
      toast('bad', err instanceof Error ? err.message : 'Challenge failed');
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Search</h1>
      <form onSubmit={(e) => { e.preventDefault(); setParams(q.trim() === '' ? {} : { q: q.trim() }); }}>
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="username… (min 2)" aria-label="search" />
      </form>
      {busy ? <Spinner /> : data !== null && (
        <>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Players</h3>
            {data.players.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>No match.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {data.players.map((p) => (
                  <li key={p.username} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Avatar name={p.username} size={26} />
                    <Link to={`/profile/${encodeURIComponent(p.username)}`} style={{ fontWeight: 700 }}>{p.username}</Link>
                    {user !== null && user.username !== p.username && (
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                        {sent[p.username] !== undefined
                          ? <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sent[p.username]}</span>
                          : <Button size="sm" variant="ghost" onClick={() => void challenge(p.username)}>1v1</Button>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Clubs</h3>
            {data.clubs.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>—</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {data.clubs.map((c) => (<li key={c.id}><Link to={`/clubs/${c.id}`}>{c.name}</Link></li>))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
