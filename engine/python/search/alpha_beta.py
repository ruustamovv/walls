"""Depth-limited alpha-beta search stub over the game action space.

Concrete move generation binds to the TS engine (Phase 02/09); this module
defines the search skeleton + heuristic signature so simulation and API work
can proceed against a stable interface.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class SearchConfig:
    max_depth: int = 2
    max_width: int = 24  # cap on actions scored per node


@dataclass
class ScoredAction:
    action: dict
    score: float = 0.0


# Heuristic: higher = better for `player`. Receives a serialised GameState-ish
# mapping with at least {size, pawns, walls, wallsRemaining, turn}.
HeuristicFn = Callable[[dict, int], float]


def evaluate_material_proxy(state: dict, player: int) -> float:
    """Placeholder heuristic: wall-stock parity only (real one in evaluation/)."""
    mine = state.get("wallsRemaining", [0, 0])[player]
    theirs = state.get("wallsRemaining", [0, 0])[1 - player]
    return float(mine - theirs)


def alpha_beta(root: dict, player: int, actions_fn: Callable[[dict, int], list[dict]],
               heuristic: HeuristicFn = evaluate_material_proxy,
               config: SearchConfig = SearchConfig()) -> ScoredAction | None:
    """One-ply stub with alpha-beta-ready signature; full recursion in Phase 09."""

    def negamax(state: dict, turn: int, depth: int, alpha: float, beta: float) -> float:
        if depth == 0:
            return heuristic(state, player) * (1 if turn == player else -1)
        best = float("-inf")
        for action in actions_fn(state, turn)[: config.max_width]:
            child = {**state, "lastAction": action, "turn": 1 - turn}
            score = -negamax(child, 1 - turn, depth - 1, -beta, -alpha)
            best = max(best, score)
            alpha = max(alpha, best)
            if alpha >= beta:
                break
        return best if best != float("-inf") else heuristic(state, player)

    scored = [
        ScoredAction(action=a, score=-negamax({**root, "lastAction": a, "turn": 1 - root.get("turn", 0)},
                                             1 - root.get("turn", 0), config.max_depth - 1,
                                             float("-inf"), float("inf")))
        for a in actions_fn(root, player)[: config.max_width]
    ]
    return max(scored, key=lambda s: s.score, default=None)
