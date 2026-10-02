/**
 * Architect — natural-language board generator (AIC-008).
 *
 * Pipeline, in strict order:
 *   1. Deterministic template: parse the prompt for difficulty keywords and a
 *      requested choke-point count, then lay down a board from a seeded PRNG.
 *      Always available, fully reproducible, no AI needed.
 *   2. (Optional) LLM proposal: when a provider is configured, the model may
 *      only adjust {size, wallsPerPlayer, theme} inside strict bounds. It can
 *      never place a wall or claim legality — that is the engine's job.
 *   3. Engine validation gate: EVERY proposal (template or LLM) is replayed
 *      through the real rules — each wall placed with `validateMove`, then
 *      both pawns must have a live route (`findShortestPath`). Invalid
 *      proposals are rejected with the engine's own reason string.
 *
 * The engine is the sole authority on legality. The LLM is a parameter
 * suggester, never a source of truth.
 */
import {
  createGame,
  findShortestPath,
  validateMove,
  type GameState,
  type Wall,
} from '../../../../engine/typescript/dist/index.js';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface ArchitectRequest {
  prompt: string;
}

export interface ArchitectSpec {
  size: number;
  wallsPerPlayer: number;
  theme: string;
  difficulty: Difficulty;
  /** Requested number of choke points the template should try to create. */
  chokes: number;
}

/** Hard bounds for ANY source (template or LLM). */
export const SIZE_MIN = 7;
export const SIZE_MAX = 19;
export const WALLS_MIN = 4;
export const WALLS_MAX = 30;
export const CHOKES_MAX = 4;

const THEMES = ['stone', 'maze', 'atrium', 'ridge', 'weave', 'pillar'] as const;

/** Difficulty defaults (keyword overrides win). */
const DIFFICULTY_DEFAULTS: Record<Difficulty, { size: number; wallsPerPlayer: number; chokes: number }> = {
  easy: { size: 7, wallsPerPlayer: 4, chokes: 0 },
  medium: { size: 9, wallsPerPlayer: 10, chokes: 1 },
  hard: { size: 11, wallsPerPlayer: 18, chokes: 2 },
};

/** xorshift32 — deterministic, no crypto, identical in browser and node. */
function makeRng(seed: number): () => number {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

export function hashPrompt(prompt: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Parse the prompt into a bounded spec. Keywords only — no model. Number
 * words ("two choke points") are understood alongside digits.
 */
export function parsePrompt(prompt: string): ArchitectSpec {
  const text = prompt.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => text.includes(w));

  const difficulty: Difficulty = has('trivial', 'easy', 'beginner', 'rookie', 'simple', 'casual', 'sandbox')
    ? 'easy'
    : has('brutal', 'nightmare', 'hard', 'expert', 'tough', 'devious', 'impossible-ish')
      ? 'hard'
      : 'medium';
  const base = DIFFICULTY_DEFAULTS[difficulty];

  // Explicit size wins over the difficulty default.
  let size = base.size;
  const sizeWord: Record<string, number> = { seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fifteen: 15, seventeen: 17, nineteen: 19 };
  const digits = /(\d{1,2})\s*(?:x|by|rows?)?/.exec(text);
  if (digits !== null) {
    const n = Number(digits[1]);
    if (Number.isInteger(n) && n >= SIZE_MIN && n <= SIZE_MAX) size = n;
  } else {
    for (const [word, n] of Object.entries(sizeWord)) {
      if (text.includes(`${word} by ${word}`) || text.includes(`${word}x${word}`) || text.includes(`${word} by`) || text.includes(`${word} square`)) {
        size = n;
        break;
      }
    }
  }

  // Choke-point count: "two choke points", "3 chokepoints", "lots of choke".
  let chokes = base.chokes;
  const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, a: 1, an: 1, single: 1, couple: 2, few: 2, several: 3 };
  // Word boundaries are essential: without them the greedy filler matches
  // inside ordinary words ("b[a]rd with two choke" would yield "one choke").
  const chokeMatch = /\b(one|two|three|four|a|an|single|couple|few|several|\d{1,2})\b\s*(?:[a-z]+\s+){0,2}?(?:choke|gate|narrow)/.exec(text);
  if (chokeMatch !== null) {
    const token = chokeMatch[1] ?? '';
    const n = /^\d+$/.test(token) ? Number(token) : (numberWords[token] ?? 0);
    if (n > 0) chokes = Math.min(CHOKES_MAX, n);
  } else if (has('lots of choke', 'many choke', 'heavily choked', 'choked')) {
    chokes = Math.min(CHOKES_MAX, chokes + 1);
  }

  const wallsPerPlayer = Math.min(WALLS_MAX, Math.max(WALLS_MIN, base.wallsPerPlayer));
  return { size, wallsPerPlayer, theme: pickTheme(text), difficulty, chokes };
}

function pickTheme(text: string): string {
  for (const t of THEMES) if (text.includes(t)) return t;
  const idx = ['atrium', 'ridge', 'weave', 'pillar', 'maze'].findIndex((t) => text.includes(t));
  return idx >= 0 ? ['atrium', 'ridge', 'weave', 'pillar', 'maze'][idx] as string : 'stone';
}

export interface ValidationFailure {
  ok: false;
  reason: string;
  /** Which stage produced the rejection. */
  stage: 'bounds' | 'engine';
  /** Walls that were already accepted before the failure. */
  acceptedWalls: Wall[];
}

export interface ValidationSuccess {
  ok: true;
  state: GameState;
  walls: Wall[];
  routeA: number;
  routeB: number;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

function clampSpec(spec: ArchitectSpec): ArchitectSpec {
  const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(spec.size)));
  return {
    ...spec,
    size,
    wallsPerPlayer: Math.min(WALLS_MAX, Math.max(WALLS_MIN, Math.round(spec.wallsPerPlayer))),
    chokes: Math.min(CHOKES_MAX, Math.max(0, Math.round(spec.chokes))),
  };
}

/**
 * THE GATE. Replays a proposed wall list through the real engine.
 * Returns the engine's own rejection reason — never a guess.
 */
export function validateDesign(proposal: {
  size: number;
  walls: readonly Wall[];
}): ValidationResult {
  if (!Number.isInteger(proposal.size) || proposal.size < SIZE_MIN || proposal.size > SIZE_MAX) {
    return {
      ok: false, stage: 'bounds', acceptedWalls: [],
      reason: `board size ${String(proposal.size)} outside allowed ${SIZE_MIN}-${SIZE_MAX}`,
    };
  }
  let state = createGame({ size: proposal.size, wallsPerPlayer: WALLS_MAX });
  const accepted: Wall[] = [];
  for (const wall of proposal.walls) {
    // Ask the engine, per wall, in the current position.
    const verdict = validateMove(state, { type: 'wall', wall });
    if (!verdict.ok) {
      return {
        ok: false, stage: 'engine', acceptedWalls: accepted,
        reason: `wall at row ${wall.r}, column ${wall.c} rejected by engine: ${verdict.reason ?? 'illegal'}`,
      };
    }
    state = applyWall(state, wall);
    accepted.push({ ...wall });
  }
  const routeA = findShortestPath(state, 0).length;
  const routeB = findShortestPath(state, 1).length;
  if (routeA < 0 || routeB < 0) {
    const sealed = routeA < 0 ? 0 : 1;
    return {
      ok: false, stage: 'engine', acceptedWalls: accepted,
      reason: `engine reports pawn ${sealed + 1} sealed off from its goal — board is unplayable`,
    };
  }
  return {
    ok: true,
    state: { ...state, wallsPerPlayer: Math.min(WALLS_MAX, accepted.length) },
    walls: accepted,
    routeA,
    routeB,
  };
}

/** Local wall application (mirrors the engine's applyMove for walls only). */
function applyWall(state: GameState, wall: Wall): GameState {
  const wallsRemaining = [...state.wallsRemaining] as [number, number];
  wallsRemaining[state.turn] = Math.max(0, wallsRemaining[state.turn] - 1);
  return {
    ...state,
    walls: [...state.walls, { ...wall }],
    wallsRemaining,
    turn: (state.turn === 0 ? 1 : 0) as 0 | 1,
    moveNumber: state.moveNumber + 1,
  };
}

/**
 * Theme-driven wall layout attempt. Choke points are attempted first (mid-board
 * walls across a corridor), then filler walls in the theme's pattern. Every
 * wall still goes through the engine gate, so a theme that cannot fit simply
 * yields fewer walls rather than an illegal board.
 */
function layoutWalls(spec: ArchitectSpec, rng: () => number): Wall[] {
  const { size } = spec;
  const slots: Wall[] = [];
  const mid = Math.floor(size / 2);

  const push = (r: number, c: number, orientation: 'h' | 'v'): void => {
    if (r < 0 || c < 0 || r > size - 2 || c > size - 2) return;
    if (slots.some((w) => w.r === r && w.c === c)) return;
    // Mirror the engine's collinear half-overlap rule: a 2-cell piece already
    // covers its own span, so a neighbour one slot away would sit half on top
    // of it. Only slots 2 apart (clean end-to-end) are accepted.
    if (slots.some((w) => w.orientation === orientation && (
      (orientation === 'h' && w.r === r && Math.abs(w.c - c) === 1) ||
      (orientation === 'v' && w.c === c && Math.abs(w.r - r) === 1)
    ))) return;
    slots.push({ r, c, orientation });
  };

  // Choke points: paired walls forming a gap the opponent must funnel through.
  for (let i = 0; i < spec.chokes; i++) {
    const band = spec.chokes === 1 ? mid : 2 + Math.floor((i * (size - 4)) / Math.max(1, spec.chokes));
    const centre = 1 + Math.floor(rng() * Math.max(1, size - 2));
    if (spec.theme === 'ridge' || spec.theme === 'stone') {
      push(band, Math.max(0, centre - 1), 'v');
      push(band, Math.min(size - 2, centre + 1), 'v');
    } else {
      push(band, centre, 'h');
      push(band + 1, Math.max(0, centre - 1), 'v');
    }
  }

  // Theme filler patterns.
  const target = Math.min(WALLS_MAX, spec.wallsPerPlayer);
  let guard = 0;
  while (slots.length < target && guard < target * 40) {
    guard++;
    const r = Math.floor(rng() * (size - 1));
    const c = Math.floor(rng() * (size - 1));
    const orientation: 'h' | 'v' = rng() < 0.5 ? 'h' : 'v';
    switch (spec.theme) {
      case 'maze':
        if ((r + c) % 2 === 0) push(r, c, orientation);
        break;
      case 'atrium':
        if (r === mid || c === mid) push(r, c, orientation);
        break;
      case 'pillar':
        if (r % 2 === 0 && c % 2 === 0) push(r, c, orientation);
        break;
      case 'weave':
        push(r, c, orientation);
        break;
      case 'ridge':
        push(r, c, r % 3 === 0 ? 'v' : 'h');
        break;
      case 'stone':
      default:
        push(r, c, orientation);
        break;
    }
  }
  return slots;
}

export interface ArchitectResult {
  ok: boolean;
  /** Which tier produced the accepted board. */
  source: 'template' | 'llm' | null;
  spec: ArchitectSpec;
  /** Encoded position payload for the share link (set when ok). */
  code: string | null;
  state: GameState | null;
  walls: Wall[];
  routeA: number;
  routeB: number;
  /** Engine rejection reason (set when !ok). */
  reason: string | null;
  stage: 'bounds' | 'engine' | null;
  notes: string[];
}

/** base64 position payload — same shape the frontend `encodePosition` reads. */
export function encodeDesign(state: GameState): string {
  const slim = {
    size: state.size,
    wallsPerPlayer: state.wallsPerPlayer,
    turn: state.turn,
    pawns: state.pawns,
    walls: state.walls,
    wallsRemaining: state.wallsRemaining,
  };
  return Buffer.from(JSON.stringify(slim), 'utf8').toString('base64');
}

/** Deterministic tier: same prompt always yields the same board. */
export function designFromTemplate(prompt: string): ArchitectResult {
  const parsed = parsePrompt(prompt);
  const spec = clampSpec(parsed);
  const rng = makeRng(hashPrompt(prompt));
  const walls = layoutWalls(spec, rng);
  const verdict = validateDesign({ size: spec.size, walls });
  if (!verdict.ok) {
    return {
      ok: false, source: null, spec, code: null, state: null, walls: verdict.acceptedWalls,
      routeA: 0, routeB: 0, reason: verdict.reason, stage: verdict.stage,
      notes: [`template rejected after ${verdict.acceptedWalls.length} walls`],
    };
  }
  return {
    ok: true, source: 'template', spec, code: encodeDesign(verdict.state), state: verdict.state,
    walls: verdict.walls, routeA: verdict.routeA, routeB: verdict.routeB, reason: null, stage: null,
    notes: [`deterministic ${spec.difficulty} board, ${verdict.walls.length} walls`],
  };
}

/**
 * Full pipeline. `llmSpec` is an optional AI suggestion of {size, wallsPerPlayer,
 * theme} — clamped and then validated exactly like the template output. The
 * model can never inject walls.
 */
export async function designBoard(
  userId: string,
  prompt: string,
  llmSpec: { size?: unknown; wallsPerPlayer?: unknown; theme?: unknown } | null = null,
): Promise<ArchitectResult> {
  const template = designFromTemplate(prompt);
  const notes: string[] = [];

  if (llmSpec === null) {
    if (!template.ok) return { ...template, notes: [...notes, ...template.notes] };
    return { ...template, notes: [...notes, ...template.notes] };
  }

  const base = template.spec;
  const size = Number(llmSpec.size);
  const walls = Number(llmSpec.wallsPerPlayer);
  const theme = typeof llmSpec.theme === 'string' ? llmSpec.theme.slice(0, 24) : base.theme;
  const merged = clampSpec({
    ...base,
    size: Number.isFinite(size) ? size : base.size,
    wallsPerPlayer: Number.isFinite(walls) ? walls : base.wallsPerPlayer,
    theme,
  });
  notes.push('AI proposed parameters; engine re-validated');

  if (merged.size === template.spec.size && merged.wallsPerPlayer === template.spec.wallsPerPlayer && merged.theme === template.spec.theme && template.ok) {
    notes.push('AI suggestion matched the deterministic template; keeping the verified board');
    return { ...template, notes };
  }

  const rng = makeRng(hashPrompt(prompt) ^ 0x5bf03635);
  const wallsOut = layoutWalls(merged, rng);
  const verdict = validateDesign({ size: merged.size, walls: wallsOut });
  if (!verdict.ok) {
    notes.push(`AI proposal rejected: ${verdict.reason}`);
    if (template.ok) {
      notes.push('fell back to the deterministic template board');
      return { ...template, notes };
    }
    return {
      ok: false, source: null, spec: merged, code: null, state: null, walls: verdict.acceptedWalls,
      routeA: 0, routeB: 0, reason: verdict.reason, stage: verdict.stage, notes,
    };
  }
  return {
    ok: true, source: 'llm', spec: merged, code: encodeDesign(verdict.state), state: verdict.state,
    walls: verdict.walls, routeA: verdict.routeA, routeB: verdict.routeB, reason: null, stage: null,
    notes,
  };
}

/**
 * Ask the configured provider for PARAMETERS ONLY. Strictly bounded output:
 * the model may return {size, wallsPerPlayer, theme} and nothing else — it is
 * never allowed to describe or place walls. Returns null when no provider is
 * configured or the reply is unusable, in which case the deterministic tier
 * stands on its own.
 */
export async function proposeSpec(
  userId: string,
  prompt: string,
  parsed: ArchitectSpec,
): Promise<{ size?: unknown; wallsPerPlayer?: unknown; theme?: unknown } | null> {
  const { activeProvider } = await import('../ai/provider.js');
  const { proposeArchitectSpec } = await import('../ai/complete.js');
  const provider = activeProvider();
  if (provider === null) return null;
  const result = await proposeArchitectSpec(userId, provider.id, {
    prompt: prompt.slice(0, 500),
    difficulty: parsed.difficulty,
    chokes: parsed.chokes,
    size: parsed.size,
    wallsPerPlayer: parsed.wallsPerPlayer,
    theme: parsed.theme,
  });
  return result.ok ? result.spec : null;
}