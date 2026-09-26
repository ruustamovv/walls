"""BFS mirror of engine/typescript/pathfinding/bfs.ts.

Measures wall-constrained steps from a pawn to its goal row. Pawn jumps are
NOT modelled (same conservative choice as TS): this answers route-existence
for the no-seal rule, not optimal jump play.
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class Pos:
    r: int
    c: int


@dataclass(frozen=True)
class Wall:
    r: int
    c: int
    orientation: str  # 'h' | 'v'


def goal_row_for(player: int, size: int) -> int:
    return size - 1 if player == 0 else 0


def _blocked(a: Pos, b: Pos, walls: set[Wall]) -> bool:
    """True when a wall segment blocks the orthogonal step a -> b."""
    dr, dc = b.r - a.r, b.c - a.c
    if dr == -1 and dc == 0:  # moving up: h-wall on the groove above a
        return any(w.orientation == "h" and w.r == a.r - 1 and w.c in (a.c - 1, a.c) for w in walls)
    if dr == 1 and dc == 0:  # moving down
        return any(w.orientation == "h" and w.r == a.r and w.c in (a.c - 1, a.c) for w in walls)
    if dr == 0 and dc == -1:  # moving left
        return any(w.orientation == "v" and w.c == a.c - 1 and w.r in (a.r - 1, a.r) for w in walls)
    if dr == 0 and dc == 1:  # moving right
        return any(w.orientation == "v" and w.c == a.c and w.r in (a.r - 1, a.r) for w in walls)
    return True


def neighbors(cell: Pos, walls: set[Wall], size: int) -> list[Pos]:
    out: list[Pos] = []
    for nxt in (Pos(cell.r - 1, cell.c), Pos(cell.r + 1, cell.c),
                Pos(cell.r, cell.c - 1), Pos(cell.r, cell.c + 1)):
        if 0 <= nxt.r < size and 0 <= nxt.c < size and not _blocked(cell, nxt, walls):
            out.append(nxt)
    return out


def find_shortest_path(pawn: Pos, walls: set[Wall], size: int, player: int,
                       ) -> tuple[int, list[Pos]]:
    """Return (length, path). length == -1 when unreachable."""
    goal = goal_row_for(player, size)
    if pawn.r == goal:
        return 0, [pawn]
    prev: dict[Pos, Pos | None] = {pawn: None}
    queue: deque[Pos] = deque([pawn])
    found: Pos | None = None
    while queue:
        cur = queue.popleft()
        for nxt in neighbors(cur, walls, size):
            if nxt in prev:
                continue
            prev[nxt] = cur
            if nxt.r == goal:
                found = nxt
                queue.clear()
                break
            queue.append(nxt)
    if found is None:
        return -1, []
    path = [found]
    while prev[path[-1]] is not None:
        path.append(prev[path[-1]])  # type: ignore[arg-type]
    path.reverse()
    return len(path) - 1, path


def has_path_to_goal(pawn: Pos, walls: set[Wall], size: int, player: int) -> bool:
    return find_shortest_path(pawn, walls, size, player)[0] >= 0
