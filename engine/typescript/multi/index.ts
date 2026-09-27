/**
 * Multiplayer engine package (2–4 seats). The classic 2P core is untouched.
 */
export {
  MULTI_PRESETS,
  MULTI_RULES_VERSION,
  type MultiAction,
  type MultiConfig,
  type MultiOrientation,
  type MultiPos,
  type MultiRejectReason,
  type MultiState,
  type MultiValidation,
  type MultiWall,
  type SeatSide,
} from './types.js';
export { defaultSides, hasSidePath, isGoal, shortestToSide, startFor, type SidePath } from './board.js';
export { getMultiLegalMoves } from './moves.js';
export { getMultiLegalWalls, validateMultiWall } from './walls.js';
export {
  applyMultiMove,
  createMultiGame,
  hashMultiState,
  isMultiGameOver,
  replayMultiGame,
  serializeMultiState,
  validateMultiMove,
  type MultiApplyResult,
} from './game.js';
export { chooseMultiBotAction, MULTI_BOT_DEFAULT, type MultiBotOpts } from './bots.js';
