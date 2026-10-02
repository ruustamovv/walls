# Special party modes (MLT-009)

Status per mode is stated explicitly below. Nothing here is aspirational:
"implemented" means engine rules exist, the backend exposes the flag, the UI
renders it, and tests cover it.

Canonical presets live in `MULTI_PRESETS` (`engine/typescript/multi/types.ts`).
Backend (`MultiGamesService`) and frontend (`MultiGamePage`) derive defaults from
that single source.

All modes default to **off**. A game created without flags behaves exactly as
before, and every snapshot keeps its full wall list.

---

## Team 2v2 — IMPLEMENTED

Seats split into two teams: **seats 1+3 vs seats 2+4** (0-indexed `0+2` vs
`1+3`). The first seat to reach its own goal wins **for its whole team**; the
game ends immediately. Teammates never play back-to-back.

| Property | Value |
|---|---|
| Engine flag | `MultiConfig.teamMode` (default `false`) |
| State | `teamOf: number[] \| null`, `winningTeam: number \| null` |
| Preset | `MULTI_PRESETS.team4` (4 seats, 9×9, 5 walls/player) |
| Seat counts | 2 or 4 only — others throw `Team mode needs 2 or 4 seats` |
| Backend option | `POST /api/v1/multi/games { teamMode: true }` |
| Exclusivity | Mutually exclusive with `continueForPlacement` |
| Settlement | Casual only; no rating writes. Both sides notified ("Your team won/lost…") |

`winnerSeat` records *which* seat finished; `winningTeam` carries the team. No
elimination is recorded — team mode ends at the first goal.

---

## Fog of war — IMPLEMENTED

Each seat sees only the walls **adjacent to its own pawn**; everything further
away stays hidden until the game ends, when the full board is revealed for
review.

| Property | Value |
|---|---|
| Engine flag | `MultiConfig.fog` (default `false`) |
| Projection | `visibleWalls(state, seat)` / `hiddenWallCount` / `fogMap` in `engine/typescript/multi/fog.ts` |
| Server | `MultiGamesService.snapshot(g, viewerSeat)`; `emitMultiState` / `emitMultiStateTo` in `realtime/sockets/multi-fog.ts` |
| Backend option | `POST /api/v1/multi/games { fog: true }` |
| Client signal | `snapshot.fog`, `snapshot.hiddenWalls` |

**Why it is server-side, not client-side.** Hiding walls in the browser would
still ship the full wall list over the socket, so any player could read it from
devtools. `emitMultiState` therefore sends **one payload per seat**; a shared
room broadcast would hand the whole board to everyone and make the mode a lie.
Non-fog games keep the cheap single-broadcast path.

**Visibility rule.** A wall is visible when it lies next to (Chebyshev ≤ 1)
either cell the wall separates, relative to your own pawn. It is deliberately
geometric rather than per-owner: the engine stores walls in one flat list
without authorship, so "which seat placed this?" is not answerable from state.
Proximity is both answerable and fairer — you always see the walls right around
you.

**Never hidden:** pawn positions and the board grid. A player must see the full
grid to make a legal decision, and hiding a pawn would break move validation.
Only the existence of distant walls is hidden. The engine validates every
action against **true state**, never a fogged projection.

**Spectators** (no seat, or unknown user) receive nothing hidden-but-local — they
never get the full board. An out-of-range seat index is treated as a spectator,
not as "reveal all".

---

## Chaos — IMPLEMENTED

The wall budget **rotates** between seats on a fixed cadence, so nobody can bank
an arsenal for a late push.

| Property | Value |
|---|---|
| Engine flag | `MultiConfig.chaos` (default `false`) |
| Cadence | `CHAOS_ROTATION_PLIES = 6` plies |
| Rule | On each cadence tick, one wall moves from the seat with the most remaining to the seat with the fewest |
| Backend option | `POST /api/v1/multi/games { chaos: true }` |
| Determinism | **Requires a seed** |

**A seed is mandatory.** `replayMultiGame` reconstructs state from the action
log alone, so an unseeded rotation could never be reproduced — the engine throws
`Chaos mode requires a seed for deterministic replay`. The backend always seeds
a chaos game and stores the seed on the state, so replays and hashes stay
reproducible.

The rotation **conserves the total budget**: walls come out of the same pool
that placed walls come from, which the tests assert directly
(`total === base − wallsPlaced`). It is disabled in the UI when team or siege
mode is active, where the economy is deliberately asymmetric.

---

## Siege — IMPLEMENTED

Asymmetric 1v1: one attacker with extra walls and a head start against one
defender on the standard economy.

| Property | Value |
|---|---|
| Engine flag | `MultiConfig.siege` (default `false`) |
| Attacker | Seat 0 starts **one row in** (`siegeHeadStart = 1`) and gets `SIEGE_WALL_BONUS = 4` extra walls |
| Defender | Seat 1 unchanged |
| Backend option | `POST /api/v1/multi/games { siege: true }` |
| Seat counts | 2 only (UI disables the checkbox otherwise) |

The no-seal rule still applies to both sides, and the attacker's extra walls
flow through the same budget accounting as everyone else's.

---

## Ranking policy

All four modes are **casual-only** and write **no ratings**, exactly like every
other multi variant (`modules/multiGames/finish.ts`). There is no rated team,
fog, chaos or siege queue. Results are recorded in the game journal and replays
as usual.

## Feature-flag posture

None of these modes are behind a runtime `feature_flags` toggle. They are
explicit per-game options validated server-side, because each one is fully
implemented: there is no flag that enables unplayable behaviour. Invalid
combinations are rejected with a precise reason rather than silently ignored —
for example team mode on 3 seats, or chaos without a seed.