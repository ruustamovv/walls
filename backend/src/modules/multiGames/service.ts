/**
 * Multi-seat online games (2–4 players, free-for-all).
 *
 * Mirrors modules/games/service.ts but for the N-seat engine core:
 * server-authoritative validation, server clocks with Fischer increment,
 * invite-link expiry, first-to-goal wins. V1 rules: casual-only (no
 * ratings), no draws — resign/timeout finish immediately with placement
 * by shortest-path distance (winner first). Opt-in `continueForPlacement`
 * (MLT-007) instead records full 1..N finish order: each seat reaching its
 * goal is eliminated from rotation and the game ends when one seat remains.
 */
import {
  applyMultiMove,
  createMultiGame,
  defaultSides,
  hiddenWallCount,
  presetForPlayers,
  shortestToSide,
  validateMultiMove,
  visibleWalls,
  MULTI_RULES_VERSION,
  type MultiAction,
  type MultiState,
} from '../../../../engine/typescript/dist/index.js';
import { ValidationError, NotFoundError, ForbiddenError } from '../../common/errors/errors.js';
import type { GameVisibility } from '../games/service.js';
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
  /** Server timestamp (ms) per applied action — timing-signal evidence (FRP-002). */
  moveTimes: number[];
  winnerSeat: number | null;
  /** Seats ordered winner-first (by goal distance at finish). */
  placement: number[];
  /** Opt-in continuation: seats record finish order instead of first-wins. */
  continueForPlacement: boolean;
  /** Opt-in team rules (MLT-009): first seat home wins for its team. */
  teamMode: boolean;
  /** Fog of war (MLT-009): snapshots are projected per seat. */
  fog: boolean;
  /** Chaos mode (MLT-009): wall budget rotates on a cadence. */
  chaos: boolean;
  /** Siege mode (MLT-009): asymmetric economy. */
  siege: boolean;
  finishReason: MultiFinishReason;
  settled: boolean;
  /** Client action id of the most recently applied intent (echo for dedupe). */
  lastActionId: string | null;
  /** Who may spectate / open replays: public, friends, unlisted (link), private (players). */
  visibility: GameVisibility;
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
  /** Recently seen client action ids per game (bounded) for dedupe. */
  private readonly seenActionIds = new Map<string, string[]>();

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
visibility?: GameVisibility;
    continueForPlacement?: boolean;
    /** MLT-009: seats 0+2 vs 1+3 share the win (2 or 4 seats only). */
    teamMode?: boolean;
    /** MLT-009: each seat only sees walls adjacent to its own pawn. */
    fog?: boolean;
    /** MLT-009 chaos: rotating wall budget. Needs a seed for replays. */
    chaos?: boolean;
    seed?: number;
    /** MLT-009 siege: seat 0 gets extra walls and a one-row head start. */
    siege?: boolean;
  }): MultiGameRecord {
    const players = input.players ?? 4;
    if (!Number.isInteger(players) || players < 2 || players > 6) {
      throw new ValidationError('players must be 2–6');
    }
    const preset = presetForPlayers(players);
    const boardSize = input.boardSize ?? preset.size;
    const wallsPerPlayer = input.wallsPerPlayer ?? preset.wallsPerPlayer;
    const tc = getTimeControl(input.timeControl ?? appConfig.defaultTimeControl);
    if (tc === null) throw new ValidationError('Unknown time control');
    if (!Number.isInteger(boardSize) || boardSize < 5 || boardSize > 25) {
      throw new ValidationError('Invalid board size');
    }
    if (!Number.isInteger(wallsPerPlayer) || wallsPerPlayer < 0 || wallsPerPlayer > 30) {
      throw new ValidationError('Invalid wallsPerPlayer');
    }
    const sides = defaultSides(players);
    const continueForPlacement = input.continueForPlacement === true;
    const teamMode = input.teamMode === true;
    if (teamMode && players !== 2 && players !== 4) {
      throw new ValidationError('Team mode needs 2 or 4 seats');
    }
    if (teamMode && continueForPlacement) {
      throw new ValidationError('Team mode and continue-for-placement are mutually exclusive');
    }
    const fog = input.fog === true;
    const chaos = input.chaos === true;
    const siege = input.siege === true;
    // Chaos needs a seed: replays reconstruct state from the action log, so an
    // unseeded rotation could never be reproduced.
    const seed = input.seed ?? Date.now() >>> 0;
    const state = createMultiGame({
      players,
      size: boardSize,
      wallsPerPlayer: wallsPerPlayer,
      sides,
      continueAfterWin: continueForPlacement,
      teamMode,
      fog,
      chaos,
      ...(chaos ? { seed } : {}),
      siege,
    });
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
      moveTimes: [],
      winnerSeat: null,
      placement: [],
      continueForPlacement,
      teamMode,
      fog,
      chaos,
      siege,
      finishReason: null,
      settled: false,
      lastActionId: null,
      visibility: input.visibility ?? 'public',
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
    opts: { actionId?: string; baseMoveNumber?: number } = {},
  ): MultiGameRecord {
    const g = this.get(gameId);
    if (g.status !== 'active') throw new ValidationError('Game is not active');
    if (opts.actionId !== undefined && (this.seenActionIds.get(gameId) ?? []).includes(opts.actionId)) {
      // Dedupe before seat/turn checks (see GamesService.play): retries of
      // an applied intent must replay the record, not error on flipped turn.
      return g;
    }
    if (opts.baseMoveNumber !== undefined && opts.baseMoveNumber !== g.actions.length) {
      throw new ValidationError('Stale action — resync and retry');
    }
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
    g.moveTimes.push(Date.now());
    if (opts.actionId !== undefined) {
      const seen = this.seenActionIds.get(gameId) ?? [];
      seen.push(opts.actionId);
      this.seenActionIds.set(gameId, seen.slice(-50));
      g.lastActionId = opts.actionId;
    }
    g.clock.remainingMs[seat] = (g.clock.remainingMs[seat] ?? 0) + g.clock.incrementMs;
    g.clock.lastTickAt = Date.now();
    g.updatedAt = Date.now();
    if (g.state.isOver) {
      if (g.teamMode) {
        // First seat home wins for its whole team (MLT-009).
        g.status = 'finished';
        g.placement = [...g.state.placement];
        g.winnerSeat = g.state.winner;
        g.finishReason = 'goal';
        g.updatedAt = Date.now();
      } else if (g.continueForPlacement) {
        // Engine already recorded the full finish order (MLT-007).
        g.status = 'finished';
        g.placement = [...g.state.placement];
        g.winnerSeat = g.state.winner;
        g.finishReason = 'goal';
        g.updatedAt = Date.now();
      } else {
        this.finishByDistance(g, 'goal');
      }
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

  /**
   * Public snapshot for one viewer.
   *
   * CRITICAL (MLT-009 fog): when `fog` is on, the wall list is replaced by
   * the subset that viewer may see. Broadcasting one shared snapshot would
   * reveal the whole board to everyone and make the mode a lie — so every
   * emission MUST pass the recipient's seat. Non-fog games ignore `viewer`.
   *
   * `viewerSeat: null` means spectator/unknown: fog games reveal nothing
   * rather than everything, so a spectator cannot spectate the far side.
   */
  snapshot(g: MultiGameRecord, viewerSeat: number | null = null): {
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
    eliminated: number[];
    continueForPlacement: boolean;
    /** Seat -> team index in team mode, null in free-for-all. */
    teamOf: number[] | null;
    /** Winning team index in team mode, else null. */
    winningTeam: number | null;
    teamMode: boolean;
    fog: boolean;
    chaos: boolean;
    siege: boolean;
    /** Walls hidden from this viewer (fog only; 0 otherwise). */
    hiddenWalls: number;
    finishReason: MultiFinishReason;
    moveCount: number;
    /** Echo of the most recently applied client action id (idempotency). */
    lastActionId: string | null;
    visibility: GameVisibility;
    timeControlId: string;
    mode: string;
    players: number;
    createdAt: number;
    updatedAt: number;
  } {
    // Fog projection: non-fog games pass the authoritative state through
    // untouched; fog games hand each viewer only the walls they may see.
    let projected: MultiState = g.state;
    let hiddenWalls = 0;
    if (g.fog) {
      const seat = viewerSeat !== null && viewerSeat >= 0 && viewerSeat < g.state.players ? viewerSeat : null;
      const shown = seat === null ? [] : visibleWalls(g.state, seat);
      hiddenWalls = g.state.walls.length - shown.length;
      projected = { ...g.state, walls: shown };
    }
    return {
      id: g.id,
      status: g.status,
      state: projected,
      seats: [...g.playerIds],
      clockMs: [...g.clock.remainingMs],
      incrementMs: g.clock.incrementMs,
      turn: g.state.turn,
      isOver: g.state.isOver || g.status === 'finished',
      winnerSeat: g.winnerSeat,
      placement: [...g.placement],
      eliminated: [...g.state.eliminated],
      continueForPlacement: g.continueForPlacement,
      teamOf: g.state.teamOf === null ? null : [...g.state.teamOf],
      winningTeam: g.state.winningTeam,
      teamMode: g.teamMode,
      fog: g.fog,
      chaos: g.chaos,
      siege: g.siege,
      hiddenWalls,
      finishReason: g.finishReason,
      moveCount: g.actions.length,
      lastActionId: g.lastActionId,
      visibility: g.visibility,
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
