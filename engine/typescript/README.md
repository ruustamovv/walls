# @nexus/engine

Deterministic, dependency-free TypeScript game engine for PROJECT_NEXUS
(original wall-and-pawn strategy platform). No proprietary code is used;
every module below is written from scratch for this project.

## Layout

- `core/types.ts` — `Pos`, `Wall`, `PlayerIndex`, `GameConfig`, `GameState`,
  `Action`, `ValidationResult`, `GameEvent`, presets, `RULES_VERSION`.
- `core/board.ts` — wall occupancy, `isBlockedBetween`, `getNeighbors`,
  geometric placement checks (bounds / duplicate / crossing).
- `pathfinding/bfs.ts` — `findShortestPath`, `getPathMetrics`, `hasPathToGoal`.
- `rules/moves.ts` — `getLegalMoves` (steps, straight jumps, diagonal jumps).
- `rules/walls.ts` — `validateWall`, `getLegalWalls` (geometry + inventory +
  both-players-keep-a-route rule).
- `rules/game.ts` — `createGame`, `validateMove`, `applyMove` (pure),
  `isGameOver`, `serializeState` / `deserializeState`, `hashState`, `replayGame`.
- `replay/replay.ts` — `buildReplay`, `verifyReplay` (per-step hash chain).
- `index.ts` — public API surface. Import from here.
- `benchmark/bench.ts` — timing harness for the three board presets.
- `tests/` — `node:test` suites (no test framework dependency).

## Coordinate conventions

- Row 0 is the TOP row. Player 0 starts top (`r = 0`) and races to the
  bottom (`r = size - 1`); Player 1 starts bottom and races to the top.
- Both pawns start in `mid = floor(size / 2)`.
- Wall slots form a `(size-1) x (size-1)` grid (`0 <= r,c <= size-2`):
  - `'h'` at `(r,c)` lies between rows `r`/`r+1`, spanning columns `c`,`c+1`.
  - `'v'` at `(r,c)` lies between columns `c`/`c+1`, spanning rows `r`,`r+1`.
- Overlap (same slot + orientation) and crossing (same slot, other
  orientation) are illegal. Collinear-adjacent walls are legal and simply
  build longer barriers; the path-preservation rule still guards every
  placement.

## Board configs

| Preset   | Size  | Walls/player |
|----------|-------|--------------|
| classic  | 9x9   | 10           |
| standard | 15x15 | 20           |
| siege    | 17x17 | 30           |

`createGame` accepts any integer `size >= 5` (odd or even) and any
non-negative wall count — presets are shortcuts, not limits.

## Usage

```ts
import { createGame, applyMove, getLegalMoves, getLegalWalls } from '@nexus/engine';

let g = createGame({ size: 9, wallsPerPlayer: 10 }); // classic
console.log(getLegalMoves(g)); // pawn destinations for the side to move
console.log(getLegalWalls(g, g.turn).length); // 128 on the empty 9x9 board

const { state, events } = applyMove(g, { type: 'move', to: { r: 1, c: 4 } });
g = state;
```

## rulesVersion notes

- `RULES_VERSION` (`'1.0.0'`) is stamped on every state by `createGame`
  (overridable via `config.rulesVersion`).
- `GameConfig.startingWalls` is a legacy alias for `wallsPerPlayer`; when
  present it takes precedence so older serialized configs keep working.
- Replay envelopes carry their own `REPLAY_VERSION`, independent of the
  rules version, so format changes and rule changes can evolve separately.
- `hashState` is FNV-1a over the canonical serialization (fixed key order,
  sorted walls) — synchronous and portable (no `node:crypto`, works in
  browsers). Any future rule change MUST bump `RULES_VERSION`.

## Tooling decision (vitest vs node:test)

Chose **`node:test` + `node:assert/strict`** over vitest:

- Zero test-framework dependencies: devDeps are `typescript` + `@types/node`
  only, so `pnpm test` works offline after install with no registry access.
- Tests compile with the rest of the project (`tsc`) and run on the emitted
  JS via `node --test "dist/tests/**/*.test.js"`, which also proves the
  build output works.
- Trade-off: no watch mode / fancy matchers; acceptable for a deterministic
  engine where tests are plain assertions.

## Scripts

- `pnpm build` — compile to `dist/`
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — stricter `tsc` pass (`--noUnusedLocals --noUnusedParameters`)
- `pnpm test` — build + `node --test "dist/tests/**/*.test.js"`
- `pnpm benchmark` — preset timing harness
