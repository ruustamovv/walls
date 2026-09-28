/**
 * Player HUD card: avatar initial, name, rating, server-synced clock,
 * wall inventory, turn + connection status.
 */
import { memo } from 'react';
import { formatClock } from '../../lib/format.js';
import { Avatar, DivisionBadge } from '../ui/primitives.js';

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

export default memo(function PlayerCard({ name, rating, clockMs, clockActive, lowTime, wallsLeft, wallsTotal, isTurn, isYou, connected = true, accent }: PlayerCardProps) {
  const color = accent === 0 ? 'var(--player-a)' : 'var(--player-b)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--surface)', border: `2px solid ${isTurn ? color : 'var(--line)'}`,
      borderRadius: 'var(--radius-md)', padding: '10px 12px',
      boxShadow: isTurn ? `0 0 0 1px ${color}, 0 0 22px -4px ${color}` : 'var(--shadow-card)',
      animation: isTurn ? 'nexus-aura 2.4s ease-in-out infinite' : undefined,
    }}>
      <span style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar name={name} size={38} />
        <span aria-hidden style={{
          position: 'absolute', right: -2, bottom: -2, width: 14, height: 14,
          borderRadius: '50%', background: color, border: '2px solid var(--surface)',
        }} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="font-display" style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name} {isYou && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(you)</span>}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {rating !== null && rating !== undefined && <DivisionBadge rating={rating} />}
          <span title={`${wallsLeft} of ${wallsTotal} walls remaining`} aria-label={`${wallsLeft} of ${wallsTotal} walls remaining`} style={{ display: 'inline-flex', gap: 2 }}>
            {Array.from({ length: Math.min(wallsTotal, 12) }, (_, i) => (
              <span key={i} aria-hidden style={{
                width: 5, height: 14, borderRadius: 2,
                background: i < Math.round((wallsLeft / Math.max(1, wallsTotal)) * Math.min(wallsTotal, 12)) ? color : 'var(--surface-2)',
                border: '1px solid var(--line)',
              }} />
            ))}
            {wallsTotal > 12 && <span style={{ fontSize: 12 }}>+{wallsTotal - 12}</span>}
          </span>
          {!connected && <span style={{ color: 'var(--bad)' }}>reconnecting…</span>}
        </div>
      </div>
      <div
        role="timer"
        aria-label={`${name} clock`}
        className="font-mono"
        style={{
          fontWeight: 800, fontSize: 22, letterSpacing: '.02em',
          color: lowTime ? 'var(--bad)' : 'var(--ink)',
          background: clockActive ? 'var(--clock-active)' : 'var(--surface-2)',
          border: clockActive ? `1px solid ${color}` : '1px solid var(--line)',
          borderRadius: 8, padding: '4px 10px',
          animation: lowTime && clockActive ? 'nexus-pulse 1s ease-in-out infinite' : undefined,
        }}
      >
        {formatClock(clockMs)}
      </div>
    </div>
  );
})
