/**
 * Global search: players, tournaments, clubs. Two characters minimum.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Avatar, Card, Spinner, TextInput } from '../../components/ui/primitives.js';

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [data, setData] = useState<Awaited<ReturnType<typeof api.search>> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = (params.get('q') ?? '').trim();
    setQ(term);
    if (term.length < 2) {
      setData(null);
      return;
    }
    setBusy(true);
    let live = true;
    api.search(term)
      .then((r) => { if (live) { setData(r); setBusy(false); } })
      .catch(() => { if (live) { setData(null); setBusy(false); } });
    return () => { live = false; };
  }, [params]);

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <h1 className="font-display" style={{ margin: 0 }}>Search</h1>
      <form onSubmit={(e) => { e.preventDefault(); setParams(q.trim() === '' ? {} : { q: q.trim() }); }}>
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="players, tournaments, clubs… (min 2 chars)"
          aria-label="search"
        />
      </form>
      {busy ? <Spinner /> : data !== null && (
        <>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Players</h3>
            {data.players.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>No players match.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {data.players.map((p) => (
                  <li key={p.username} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Avatar name={p.username} size={26} />
                    <Link to={`/profile/${encodeURIComponent(p.username)}`} style={{ fontWeight: 700 }}>{p.username}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Tournaments</h3>
            {data.tournaments.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>No tournaments match.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {data.tournaments.map((t) => (
                  <li key={t.id}><Link to={`/tournaments/${t.id}`} style={{ fontWeight: 700 }}>{t.title}</Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-display" style={{ margin: '0 0 8px' }}>Clubs</h3>
            {data.clubs.length === 0 ? <p style={{ color: 'var(--muted)', margin: 0 }}>No clubs match.</p> : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                {data.clubs.map((c) => (
                  <li key={c.id}><Link to={`/clubs/${c.id}`} style={{ fontWeight: 700 }}>{c.name}</Link></li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
