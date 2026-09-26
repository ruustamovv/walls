/**
 * Public API of @nexus/engine. Import from here, not from internals.
 */
export {
  BOARD_PRESETS,
  RULES_VERSION,
  type Action,
  type ApplyResult,
  type GameConfig,
  type GameEvent,
  type GameState,
  type Orientation,
  type PlayerIndex,
  type Pos,
  type RejectReason,
  type ValidationResult,
  type Wall,
} from './core/types.js';
export {
  canPlaceWallGeometry,
  getNeighbors,
  goalRowFor,
  isBlockedBetween,
  isInBoundsCell,
  isInBoundsWall,
  startPosFor,
  wallsEqual,
} from './core/board.js';
export {
  findShortestPath,
  getPathMetrics,
  hasPathToGoal,
  type PathMetrics,
  type ShortestPath,
} from './pathfinding/bfs.js';
export { getLegalMoves as getLegalPawnMoves } from './rules/moves.js';
export { getLegalWalls, validateWall } from './rules/walls.js';
export {
  applyMove,
  createGame,
  deserializeState,
  getLegalMoves,
  hashState,
  isGameOver,
  replayGame,
  serializeState,
  validateMove,
} from './rules/game.js';
export {
  buildReplay,
  REPLAY_VERSION,
  verifyReplay,
  type Replay,
  type ReplayVerification,
} from './replay/replay.js';
export {
  BALANCED_WEIGHTS,
  botAction,
  BOTS,
  chooseBotAction,
  evaluateFor,
  getBot,
  mulberry32,
  type BotDef,
  type EvalWeights,
  type ScoredAction,
  type SearchOptions,
} from './bots/index.js';
