/**
 * Micro-benchmark: wall enumeration + shortest-path cost on each preset.
 * Run with `pnpm benchmark`. Prints timings only; exits non-zero on error.
 */
import { BOARD_PRESETS, type GameConfig } from '../index.js';
import { findShortestPath, getPathMetrics } from '../pathfinding/bfs.js';
import { applyMove, createGame } from '../rules/game.js';
import { getLegalWalls } from '../rules/walls.js';

function ms(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function runPreset(name: string, cfg: GameConfig): void {
  const s0 = createGame({ ...cfg });
  // Time full legal-wall enumeration (dominated by 2x BFS per candidate).
  let walls = 0;
  const enumMs = ms(() => {
    walls = getLegalWalls(s0, 0).length;
  });

  // Time shortest-path queries.
  const bfsMs = ms(() => {
    for (let i = 0; i < 200; i++) {
      findShortestPath(s0, 0);
      findShortestPath(s0, 1);
    }
  });

  // A mid-game position with several walls, for a more realistic sample.
  let s = createGame({ ...cfg });
  const mid = Math.floor(cfg.size / 2);
  const wallSpots = [
    { r: mid - 1, c: mid - 2 },
    { r: mid - 1, c: mid },
  ] as const;
  let k = 0;
  for (const spot of wallSpots) {
    for (const o of ['h', 'v'] as const) {
      if (k % 2 === 0) {
        try {
          s = applyMove(s, { type: 'wall', wall: { r: spot.r, c: spot.c, orientation: o } }).state;
        } catch {
          /* slot taken or illegal in this preset; ignore */
        }
      }
      k++;
    }
    s = applyMove(s, {
      type: 'move',
      to: { r: s.pawns[s.turn].r + (s.turn === 0 ? 1 : -1), c: s.pawns[s.turn].c },
    }).state;
  }
  const m = getPathMetrics(s);
  const midMs = ms(() => {
    for (let i = 0; i < 200; i++) getPathMetrics(s);
  });

  console.log(
    `${name} (${cfg.size}x${cfg.size}, ${cfg.wallsPerPlayer} walls): ` +
      `legalWalls=${walls} in ${enumMs.toFixed(1)}ms; ` +
      `400x BFS in ${bfsMs.toFixed(1)}ms; ` +
      `mid-game metrics(A=${m.pathLengthA},B=${m.pathLengthB}) 200x in ${midMs.toFixed(1)}ms`,
  );
}

for (const [name, cfg] of Object.entries(BOARD_PRESETS)) {
  runPreset(name, { size: cfg.size, wallsPerPlayer: cfg.wallsPerPlayer });
}
