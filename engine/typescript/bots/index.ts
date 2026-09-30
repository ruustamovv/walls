/**
 * Bot package: heuristic evaluation + budgeted search + named personalities.
 */
export { BALANCED_WEIGHTS, evaluateFor, type EvalWeights } from './evaluate.js';
export { botAction, BOTS, getBot, type BotDef } from './personalities.js';
export { quip, type BanterTrigger } from './banter.js';
export { chooseBotAction, adaptiveBudgetMs, mulberry32, type ScoredAction, type SearchOptions } from './search.js';
