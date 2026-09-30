/**
 * Public API of @nexus/engine. Import from here, not from internals.
 */
export {
  winChanceCurve,
  winChanceFor,
} from './eval/winChance.js';
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
  adaptiveBudgetMs,
  botAction,
  BOTS,
  chooseBotAction,
  evaluateFor,
  getBot,
  mulberry32,
  quip,
  type BanterTrigger,
  type BotDef,
  type EvalWeights,
  type ScoredAction,
  type SearchOptions,
} from './bots/index.js';
export {
  describeAction,
  mobilityOf,
  parseBestAction,
  reviewGame,
  type GameReview,
  type MoveClass,
  type ReviewedMove,
  type ReviewLabel,
  type ReviewOptions,
} from './review/index.js';
export {
  dailyPuzzle,
  gradeAttempt,
  seededPuzzle,
  todayKey,
  type AttemptVerdict,
  type DailyPuzzle,
} from './puzzles/index.js';
export {
  applyMultiMove,
  chooseMultiBotAction,
  createMultiGame,
  defaultSides,
  getMultiLegalMoves,
  getMultiLegalWalls,
  hashMultiState,
  isGoal,
  isMultiGameOver,
  MULTI_BOT_DEFAULT,
  MULTI_PRESETS,
  MULTI_RULES_VERSION,
  replayMultiGame,
  serializeMultiState,
  shortestToSide,
  startFor,
  validateMultiMove,
  validateMultiWall,
  type MultiAction,
  type MultiApplyResult,
  type MultiBotOpts,
  type MultiConfig,
  type MultiOrientation,
  type MultiPos,
  type MultiRejectReason,
  type MultiState,
  type MultiValidation,
  type MultiWall,
  type SeatSide,
  type SidePath,
} from './multi/index.js';
