/**
 * Deterministic replay viewer: reconstructs every position from the
 * recorded action list with the real engine. Play / pause / step / scrub.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { applyMove, createGame } from '../../../../engine/typescript/index.js';
import type { GameState } from '../../../../engine/typescript/core/types.js';
import GameBoard from '../../components/game/GameBoard.js';
import MoveList from '../../components/game/MoveList.js';
import { Button, Card, ErrorBox, Spinner } from '../../components/ui/primitives.js';
import { api } from '../../lib/api.js';
import { exportGame } from '../../lib/export.js';
import { useTheme } from '../../hooks/useTheme.js';

export default function ReplayPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.replay>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Seat 0 renders at the bottom by default (same rule as live games).
  const [flipped, setFlipped] = useState(false);
  useTheme('arena');

  // Keyboard: ←/→ step, space toggles play.
  useEffect(() => {
    if (data === null) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        setPlaying(false);
        setPly((p) => Math.max(0, p - 1));
      } else if (e.key === 'ArrowRight') {
        setPlaying(false);
        setPly((p) => Math.min(data.actions.length, p + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data === null]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setPly(0);
    setPlaying(false);
    api.replay(id)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Replay not found'); });
    return () => { cancelled = true; };
  }, [id]);

  const states = useMemo<GameState[]>(() => {
    if (data === null) return [];
    const out: GameState[] = [createGame({ size: data.initialState.size, wallsPerPlayer: data.initialState.wallsPerPlayer })];
    for (const a of data.actions) {
      try {
        const prev = out[out.length - 1];
        if (prev === undefined) break;
        out.push(applyMove(prev, a).state);
      } catch {
        break;
      }
    }
    return out;
  }, [data]);

  useEffect(() => {
    if (!playing || data === null) return;
    if (ply >= data.actions.length) {
      setPlaying(false);
      return;
    }
    const ms = Math.max(150, 900 / speed);
    const t = setTimeout(() => setPly((p) => Math.min(p + 1, data.actions.length)), ms);
    return () => clearTimeout(t);
  }, [playing, ply, data, speed]);

  if (error !== null) {
    return (
      <div>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <div style={{ marginTop: 16 }}><ErrorBox message={error} /></div>
      </div>
    );
  }
  if (data === null || states.length === 0) {
    return (
      <div>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <div style={{ marginTop: 16 }}><Spinner /></div>
      </div>
    );
  }

  const state = states[Math.min(ply, states.length - 1)] as GameState;
  const actions = data.actions.slice(0, ply);

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <Link to="/play" style={{ color: 'var(--muted)', fontSize: 14 }}>← Lobby</Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>Replay</h1>
        {data.result?.winnerSeat !== null && data.result !== null && (
          <span style={{ color: 'var(--muted)', fontSize: 14 }}>
            Player {data.result.winnerSeat + 1} wins ({data.result.reason})
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 16, alignItems: 'start' }} className="nexus-game-layout">
        <div style={{ maxWidth: 640 }}>
          <div style={!flipped ? { transform: 'rotate(180deg)' } : undefined}>
            <GameBoard
              state={state}
              humanSeats={[]}
              interactive={false}
              onMove={() => undefined}
              onWall={() => undefined}
              lastAction={state.lastAction}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => setFlipped((f) => !f)} title="Flip board">Flip</Button>
            <Button variant="ghost" onClick={() => setPly(0)}>⏮</Button>
            <Button variant="ghost" onClick={() => { setPlaying(false); setPly((p) => Math.max(0, p - 1)); }}>◀</Button>
            <Button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</Button>
            <Button variant="ghost" onClick={() => { setPlaying(false); setPly((p) => Math.min(data.actions.length, p + 1)); }}>▶</Button>
            <Button variant="ghost" onClick={() => setPly(data.actions.length)}>⏭</Button>
            <label style={{ fontSize: 13, color: 'var(--muted)' }}>
              Speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ marginLeft: 6 }}>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </select>
            </label>
            <span style={{ fontSize: 14, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {ply}/{data.actions.length}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={data.actions.length}
            value={ply}
            onChange={(e) => { setPlaying(false); setPly(Number(e.target.value)); }}
            aria-label="replay timeline"
            style={{ width: '100%', marginTop: 8 }}
          />
        </div>
        <Card>
          <h3 style={{ margin: '0 0 8px' }}>Moves</h3>
          <MoveList
            actions={actions}
            size={data.initialState.size}
            ply={ply}
            onSeek={(p) => { setPlaying(false); setPly(p); }}
            onExport={() => exportGame(data.gameId, { actions: data.actions, size: data.initialState.size, result: data.result })}
          />
          <div style={{ marginTop: 12 }}>
            <Link to={`/game/${encodeURIComponent(id)}`} style={{ fontSize: 14 }}>Open live game view</Link>
          </div>
        </Card>
      </div>
      <style>{`@media (max-width: 900px) { .nexus-game-layout { grid-template-columns: minmax(0,1fr) !important; } }`}</style>
    </div>
  );
}
