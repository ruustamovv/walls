# Python engine (offline analysis — never on the hot move path)

Companion to `engine/typescript` (the authority). Python mirrors rules for
research: BFS route checks, alpha-beta search stubs, bot personalities,
bulk simulation, heuristic features, and a small internal FastAPI service.

## Layout
- `pathfinding/bfs.py` — BFS mirror of the TS shortest-path search.
- `search/alpha_beta.py` — depth-limited alpha-beta stub + heuristic hook.
- `bots/personalities.py` — 10 bot definitions (name, rating, style).
- `simulation/run.py` — random-playout bulk runner → `engine/experiments/results/`.
- `evaluation/features.py` — heuristic feature list for analysis/AI.
- `api/server.py` — FastAPI `/health /evaluate /best-move` stubs (internal token).

## Dev
```bash
pip install -r requirements.txt
python -m pytest engine/python -q
uvicorn engine.python.api.server:app --port 8001
python -m engine.python.simulation.run --games 100
```

All game-rule changes must land in TS first, then be mirrored here + tested.
