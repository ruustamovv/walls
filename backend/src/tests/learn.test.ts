/**
 * Learn curriculum: every step is solvable (no dead drills ship).
 * Pure engine grading — no services required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CURRICULUM } from '../modules/learn/curriculum.js';
import { gradeStep } from '../modules/learn/service.js';
import {
  getLegalMoves,
  getLegalWalls,
} from '../../../engine/typescript/dist/index.js';
import type { Action } from '../../../engine/typescript/dist/core/types.js';

describe('learn: every step solvable', () => {
  for (const lesson of CURRICULUM) {
    for (const step of lesson.steps) {
      it(`${lesson.id}/${step.id} (${step.task})`, () => {
        const base = {
          size: step.size,
          wallsPerPlayer: step.wallsPerPlayer,
          turn: step.turn,
          pawns: step.pawns,
          walls: step.walls,
          wallsRemaining: step.wallsRemaining,
          winner: null as null,
          isOver: false,
          moveNumber: 0,
          lastAction: null,
          rulesVersion: '1.0.0',
        };
        const me = step.turn;
        const candidates: Action[] = [
          ...getLegalMoves(base, me).map((to) => ({ type: 'move' as const, to: { ...to } })),
          ...getLegalWalls(base, me).map((wall) => ({ type: 'wall' as const, wall: { ...wall } })),
        ];
        assert.ok(candidates.length > 0, 'position has no legal actions');
        const solved = candidates.some((a) => gradeStep(step, a).solved);
        assert.ok(solved, `no solving action for ${lesson.id}/${step.id}`);
      });
    }
  }
});
