# Multiplayer board scaling + wall economy (MLT-006)

Canonical defaults live in `MULTI_PRESETS` / `presetForPlayers()`
(`engine/typescript/multi/types.ts`). Backend (`MultiGamesService`) and
frontend (`MultiGamePage`) derive quick-match defaults from it — there is
exactly one source of scaling truth.

| Seats | Label | Board | Walls/player | Rationale |
|------:|-------|------:|-------------:|-----------|
| 2 | 1v1 | 15×15 | 20 | Ranked standard arena (matchmaking preset) |
| 2 | duel | 9×9 | 10 | Classic casual duel |
| 3 | 2v1 | 13×13 | 10 | Roomier triangle (S,E,W starts) |
| 4 | 3v1 | 9×9 | 5 | Classic 4P wall distribution |
| 4 | 2v2 team | 9×9 | 5 | `MULTI_PRESETS.team4` — same geometry as party4, teams 0+2 vs 1+3 (MLT-009) |
| 5 | 4v1 | 19×19 | 8 | Shared S edge w/ offset lanes; room to maneuver |
| 6 | 5v1 | 21×21 | 8 | Shared S+N edges w/ offset lanes |

Wall economy reasoning: total walls scale sub-linearly with board area so
wall density stays playable (4P: 20 walls on 81 cells; 6P: 48 on 441).
Values are initial balancing, adjustable per mode.

## Self-play measurements (2026-09-30, identical mid bots)

Small samples — directional only, not final truth. Method: `chooseMultiBotAction`
round-robin to goal, seeds varied per game.

| Preset | Games | Avg plies | Avg walls | Wins by seat |
|--------|------:|----------:|----------:|--------------|
| duel 9×9/10 (30ms) | 8 | 74 | 19.3 | s0:1 s1:7 |
| trio13 (30ms) | 8 | 43 | 5.3 | s0:2 s1:3 s2:3 |
| party4 9×9/5 (30ms) | 8 | 64 | 11.6 | spread 2/3/2/1 |
| party5 19×19/8 (200ms) | 6 | 97 | 7.2 | spread 2/1/2/1/0 |
| party6 21×21/8 (200ms) | 6 | 125 | 7.3 | spread 0/2/1/0/1/2 |

Findings:
- 5P/6P terminate in healthy lengths (~20 moves/player), walls used, no
  runaway seat bias at adequate budgets.
- At 30ms on 19×19+, wall ranking starves and bots never wall (all-race
  artifact, one seat wins every time) — evidence for adaptive budgets
  (BOT-003): big boards need bigger minimum search, now enforced via
  `adaptiveBudgetMs` in local drivers.
- duel shows a possible second-seat edge in this pool (7/8); sample far too
  small to act on — tracked for the full-matrix run (BOT-005).

## 2–4P quick numbers (BAL-002, same method, 30ms, 8 games each)

| Preset | Avg plies | Avg walls | Wins by seat |
|--------|----------:|----------:|--------------|
| duel 9×9/10 | 74 | 19.3 | s0:1 s1:7 |
| trio13 | 43 | 5.3 | s0:2 s1:3 s2:3 |
| party4 9×9/5 | 64 | 11.6 | spread 2/3/2/1 |

Reads: trio and 4P show no seat bias in this pool; duel's 7/8 for seat 1
is a flag, not a finding (n=8, mover-style bots). No preset changes
proposed — 2–4P stay as configured until the full matrix lands.
