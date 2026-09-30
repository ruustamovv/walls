/**
 * Games service — server-authoritative game lifecycle.
 *
 * Engine binding: imports the workspace engine's COMPILED output via RELATIVE
 * path so builds work even before `pnpm install` links `@nexus/engine`:
 *
 *   backend/src/modules/games/service.ts  ->  ../../../../engine/typescript/dist/index.js
 *
 * Compiled `dist` (not `src`) is used deliberately: importing `src` would
 * pull engine .ts files into this tsconfig program and break `rootDir`.
 * At runtime the emitted JS keeps the same relative layout
 * (backend/dist/... -> engine/typescript/dist/...), so the path resolves
 * identically after `tsc`. Requires `engine/typescript` to be built first
 * (`pnpm --filter ./engine/typescript build`).
 *
 * Once the workspace link is ready you may switch to
 * `import ... from '@nexus/engine'` (add it to backend dependencies).
 * Both resolve to the same pure functions (createGame/validateMove/applyMove).
 *
 * Storage: in-memory Map (dev/test). TODO(mongo): persist to
 * `games` / `game_moves` / `game_events` collections via GameRepository.
 * Clock: server-authoritative placeholder — remaining time is computed from
 * server timestamps only; client clocks are never trusted.
 */
import {
  applyMove,
  createGame,
  validateMove,
  type Action,
  type GameState,
} from '../../../../engine/typescript/dist/index.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../common/errors/errors.js';
import { appConfig, getTimeControl } from '../../config/app.js';

export type GameStatus = 'waiting' | 'active' | 'finished' | 'aborted';

/** How a finished game ended. Null while the game is still live. */
export type FinishReason = 'goal' | 'timeout' | 'resign' | 'draw' | null;

export interface ClockState {
  /** ms remaining per player, server-computed. */
  remainingMs: [number, number];
  /** server timestamp of last tick. */
  lastTickAt: number;
  incrementMs: number;
}

export interface GameRecord {
  id: string;
  state: GameState;
  status: GameStatus;
  playerIds: [string, string | null];
  timeControlId: string;
  /** Queue mode the game was created from (ranked/casual/...). */
  mode: string;
  /** Full action history for replays / review / what-if. */
  actions: Action[];
  /** Winning seat once finished (timeout awards the side with time left). */
  winnerSeat: 0 | 1 | null;
  finishReason: FinishReason;
  /** Seat that offered a draw and awaits an answer, if any. */
  drawOfferBy: 0 | 1 | null;
  /** True once the finish side-effects (ratings/replay) have been settled. */
  settled: boolean;
  clock: ClockState;
  createdAt: number;
  updatedAt: number;
}

function newGameId(): string {
  const g = globalThis.crypto;
  const tail = typeof g?.randomUUID === 'function' ? g.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `g_${tail}`;
}

function toAction(input: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }): Action {
  if (input.type === 'move') return { type: 'move', to: { r: input.to.r, c: input.to.c } };
  return { type: 'wall', wall: { r: input.wall.r, c: input.wall.c, orientation: input.wall.orientation } };
}

export class GamesService {
  private readonly games = new Map<string, GameRecord>();

  count(): number {
    return this.games.size;
  }

  /** Active games, most recently updated first (spectator directory). */
  listActive(limit = 20): GameRecord[] {
    return [...this.games.values()]
      .filter((g) => g.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.min(Math.max(limit, 1), 50));
  }

  create(input: {
    creatorId: string;
    boardSize?: number;
    wallsPerPlayer?: number;
    timeControl?: string;
    opponentId?: string;
    mode?: string;
  }): GameRecord {
    const boardSize = input.boardSize ?? appConfig.walls.defaultBoardSize;
    const wallsPerPlayer = input.wallsPerPlayer ?? appConfig.walls.defaultPerPlayer;
    const tc = getTimeControl(input.timeControl ?? appConfig.defaultTimeControl);
    if (tc === null) throw new ValidationError('Unknown time control');
    if (!Number.isInteger(boardSize) || boardSize < 5 || boardSize > 19) {
      throw new ValidationError('Invalid board size');
    }
    if (!Number.isInteger(wallsPerPlayer) || wallsPerPlayer < 0 || wallsPerPlayer > 30) {
      throw new ValidationError('Invalid wallsPerPlayer');
    }

    const state = createGame({ size: boardSize, wallsPerPlayer });
    const now = Date.now();
    const record: GameRecord = {
      id: newGameId(),
      state,
      status: input.opponentId !== undefined ? 'active' : 'waiting',
      playerIds: [input.creatorId, input.opponentId ?? null],
      timeControlId: tc.id,
      mode: input.mode ?? 'ranked',
      actions: [],
      winnerSeat: null,
      finishReason: null,
      drawOfferBy: null,
      settled: false,
      clock: {
        remainingMs: [tc.baseSec * 1000, tc.baseSec * 1000],
        lastTickAt: now,
        incrementMs: tc.incSec * 1000,
      },
      createdAt: now,
      updatedAt: now,
    };
    this.games.set(record.id, record);
    // TODO(mongo): insert into `games` + `game_moves` via GameRepository.
    return record;
  }

  get(gameId: string): GameRecord {
    const g = this.games.get(gameId);
    if (g === undefined) throw new NotFoundError('Game not found');
    return g;
  }

  /** Invite-link TTL for unstarted games (GST-004): stale links expire. */
  static readonly inviteTtlMs = 24 * 60 * 60 * 1000;

  /** Join as the second seat (waiting games only). */
  join(gameId: string, userId: string): GameRecord {
    const g = this.get(gameId);
    if (g.playerIds[0] === userId || g.playerIds[1] === userId) return g;
    if (g.status === 'waiting' && Date.now() - g.createdAt > GamesService.inviteTtlMs) {
      g.status = 'aborted';
      g.updatedAt = Date.now();
      throw new NotFoundError('Invite expired');
    }
    if (g.playerIds[1] !== null) throw new ValidationError('Game is full');
    g.playerIds[1] = userId;
    g.status = 'active';
    g.updatedAt = Date.now();
    return g;
  }

  /**
   * Apply a pawn move or wall placement.
   * Turn ownership is enforced server-side from playerIds + state.turn.
   */
  play(gameId: string, userId: string, input: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }): GameRecord {
    const g = this.get(gameId);
    if (g.status !== 'active' && g.status !== 'waiting') {
      throw new ValidationError('Game is not playable');
    }
    const seat = g.playerIds[0] === userId ? 0 : g.playerIds[1] === userId ? 1 : -1;
    if (seat === -1) throw new ForbiddenError('You are not a player of this game');
    if (g.state.turn !== seat) throw new ValidationError('Not your turn');

    const action = toAction(input);
    const verdict = validateMove(g.state, action);
    if (!verdict.ok) throw new ValidationError(`Illegal action: ${verdict.reason ?? 'rejected'}`);

    this.tickClock(g, Date.now());
    // tickClock may have finished the game on time (narrowing-proof check).
    if ((g.status as GameStatus) === 'finished') return g;
    const mover = g.state.turn;
    const result = applyMove(g.state, action);
    g.state = result.state;
    g.actions.push(action);
    // Fischer increment to the mover, server-side only.
    g.clock.remainingMs[mover] += g.clock.incrementMs;
    g.clock.lastTickAt = Date.now();
    g.updatedAt = Date.now();
    if (g.state.isOver) {
      g.status = 'finished';
      g.winnerSeat = g.state.winner;
      g.finishReason = 'goal';
    }
    return g;
  }

  /** Resign: the opponent wins immediately. Exactly one terminal transition. */
  resign(gameId: string, userId: string): GameRecord {
    const g = this.get(gameId);
    if (g.status === 'finished' || g.status === 'aborted') {
      throw new ValidationError('Game is already over');
    }
    const seat = g.playerIds[0] === userId ? 0 : g.playerIds[1] === userId ? 1 : -1;
    if (seat === -1) throw new ForbiddenError('You are not a player of this game');
    this.tickClock(g, Date.now());
    if ((g.status as GameStatus) === 'finished') return g;
    g.status = 'finished';
    g.winnerSeat = ((1 - seat) as 0 | 1);
    g.finishReason = 'resign';
    g.updatedAt = Date.now();
    return g;
  }

  /** Server-authoritative clock tick (never trusts client timestamps). */
  tickClock(g: GameRecord, nowMs: number): void {
    if (g.status !== 'active') {
      g.clock.lastTickAt = nowMs;
      return;
    }
    const elapsed = Math.max(0, nowMs - g.clock.lastTickAt);
    const toMove = g.state.turn;
    g.clock.remainingMs[toMove] = Math.max(0, g.clock.remainingMs[toMove] - elapsed);
    g.clock.lastTickAt = nowMs;
    if (g.clock.remainingMs[toMove] <= 0) {
      g.status = 'finished';
      // Timeout: the side with time left wins. Engine board state is kept
      // untouched; the authoritative result lives on winnerSeat/reason.
      g.winnerSeat = ((1 - toMove) as 0 | 1);
      g.finishReason = 'timeout';
      g.updatedAt = nowMs;
    }
  }

  /** Offer a draw; the opponent answers with respondDraw. Idempotent. */
  offerDraw(gameId: string, userId: string): GameRecord {
    const g = this.get(gameId);
    if (g.status !== 'active') throw new ValidationError('Game is not active');
    const seat = g.playerIds[0] === userId ? 0 : g.playerIds[1] === userId ? 1 : -1;
    if (seat === -1) throw new ForbiddenError('You are not a player of this game');
    this.tickClock(g, Date.now());
    if ((g.status as GameStatus) === 'finished') return g;
    g.drawOfferBy = seat as 0 | 1;
    g.updatedAt = Date.now();
    return g;
  }

  /** Answer a pending draw offer; acceptance ends the game as a draw. */
  respondDraw(gameId: string, userId: string, accept: boolean): GameRecord {
    const g = this.get(gameId);
    if (g.drawOfferBy === null) throw new ValidationError('No draw offer pending');
    const seat = g.playerIds[0] === userId ? 0 : g.playerIds[1] === userId ? 1 : -1;
    if (seat === -1) throw new ForbiddenError('You are not a player of this game');
    if (seat === g.drawOfferBy) throw new ValidationError('You cannot answer your own offer');
    if (g.status !== 'active') throw new ValidationError('Game is not active');
    if (accept) {
      g.status = 'finished';
      g.winnerSeat = null;
      g.finishReason = 'draw';
      g.updatedAt = Date.now();
    }
    g.drawOfferBy = null;
    return g;
  }

  /**
   * Public snapshot safe to broadcast. Includes seat user ids so clients can
   * derive their own seat (needed for turn gating + HUD labels). No emails,
   * hashes, or internal fields leak here.
   */
  snapshot(g: GameRecord): {
    id: string;
    status: GameStatus;
    state: GameState;
    seats: [string | null, string | null];
    clockMs: [number, number];
    incrementMs: number;
    turn: number;
    isOver: boolean;
    winnerSeat: 0 | 1 | null;
    finishReason: FinishReason;
    drawOfferBy: 0 | 1 | null;
    moveCount: number;
    timeControlId: string;
    mode: string;
    createdAt: number;
    updatedAt: number;
  } {
    return {
      id: g.id,
      status: g.status,
      state: g.state,
      seats: [...g.playerIds] as [string | null, string | null],
      clockMs: [...g.clock.remainingMs] as [number, number],
      incrementMs: g.clock.incrementMs,
      turn: g.state.turn,
      isOver: g.state.isOver || g.status === 'finished',
      winnerSeat: g.winnerSeat,
      finishReason: g.finishReason,
      drawOfferBy: g.drawOfferBy,
      moveCount: g.actions.length,
      timeControlId: g.timeControlId,
      mode: g.mode,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
}

export const gamesService = new GamesService();
