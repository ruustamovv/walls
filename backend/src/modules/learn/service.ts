/**
 * Lesson grading + progress. All tasks are outcome-graded against live
 * engine computation, so alternate winning lines pass:
 * - advance: own route strictly shortens.
 * - finish: the move wins immediately.
 * - wall-gain: submitted wall reaches the bar at cost ≤ 1.
 * - match-best: within the reference outcome band (Pareto rule).
 */
import {
  applyMove,
  chooseBotAction,
  createGame,
  findShortestPath,
  validateMove,
} from '../../../../engine/typescript/dist/index.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { CURRICULUM, findStep, type LessonStep } from './curriculum.js';
import type { Action, GameState } from '../../../../engine/typescript/dist/core/types.js';

function toState(step: LessonStep): GameState {
  return {
    size: step.size,
    wallsPerPlayer: step.wallsPerPlayer,
    turn: step.turn,
    pawns: [{ ...step.pawns[0] }, { ...step.pawns[1] }],
    walls: step.walls.map((w) => ({ ...w })),
    wallsRemaining: [...step.wallsRemaining] as [number, number],
    winner: null,
    isOver: false,
    moveNumber: 0,
    lastAction: null,
    rulesVersion: '1.0.0',
  };
}

function len(s: GameState, p: 0 | 1): number {
  const l = findShortestPath(s, p).length;
  return l < 0 ? 999 : l;
}

export interface GradeResult {
  solved: boolean;
  detail: string;
  best?: string;
}

export function gradeStep(step: LessonStep, action: Action): GradeResult {
  const state = toState(step);
  const verdict = validateMove(state, action);
  if (!verdict.ok) {
    return { solved: false, detail: `Illegal here (${verdict.reason ?? 'rejected'}).` };
  }
  const me = state.turn;
  const other = (1 - me) as 0 | 1;
  const ownBefore = len(state, me);
  const played = applyMove(state, action).state;
  const ownAfter = len(played, me);
  const oppAfter = len(played, other);

  if (step.task === 'advance') {
    return ownAfter < ownBefore
      ? { solved: true, detail: `Route ${ownBefore} → ${ownAfter}. Tempo banked.` }
      : { solved: false, detail: 'That does not shorten your route — keep looking.' };
  }
  if (step.task === 'finish') {
    return played.isOver && played.winner === me
      ? { solved: true, detail: 'Over the line. Endgames reward arrival, not elegance.' }
      : { solved: false, detail: 'That does not finish the game.' };
  }
  if (step.task === 'wall-gain') {
    if (action.type !== 'wall') {
      return { solved: false, detail: 'This drill asks for a wall.' };
    }
    const need = step.needGain ?? 3;
    const gain = oppAfter - len(state, other);
    const cost = ownAfter - ownBefore;
    return gain >= need && cost <= 1
      ? { solved: true, detail: `Opponent route +${gain} at your cost +${cost}.` }
      : { solved: false, detail: `Only +${gain} (need +${need}) or too costly (+${cost}).` };
  }
  // match-best: within the reference outcome band.
  const ref = chooseBotAction(state, {
    weights: { pathAdvantage: 12, wallAdvantage: 0.7, mobility: 0.7 },
    wallCandidates: 32, noise: 0, wallBias: 1, replySearch: false, budgetMs: 150, seed: 424242,
  }).action;
  const refState = applyMove(state, ref).state;
  const bestOwn = len(refState, me);
  const bestOpp = len(refState, other);
  const refDesc = ref.type === 'move' ? `move ${ref.to.r},${ref.to.c}` : `wall ${ref.wall.orientation} ${ref.wall.r},${ref.wall.c}`;
  const solved = ownAfter <= bestOwn && oppAfter >= bestOpp - 1;
  return {
    solved,
    best: refDesc,
    detail: solved
      ? 'Matches the reference outcome. Well bought.'
      : `Reference reaches you ${bestOwn} / them ${bestOpp}; yours reaches you ${ownAfter} / them ${oppAfter}.`,
  };
}

/** Public curriculum (positions included — solutions never leave). */
export function curriculum(): typeof CURRICULUM {
  return CURRICULUM;
}

export async function progress(userId: string): Promise<Record<string, string[]>> {
  try {
    const db = await getMongoDb();
    const rows = await db.collection('lesson_progress').find({ userId }).toArray();
    const out: Record<string, string[]> = {};
    for (const r of rows) {
      const row = r as unknown as { lessonId: string; steps: string[] };
      out[row.lessonId] = row.steps;
    }
    return out;
  } catch {
    return {};
  }
}

export async function recordSolved(userId: string, lessonId: string, stepId: string): Promise<void> {
  try {
    const db = await getMongoDb();
    await db.collection('lesson_progress').updateOne(
      { userId, lessonId },
      { $addToSet: { steps: stepId }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
  } catch {
    // progress is advisory
  }
}
