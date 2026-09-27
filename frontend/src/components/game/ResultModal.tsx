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
  /** Multiplayer override: exact headline (e.g. "Bot 3 wins!"). */
  title?: string;
  /** Whether the local side won (for the VICTORY/DEFEAT stamp). */
  won?: boolean;
  /** Rating line, e.g. "blitz 1650 (+12)". */
  ratingLine?: string | null;
}

export default function ResultModal({ winnerSeat, reason, perspective, moveCount, durationSec, onRematch, onReview, onNewGame, onHome, title, won: wonProp, ratingLine }: ResultModalProps) {
  const won = wonProp ?? (perspective !== null && winnerSeat === perspective);
  return (
    <div role="dialog" aria-modal="true" aria-label="game result" style={{
      position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(16,20,24,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'nexus-fade .2s ease',
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 28, maxWidth: 440, width: '100%',
        textAlign: 'center', boxShadow: 'var(--shadow-pop)', animation: 'nexus-win .32s ease',
      }}>
        <div aria-hidden style={{ fontSize: 44, animation: 'nexus-win .45s ease' }}>
          {perspective === null ? '🏁' : won ? '🏆' : '🛡️'}
        </div>
        <div className="font-display" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.14em', color: won ? 'var(--good)' : 'var(--muted)' }}>
          {perspective === null ? 'GAME OVER' : won ? 'VICTORY' : 'DEFEAT'}
        </div>
        <h2 style={{ margin: '6px 0 4px', fontSize: 28 }}>
          {title ?? <>{resultLabel(winnerSeat, reason, perspective)} {reasonLabel(reason)}</>}
        </h2>
        <p style={{ color: 'var(--muted)', margin: '0 0 16px', fontSize: 14 }}>
          {moveCount} moves
          {durationSec !== null && ` · ${Math.floor(durationSec / 60)}m ${Math.round(durationSec % 60)}s`}
          {ratingLine !== null && ratingLine !== undefined && <><br />{ratingLine}</>}
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
