/**
 * Named bot personalities. Every bot shares the same search core; style
 * comes from evaluation weights, wall appetite, noise, candidate budget
 * and reply lookahead — never from illegal or faked moves.
 *
 * `rating` is an internal difficulty anchor for matchmaking/display until
 * calibrated by bot-vs-bot simulations (not a proven human skill rating).
 */
import { BALANCED_WEIGHTS, type EvalWeights } from './evaluate.js';
import { chooseBotAction, type ScoredAction } from './search.js';
import type { Action, GameState } from '../core/types.js';

export interface BotDef {
  id: string;
  name: string;
  rating: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  style: string;
  description: string;
  weights: EvalWeights;
  /** Max wall candidates per search. */
  wallCandidates: number;
  /** Score jitter — higher means more human-like mistakes. */
  noise: number;
  /** >1 loves walls, <1 prefers running. */
  wallBias: number;
  replySearch: boolean;
  budgetMs: number;
}

function bot(def: BotDef): BotDef {
  return def;
}

export const BOTS: BotDef[] = [
  bot({
    id: 'rookie', name: 'Rookie', rating: 600, difficulty: 1,
    style: 'Gentle teacher', description: 'Learning the ropes. Mostly runs forward, rarely walls, often wanders.',
    weights: { ...BALANCED_WEIGHTS }, wallCandidates: 4, noise: 14, wallBias: 0.4, replySearch: false, budgetMs: 20,
  }),
  bot({
    id: 'runner', name: 'Runner', rating: 900, difficulty: 1,
    style: 'Sprinter', description: 'Sprints for the goal line. Almost never spends a wall.',
    weights: { pathAdvantage: 14, wallAdvantage: 0.1, mobility: 0.2 }, wallCandidates: 2, noise: 4, wallBias: 0.15, replySearch: false, budgetMs: 30,
  }),
  bot({
    id: 'fortress', name: 'Fortress', rating: 1200, difficulty: 2,
    style: 'Defensive', description: 'Builds early, keeps escape routes, punishes greedy rushes.',
    weights: { pathAdvantage: 9, wallAdvantage: 1.4, mobility: 0.6 }, wallCandidates: 24, noise: 3, wallBias: 1.5, replySearch: false, budgetMs: 80,
  }),
  bot({
    id: 'architect', name: 'Architect', rating: 1500, difficulty: 3,
    style: 'Choke-point artist', description: 'Designs mazes. Hunts the wall that bends your whole route.',
    weights: { pathAdvantage: 12, wallAdvantage: 0.8, mobility: 0.9 }, wallCandidates: 48, noise: 1.5, wallBias: 1.7, replySearch: false, budgetMs: 150,
  }),
  bot({
    id: 'assassin', name: 'Assassin', rating: 1650, difficulty: 3,
    style: 'Aggressive', description: 'Targets your shortest path relentlessly. Every wall is aimed at you.',
    weights: { pathAdvantage: 16, wallAdvantage: 0.2, mobility: 0.3 }, wallCandidates: 48, noise: 1.2, wallBias: 1.4, replySearch: false, budgetMs: 150,
  }),
  bot({
    id: 'calculator', name: 'Calculator', rating: 1800, difficulty: 4,
    style: 'Deep reader', description: 'Thinks a reply ahead. Calm, positional, hard to trick.',
    weights: { ...BALANCED_WEIGHTS }, wallCandidates: 40, noise: 0.6, wallBias: 1.0, replySearch: true, budgetMs: 400,
  }),
  bot({
    id: 'speedster', name: 'Speedster', rating: 1400, difficulty: 3,
    style: 'Bullet specialist', description: 'Decides in a flash. Great at Bullet, beatable when you slow down.',
    weights: { pathAdvantage: 13, wallAdvantage: 0.3, mobility: 0.8 }, wallCandidates: 10, noise: 2.5, wallBias: 0.7, replySearch: false, budgetMs: 20,
  }),
  bot({
    id: 'endgame', name: 'Endgame', rating: 1700, difficulty: 4,
    style: 'Closer', description: 'Conserves walls, then strikes when the finish line is close.',
    weights: { pathAdvantage: 11, wallAdvantage: 1.8, mobility: 0.4 }, wallCandidates: 32, noise: 0.8, wallBias: 0.9, replySearch: true, budgetMs: 300,
  }),
  bot({
    id: 'chaos', name: 'Chaos', rating: 1000, difficulty: 2,
    style: 'Unpredictable', description: 'Legal but bizarre. Walls anywhere, runs nowhere. Do not try to read it.',
    weights: { pathAdvantage: 6, wallAdvantage: 0.5, mobility: 2.5 }, wallCandidates: 40, noise: 22, wallBias: 1.3, replySearch: false, budgetMs: 60,
  }),
  bot({
    id: 'grandmaster', name: 'Grandmaster', rating: 2100, difficulty: 5,
    style: 'Relentless', description: 'Full search, reply-aware, ice cold. The mountain at the end of the ladder.',
    weights: { pathAdvantage: 12, wallAdvantage: 0.7, mobility: 0.7 }, wallCandidates: 80, noise: 0.15, wallBias: 1.1, replySearch: true, budgetMs: 800,
  }),
];

export function getBot(id: string): BotDef | null {
  return BOTS.find((b) => b.id === id) ?? null;
}

/**
 * Choose a bot action for the side to move.
 * `seed` drives the deterministic noise stream — pass
 * `gameSeed * 1e6 + moveNumber` style values for reproducible variety.
 */
export function botAction(botDef: BotDef, state: GameState, seed: number): Action {
  const scored: ScoredAction = chooseBotAction(state, {
    weights: botDef.weights,
    wallCandidates: botDef.wallCandidates,
    noise: botDef.noise,
    wallBias: botDef.wallBias,
    replySearch: botDef.replySearch,
    budgetMs: botDef.budgetMs,
    seed,
  });
  return scored.action;
}
