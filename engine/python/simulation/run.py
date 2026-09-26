"""Bulk random-playout simulator (stub).

Full play binds the TS engine via port/IPC in Phase 02; until then this runs
self-contained random plies on a minimal local model and writes a summary
report to engine/experiments/results/. Interface (argparse --games) is final.
"""
from __future__ import annotations
import argparse
import json
import random
from datetime import datetime, timezone
from pathlib import Path

RESULTS_DIR = Path(__file__).resolve().parents[2] / "experiments" / "results"


def random_playout(size: int, walls_each: int, rng: random.Random) -> dict:
    pawns = [[0, size // 2], [size - 1, size // 2]]
    goals = [size - 1, 0]
    walls = [walls_each, walls_each]
    turn, plies = 0, 0
    while plies < size * size * 4:
        r, c = pawns[turn]
        if r == goals[turn]:
            return {"winner": turn, "plies": plies, "walls_left": walls}
        # random orthogonal step (walls ignored in stub — TS engine owns truth)
        moves = [(r + dr, c + dc) for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1))
                 if 0 <= r + dr < size and 0 <= c + dc < size]
        nr, nc = rng.choice(moves)
        pawns[turn] = [nr, nc]
        if walls[turn] > 0 and rng.random() < 0.15:
            walls[turn] -= 1  # stub: counts a wall without placing geometry
        turn = 1 - turn
        plies += 1
    return {"winner": None, "plies": plies, "walls_left": walls}


def main() -> None:
    ap = argparse.ArgumentParser(description="PROJECT_NEXUS bulk simulator (stub)")
    ap.add_argument("--games", type=int, default=100)
    ap.add_argument("--size", type=int, default=9)
    ap.add_argument("--walls", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    outcomes = [random_playout(args.size, args.walls, rng) for _ in range(args.games)]
    p0 = sum(1 for o in outcomes if o["winner"] == 0)
    p1 = sum(1 for o in outcomes if o["winner"] == 1)
    report = {
        "engine": "python-stub (random playout; TS engine binding in Phase 02)",
        "games": args.games, "size": args.size, "walls_each": args.walls,
        "seed": args.seed, "wins_p0": p0, "wins_p1": p1,
        "draws_or_cutoff": args.games - p0 - p1,
        "avg_plies": sum(o["plies"] for o in outcomes) / max(args.games, 1),
        "at": datetime.now(timezone.utc).isoformat(),
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = RESULTS_DIR / f"sim-{stamp}-n{args.games}.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    print(f"report -> {out}")


if __name__ == "__main__":
    main()
