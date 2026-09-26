/**
 * Replay construction and verification: re-apply a recorded action list
 * and compare per-step hashes to detect divergence or tampering.
 */
import type { Action, GameConfig } from '../core/types.js';
import { applyMove, createGame, hashState } from '../rules/game.js';

/** Version of the replay envelope format (independent of rulesVersion). */
export const REPLAY_VERSION = '1.0.0';

export interface Replay {
  version: string;
  config: GameConfig;
  seed?: number;
  actions: Action[];
  /** hashState after each action, in order. */
  hashes: string[];
  finalHash: string;
}

export interface ReplayVerification {
  ok: boolean;
  reason?: string;
  /** Index of the first diverging action (when applicable). */
  failedAt?: number;
}

/** Apply actions from scratch, recording the hash after every step. */
export function buildReplay(
  config: GameConfig,
  actions: readonly Action[],
  seed?: number,
): Replay {
  let state = createGame(config, seed);
  const hashes: string[] = [];
  const cloned: Action[] = [];
  for (const action of actions) {
    const r = applyMove(state, action);
    state = r.state;
    hashes.push(hashState(state));
    cloned.push(
      action.type === 'move'
        ? { type: 'move', to: { ...action.to } }
        : { type: 'wall', wall: { ...action.wall } },
    );
  }
  const replay: Replay = {
    version: REPLAY_VERSION,
    config: { ...config },
    actions: cloned,
    hashes,
    finalHash: hashState(state),
  };
  const resolvedSeed = seed ?? config.seed;
  if (resolvedSeed !== undefined) replay.seed = resolvedSeed;
  return replay;
}

/** Re-apply a replay's actions and compare every recorded hash. */
export function verifyReplay(replay: Replay): ReplayVerification {
  let state: ReturnType<typeof createGame>;
  try {
    state = createGame(replay.config, replay.seed);
  } catch {
    return { ok: false, reason: 'invalid_config' };
  }
  if (!Array.isArray(replay.actions) || !Array.isArray(replay.hashes)) {
    return { ok: false, reason: 'malformed_replay' };
  }
  if (replay.actions.length !== replay.hashes.length) {
    return { ok: false, reason: 'length_mismatch' };
  }
  for (let i = 0; i < replay.actions.length; i++) {
    try {
      state = applyMove(state, replay.actions[i] as Action).state;
    } catch {
      return { ok: false, reason: 'invalid_action', failedAt: i };
    }
    if (hashState(state) !== replay.hashes[i]) {
      return { ok: false, reason: 'hash_mismatch', failedAt: i };
    }
  }
  if (hashState(state) !== replay.finalHash) {
    return { ok: false, reason: 'final_hash_mismatch' };
  }
  return { ok: true };
}
