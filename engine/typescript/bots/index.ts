/**
 * Bot package: heuristic evaluation + budgeted search + named personalities.
 */
export { BALANCED_WEIGHTS, evaluateFor, type EvalWeights } from './evaluate.js';
export { botAction, botActionShallow, BOTS, getBot, type BotDef } from './personalities.js';
export { chooseDeepAction, type DeepResult, type DeepSearchOptions } from './deep.js';
export { quip, type BanterTrigger } from './banter.js';
export { chooseBotAction, adaptiveBudgetMs, topCandidates, mulberry32, type CandidateAction, type ScoredAction, type SearchOptions } from './search.js';
