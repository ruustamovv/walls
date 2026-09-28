/**
 * Guided curriculum: original strategy writing + engine-mined positions.
 * Every step is outcome-graded (alternate winning lines pass); a backend
 * test asserts each step is solvable from its starting position.
 */
import { LESSON_POSITIONS } from './positions.js';

export type TaskKind = 'advance' | 'match-best' | 'wall-gain' | 'finish';

export interface LessonStep {
  id: string;
  title: string;
  explain: string;
  size: number;
  wallsPerPlayer: number;
  turn: 0 | 1;
  pawns: [{ r: number; c: number }, { r: number; c: number }];
  walls: { r: number; c: number; orientation: 'h' | 'v' }[];
  wallsRemaining: [number, number];
  task: TaskKind;
  needGain?: number;
}

export interface Lesson {
  id: string;
  title: string;
  description: string;
  steps: LessonStep[];
}

function pos(key: keyof typeof LESSON_POSITIONS, wallsPerPlayer = 10): Omit<LessonStep, 'id' | 'title' | 'explain' | 'task' | 'needGain'> {
  const p = LESSON_POSITIONS[key] as unknown as {
    size: number; turn: 0 | 1;
    pawns: [{ r: number; c: number }, { r: number; c: number }];
    walls: { r: number; c: number; orientation: 'h' | 'v' }[];
    wallsRemaining: [number, number];
  };
  return {
    size: p.size,
    wallsPerPlayer,
    turn: p.turn,
    pawns: [{ ...p.pawns[0] }, { ...p.pawns[1] }],
    walls: p.walls.map((w) => ({ ...w })),
    wallsRemaining: [...p.wallsRemaining] as [number, number],
  };
}

export const CURRICULUM: Lesson[] = [
  {
    id: 'first-steps',
    title: 'First steps',
    description: 'Move, wall, finish — the three verbs of the arena.',
    steps: [
      {
        id: 'move-forward',
        title: 'Walk toward the far side',
        explain: 'Your pawn must reach the opposite edge. On an open board the shortest route is straight ahead: every step forward banks one turn of progress.',
        ...pos('opening_4ply'),
        task: 'advance',
      },
      {
        id: 'first-wall',
        title: 'Spend a wall that matters',
        explain: 'Walls are bought with turns. A wall is worth playing when it lengthens the opponent\'s route while barely touching your own — aim for +1 or more here.',
        ...pos('opening_6ply'),
        task: 'wall-gain',
        needGain: 1,
      },
      {
        id: 'first-finish',
        title: 'Step over the line',
        explain: 'Games are won by arrival, not by material. One step onto the far row ends it immediately — take it.',
        ...pos('endgame_mate1'),
        task: 'finish',
      },
    ],
  },
  {
    id: 'tempo-terrain',
    title: 'Tempo vs terrain',
    description: 'Every turn buys either progress (tempo) or distance owed to you later (terrain). Learn the exchange rate.',
    steps: [
      {
        id: 'choke-study',
        title: 'Find the choke point',
        explain: 'Narrow corridors are where walls convert best. This position hides a wall worth +3 or more at negligible cost to you.',
        ...pos('choke_a'),
        task: 'wall-gain',
        needGain: 3,
      },
      {
        id: 'race-or-wall',
        title: 'Race or build?',
        explain: 'After a few quiet moves the board asks its central question: run, or spend? Match the engine\'s reference outcome — there is usually exactly one best buy.',
        ...pos('opening_8ply'),
        task: 'match-best',
      },
      {
        id: 'maze-advance',
        title: 'Keep moving through the maze',
        explain: 'Walls everywhere? The race continues anyway. Find any step that shortens your own route — progress compounds.',
        ...pos('midgame_maze'),
        task: 'advance',
      },
    ],
  },
  {
    id: 'openings',
    title: 'Openings',
    description: 'The first six moves set the maze. Classical ideas: occupy the center early, answer a flank wall on the opposite flank.',
    steps: [
      {
        id: 'classical-6',
        title: 'Play the classical sixth move',
        explain: 'After mutual advances, strong players develop the center before committing walls. Match the reference continuation.',
        ...pos('opening_6ply'),
        task: 'match-best',
      },
      {
        id: 'classical-8',
        title: 'Commit to a plan on move eight',
        explain: 'By move eight the maze has a shape: either extend your corridor or start bending theirs. The reference finds the efficient buy.',
        ...pos('opening_8ply'),
        task: 'match-best',
      },
    ],
  },
  {
    id: 'traps',
    title: 'Traps and cages',
    description: 'Related walls convert at rates that decide games. Build cages that force long detours — never illegal seals.',
    steps: [
      {
        id: 'cage-one',
        title: 'Close the first side',
        explain: 'A cage starts with one strong wall that more than triples the detour it creates. Find the +3 wall.',
        ...pos('choke_b'),
        task: 'wall-gain',
        needGain: 3,
      },
      {
        id: 'cage-two',
        title: 'Tighten the net',
        explain: 'With one wall down, the second wall in the same sector is often even cheaper. Strike again for +3.',
        ...pos('choke_trap'),
        task: 'wall-gain',
        needGain: 3,
      },
    ],
  },
  {
    id: 'endgames',
    title: 'Endgames',
    description: 'Convert leads: count routes, conserve the last walls, and never let a finished race reopen.',
    steps: [
      {
        id: 'convert',
        title: 'Convert the lead',
        explain: 'One step from home with a clear file: finish. Endgames punish every wasted tempo — arrival beats elegance.',
        ...pos('endgame_mate1'),
        task: 'finish',
      },
      {
        id: 'race-home',
        title: 'Race a cluttered board home',
        explain: 'Late maze, walls spent: shorten your route every turn and let the opponent solve their own problems.',
        ...pos('midgame_maze'),
        task: 'advance',
      },
    ],
  },
];

export function findStep(lessonId: string, stepId: string): { lesson: Lesson; step: LessonStep } | null {
  const lesson = CURRICULUM.find((l) => l.id === lessonId) ?? null;
  if (lesson === null) return null;
  const step = lesson.steps.find((s) => s.id === stepId) ?? null;
  if (step === null) return null;
  return { lesson, step };
}
