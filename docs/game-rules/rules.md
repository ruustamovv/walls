# Game rules (original wall-and-pawn duel)

> Plain-language companion to the deterministic implementation in
> `engine/typescript`. On any conflict, the engine + its tests win.

## Goal
Be the first pawn to reach the opposite edge. Player 0 starts top row and
races down; Player 1 starts bottom row and races up. Reaching any cell of
your goal row wins immediately, even on your opponent's idea of a bad day.

## Board & setup
- Square grid of cells (row 0 = top). Pawns start centred:
  P0 at `(0, mid)`, P1 at `(size-1, mid)`, `mid = floor(size/2)`.
- Each player holds an equal wall stock from the mode preset.

## Modes (presets; custom sizes configurable)
| Mode | Board | Walls each | Character |
|------|-------|-----------|-----------|
| Duel 9 | 9×9 | 10 | sharp tactics, short games |
| Arena 15 | 15×15 | 20 | positional routes, mid length |
| Siege 17 | 17×17 | 30 | long sieges, fortress play |

Any integer `size ≥ 5` and any `wallsPerPlayer ≥ 0` are legal custom
settings; presets are shortcuts (`BOARD_PRESETS` in `core/types.ts`).

## Turn structure — move OR wall
On your turn do exactly one: **move** your pawn, or **place** one wall
(if any remain). Passing is not allowed.

## Pawn movement
- Orthogonal step (up/down/left/right) into a free adjacent cell not
  blocked by a wall or the board edge.
- **Face-to-face jump:** if the opponent pawn stands on an adjacent free
  path, you must leap *over* it straight ahead when that landing cell is
  free and unblocked.
- **Diagonal sidestep:** when the straight landing behind the opponent is
  blocked (wall, edge, or occupied), you may instead step diagonally to
  either free cell beside the opponent. This keeps duels fluid at contact.
- You may never land on the opponent's cell or leave the board.

## Wall placement
- Walls sit on the grooves between cells (`0 ≤ r,c ≤ size-2`), oriented
  horizontal (`h`, blocks vertical traffic) or vertical (`v`, blocks
  horizontal traffic), spanning two cells each.
- Illegal: duplicates, crossing an opposite-orientation wall through the
  same groove centre, or placements hanging off the board.
- **No-seal rule:** a wall is rejected if *either* pawn would lose every
  route to its goal row (checked by BFS over wall-constrained steps —
  jumps excluded, which is the conservative quantity the rule needs).

## Clocks
- Each game configures `initialMs + incrementMs` per player.
- Your clock runs on your turn only; flag (timeout) loses unless the
  opponent cannot possibly force a win, in which case it is a draw
  (arbiter-confirmed in tournaments).
- Server time is authoritative; client displays are estimates.

## Offers & endings
- Win by goal row or opponent flag/resign; draws by mutual agreement or
  arbiter ruling. Disconnects grant a reconnect grace window, then forfeit.
