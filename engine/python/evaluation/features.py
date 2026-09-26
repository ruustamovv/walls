"""Heuristic feature list for position evaluation + AI review prompts.

Pure-python feature extractors over a serialised GameState-ish mapping.
Weights are illustrative; tuning happens against the simulation corpus
(Phase 09/10). Feature order is the model-input contract — do not reorder
without bumping FEATURE_VERSION.
"""
from __future__ import annotations

FEATURE_VERSION = "0.1.0"

FEATURES: list[str] = [
    "own_path_len",        # BFS steps for us (-1 if sealed — should never happen)
    "opp_path_len",        # BFS steps for opponent
    "path_delta",          # own - opp (negative favours us)
    "walls_mine",          # walls remaining (us)
    "walls_opp",           # walls remaining (opponent)
    "walls_delta",         # mine - opp
    "centre_control",      # 1 - normalised distance of our pawn to mid column
    "advancement",         # progress toward goal row, 0..1
    "opp_advancement",     # opponent progress toward their goal, 0..1
    "contact",             # 1 when pawns orthogonally adjacent (jump zone)
    "mobility",            # legal orthogonal steps available (proxy)
    "tempo",               # +1 our move, -1 theirs (side to move)
]

DEFAULT_WEIGHTS: dict[str, float] = {
    "own_path_len": -1.0, "opp_path_len": 1.0, "path_delta": -0.6,
    "walls_mine": 0.12, "walls_opp": -0.12, "walls_delta": 0.08,
    "centre_control": 0.25, "advancement": 0.9, "opp_advancement": -0.9,
    "contact": 0.1, "mobility": 0.15, "tempo": 0.2,
}


def extract(state: dict, player: int) -> dict[str, float]:
    """Compute the feature vector. BFS lengths may be injected by the caller
    (keys `pathLenMine`, `pathLenOpp`) until the TS binding lands."""
    size = int(state.get("size", 9))
    pawns = state.get("pawns", [{"r": 0, "c": 4}, {"r": 8, "c": 4}])
    me = pawns[player] if isinstance(pawns[player], dict) else {"r": pawns[player][0], "c": pawns[player][1]}
    op = pawns[1 - player] if isinstance(pawns[1 - player], dict) else {"r": pawns[1 - player][0], "c": pawns[1 - player][1]}
    wr = state.get("wallsRemaining", [10, 10])
    goal = size - 1 if player == 0 else 0
    start = 0 if player == 0 else size - 1
    adv = lambda row: (row - start) / (goal - start) if goal != start else 0.0
    mid = size // 2
    contact = 1.0 if abs(me["r"] - op["r"]) + abs(me["c"] - op["c"]) == 1 else 0.0
    own_len = float(state.get("pathLenMine", -2))
    opp_len = float(state.get("pathLenOpp", -2))
    return {
        "own_path_len": own_len, "opp_path_len": opp_len,
        "path_delta": own_len - opp_len if own_len >= -1 and opp_len >= -1 else 0.0,
        "walls_mine": float(wr[player]), "walls_opp": float(wr[1 - player]),
        "walls_delta": float(wr[player] - wr[1 - player]),
        "centre_control": 1.0 - abs(me["c"] - mid) / max(mid, 1),
        "advancement": adv(me["r"]), "opp_advancement": 1.0 - adv(op["r"]) if player == 0 else adv(op["r"]),
        "contact": contact, "mobility": 4.0,
        "tempo": 1.0 if state.get("turn", player) == player else -1.0,
    }


def score(features: dict[str, float], weights: dict[str, float] = DEFAULT_WEIGHTS) -> float:
    return sum(features.get(k, 0.0) * w for k, w in weights.items())
