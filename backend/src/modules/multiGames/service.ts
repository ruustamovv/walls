/**
 * Multi-seat online games (2–4 players, free-for-all).
 *
 * Mirrors modules/games/service.ts but for the N-seat engine core:
 * server-authoritative validation, server clocks with Fischer increment,
 * invite-link expiry, first-to-goal wins. V1 rules: casual-only (no
 * ratings), no draws — resign/timeout finish immediately with placement
 * by shortest-path distance (winner first).
 */
import {
  applyMultiMove,
  createMultiGame,
  defaultSides,
  shortestToSide,
  validateMultiMove,
  MULTI_RULES_VERSION,
  type MultiAction,
  type MultiState,
} from '../../../../engine/typescript/dist/index.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../common/errors/errors.js';
import { appConfig, getTimeControl } from '../../config/app.js';

export type MultiGameStatus = 'waiting' | 'active' | 'finished' | 'aborted';
export type MultiFinishReason = 'goal' | 'timeout' | 'resign' | null;

export interface MultiGameRecord {
  id: string;
  state: MultiState;
  status: MultiGameStatus;
  /** Seats in join order; null = open seat (invite link). */
  playerIds: (string | null)[];
  timeControlId: string;
  /** Always 'casual' in v1 — no rated multi pools yet. */
  mode: string;
  actions: MultiAction[];
  winnerSeat: number | null;
  /** Seats ordered winner-first (by goal distance at finish). */
  placement: number[];
  finishReason: MultiFinishReason;
  settled: boolean;
  clock: { remainingMs: number[]; lastTickAt: number; incrementMs: number };
  createdAt: number;
  updatedAt: number;
}

function newMultiGameId(): string {
  const g = globalThis.crypto;
  const tail = typeof g?.randomUUID === 'function' ? g.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `m_${tail}`;
}

/** Seats sorted by goal distance (winner first); ties break by seat index. */
export function placementByDistance(state: MultiState): number[] {
  const dist = state.pawns.map((p, seat) => {
    const side = state.sides[seat];
    if (side === undefined) return { seat, d: Number.POSITIVE_INFINITY };
    const r = shortestToSide(state.walls, state.size, p, side);
    return { seat, d: r.length < 0 ? Number.POSITIVE_INFINITY : r.length };
  });
  dist.sort((a, b) => (a.d !== b.d ? a.d - b.d : a.seat - b.seat));
  return dist.map((x) => x.seat);
}

function toAction(input: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }): MultiAction {
  if (input.type === 'move') return { type: 'move', to: { r: input.to.r, c: input.to.c } };
  return { type: 'wall', wall: { r: input.wall.r, c: input.wall.c, orientation: input.wall.orientation } };
}

export class MultiGamesService {
  private readonly games = new Map<string, MultiGameRecord>();

  count(): number {
    return this.games.size;
  }

  listActive(limit = 20): MultiGameRecord[] {
    return [...this.games.values()]
      .filter((g) => g.status === 'active')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, Math.min(Math.max(limit, 1), 50));
  }

  create(input: {
    creatorId: string;
    players?: number;
    boardSize?: number;
    wallsPerPlayer?: number;
    timeControl?: string;
  }): MultiGameRecord {
    const players = input.players ?? 4;
    if (!Number.isInteger(players) || players < 2 || players > 4) {
      throw new ValidationError('players must be 2, 3 or 4');
    }
    const boardSize = input.boardSize ?? (players >= 4 ? 9 : 13);
    const wallsPerPlayer = input.wallsPerPlayer ?? (players >= 4 ? 5 : 10);
    const tc = getTimeControl(input.timeControl ?? appConfig.defaultTimeControl);
    if (tc === null) throw new ValidationError('Unknown time control');
    if (!Number.isInteger(boardSize) || boardSize < 5 || boardSize > 19) {
      throw new ValidationError('Invalid board size');
    }
    if (!Number.isInteger(wallsPerPlayer) || wallsPerPlayer < 0 || wallsPerPlayer > 30) {
      throw new ValidationError('Invalid wallsPerPlayer');
    }
    const sides = defaultSides(players);
    const state = createMultiGame({ players, size: boardSize, wallsPerPlayer: wallsPerPlayer, sides });
    const now = Date.now();
    const playerIds: (string | null)[] = Array.from({ length: players }, (_, i) => (i === 0 ? input.creatorId : null));
    const record: MultiGameRecord = {
      id: newMultiGameId(),
      state,
      status: players === 1 ? 'active' : 'waiting',
      playerIds,
      timeControlId: tc.id,
      mode: 'casual',
      actions: [],
      winnerSeat: null,
      placement: [],
      finishReason: null,
      settled: false,
      clock: {
        remainingMs: Array.from({ length: players }, () => tc.baseSec * 1000),
        lastTickAt: now,
        incrementMs: tc.incSec * 1000,
      },
      createdAt: now,
      updatedAt: now,
    };
    if (players === 1) record.status = 'active';
    this.games.set(record.id, record);
    return record;
  }

  get(gameId: string): MultiGameRecord {
    const g = this.games.get(gameId);
    if (g === undefined) throw new NotFoundError('Game not found');
    return g;
  }

  /** Join the first open seat (invite-link flow). */
  join(gameId: string, userId: string): MultiGameRecord {
    const g = this.get(gameId);
    const existing = g.playerIds.indexOf(userId);
    if (existing !== -1) return g;
    if (g.status === 'waiting' && Date.now() - g.createdAt > 24 * 60 * 60 * 1000) {
      g.status = 'aborted';
      g.updatedAt = Date.now();
      throw new NotFoundError('Invite expired');
    }
    const open = g.playerIds.indexOf(null);
    if (g.status !== 'waiting' || open === -1) throw new ValidationError('Game is full');
    g.playerIds[open] = userId;
    if (!g.playerIds.includes(null)) {
      g.status = 'active';
      g.clock.lastTickAt = Date.now();
    }
    g.updatedAt = Date.now();
    return g;
  }

  private finishByDistance(g: MultiGameRecord, reason: Exclude<MultiFinishReason, null>): void {
    g.status = 'finished';
    g.placement = placementByDistance(g.state);
    g.winnerSeat = g.placement[0] ?? null;
    g.finishReason = reason;
    g.updatedAt = Date.now();
  }

  play(
    gameId: string,
    userId: string,
    input: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } },
  ): MultiGameRecord {
    const g = this.get(gameId);
    if (g.status !== 'active') throw new ValidationError('Game is not active');
    const seat = g.playerIds.indexOf(userId);
    if (seat === -1) throw new ForbiddenError('You are not a player of this game');
    if (g.state.turn !== seat) throw new ValidationError('Not your turn');
    this.tickClock(g, Date.now());
    if ((g.status as MultiGameStatus) === 'finished') return g;
    const action = toAction(input);
    const verdict = validateMultiMove(g.state, action);
    if (!verdict.ok) throw new ValidationError(`Illegal action: ${verdict.reason ?? 'rejected'}`);
    const result = applyMultiMove(g.state, action);
    g.state = result.state;
    g.actions.push(action);
    g.clock.remainingMs[seat] = (g.clock.remainingMs[seat] ?? 0) + g.clock.incrementMs;
    g.clock.lastTickAt = Date.now();
    g.updatedAt = Date.now();
    if (g.state.isOver) {
      this.finishByDistance(g, 'goal');
    }
    return g;
  }

  /** Resign: game ends at once; placement by goal distance (resigner included). */
  resign(gameId: string, userId: string): MultiGameRecord {
    const g = this.get(gameId);
    if (g.status === 'finished' || g.status === 'aborted') {
      throw new ValidationError('Game is already over');
    }
    const seat = g.playerIds.indexOf(userId);
    if (seat === -1) throw new ForbiddenError('You are not a player of this game');
    this.tickClock(g, Date.now());
    if ((g.status as MultiGameStatus) === 'finished') return g;
    this.finishByDistance(g, 'resign');
    return g;
  }

  /** Server-authoritative clock tick (never trusts client timestamps). */
  tickClock(g: MultiGameRecord, nowMs: number): void {
    if (g.status !== 'active') {
      g.clock.lastTickAt = nowMs;
      return;
    }
    const elapsed = Math.max(0, nowMs - g.clock.lastTickAt);
    const toMove = g.state.turn;
    g.clock.remainingMs[toMove] = Math.max(0, (g.clock.remainingMs[toMove] ?? 0) - elapsed);
    g.clock.lastTickAt = nowMs;
    if ((g.clock.remainingMs[toMove] ?? 1) <= 0) {
      this.finishByDistance(g, 'timeout');
    }
  }

  snapshot(g: MultiGameRecord): {
    id: string;
    status: MultiGameStatus;
    state: MultiState;
    seats: (string | null)[];
    clockMs: number[];
    incrementMs: number;
    turn: number;
    isOver: boolean;
    winnerSeat: number | null;
    placement: number[];
    finishReason: MultiFinishReason;
    moveCount: number;
    timeControlId: string;
    mode: string;
    players: number;
    createdAt: number;
    updatedAt: number;
  } {
    return {
      id: g.id,
      status: g.status,
      state: g.state,
      seats: [...g.playerIds],
      clockMs: [...g.clock.remainingMs],
      incrementMs: g.clock.incrementMs,
      turn: g.state.turn,
      isOver: g.state.isOver || g.status === 'finished',
      winnerSeat: g.winnerSeat,
      placement: [...g.placement],
      finishReason: g.finishReason,
      moveCount: g.actions.length,
      timeControlId: g.timeControlId,
      mode: g.mode,
      players: g.state.players,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
}

export const multiGamesService = new MultiGamesService();
export { MULTI_RULES_VERSION };
