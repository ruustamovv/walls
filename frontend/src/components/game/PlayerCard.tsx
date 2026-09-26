/**
 * Player HUD card: avatar initial, name, rating, server-synced clock,
 * wall inventory, turn + connection status.
 */
import { formatClock } from '../../lib/format.js';

export interface PlayerCardProps {
  name: string;
  rating?: number | null;
  clockMs: number;
  clockActive: boolean;
  lowTime: boolean;
  wallsLeft: number;
  wallsTotal: number;
  isTurn: boolean;
  isYou: boolean;
  connected?: boolean;
  accent: 0 | 1;
}

export default function PlayerCard({ name, rating, clockMs, clockActive, lowTime, wallsLeft, wallsTotal, isTurn, isYou, connected = true, accent }: PlayerCardProps) {
  const color = accent === 0 ? 'var(--player-a)' : 'var(--player-b)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#fff', border: `1px solid ${isTurn ? color : 'var(--line)'}`,
      borderRadius: 12, padding: '10px 12px',
      boxShadow: isTurn ? `0 0 0 1px ${color}` : 'none',
    }}>
      <span aria-hidden style={{
        width: 36, height: 36, borderRadius: '50%', background: color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0,
      }}>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name} {isYou && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(you)</span>}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
          {rating !== null && rating !== undefined && <span>★ {rating}</span>}
          <span title="Walls remaining">▮ {wallsLeft}/{wallsTotal}</span>
          {!connected && <span style={{ color: '#b91c1c' }}>reconnecting…</span>}
        </div>
      </div>
      <div
        role="timer"
        aria-label={`${name} clock`}
        style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 800, fontSize: 20,
          color: lowTime ? '#b91c1c' : 'var(--ink)',
          background: clockActive ? '#eef3fe' : 'var(--bg)',
          borderRadius: 8, padding: '4px 10px',
          animation: lowTime && clockActive ? 'nexus-pulse 1s ease-in-out infinite' : undefined,
        }}
      >
        {formatClock(clockMs)}
      </div>
    </div>
  );
}
