/**
 * Post-game result sheet: outcome, how it ended, key stats, next actions.
 * Progressive disclosure — advanced analysis lives in Game Review, not here.
 */
import { reasonLabel, resultLabel } from '../../lib/format.js';
import { Button } from '../ui/primitives.js';

export interface ResultModalProps {
  winnerSeat: 0 | 1 | null;
  reason: string | null;
  perspective: 0 | 1 | null;
  moveCount: number;
  durationSec: number | null;
  onRematch?: () => void;
  onReview?: () => void;
  onNewGame: () => void;
  onHome: () => void;
}

export default function ResultModal({ winnerSeat, reason, perspective, moveCount, durationSec, onRematch, onReview, onNewGame, onHome }: ResultModalProps) {
  const won = perspective !== null && winnerSeat === perspective;
  return (
    <div role="dialog" aria-modal="true" aria-label="game result" style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(16,20,24,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'nexus-fade .2s ease',
    }}>
      <div style={{
        background: '#fff', borderRadius: 18, padding: 28, maxWidth: 440, width: '100%',
        textAlign: 'center', boxShadow: '0 20px 60px rgba(16,20,24,.25)', animation: 'nexus-pop .2s ease',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.08em', color: won ? '#15803d' : 'var(--muted)' }}>
          {perspective === null ? 'GAME OVER' : won ? 'VICTORY' : 'DEFEAT'}
        </div>
        <h2 style={{ margin: '6px 0 4px', fontSize: 28 }}>
          {resultLabel(winnerSeat, reason, perspective)} {reasonLabel(reason)}
        </h2>
        <p style={{ color: 'var(--muted)', margin: '0 0 16px', fontSize: 14 }}>
          {moveCount} moves
          {durationSec !== null && ` · ${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          {onRematch !== undefined && <Button onClick={onRematch}>Rematch</Button>}
          {onReview !== undefined && <Button variant="ghost" onClick={onReview}>Review</Button>}
          <Button variant="ghost" onClick={onNewGame}>New game</Button>
          <Button variant="subtle" onClick={onHome}>Home</Button>
        </div>
      </div>
    </div>
  );
}
