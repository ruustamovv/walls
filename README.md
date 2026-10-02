# PROJECT_NEXUS (dev codename)

Original competitive **wall-and-pawn strategy platform**: two pawns race to
opposite edges; each turn you move your pawn **or** spend a wall to bend your
opponent's route. Server-authoritative engine, realtime multiplayer, AI
coaching, tournament-grade admin.

> Status: **Phase 00 in progress** — repo scaffold, TS engine core, env +
> compose templates. See `PROJECT_STATUS.md` and `ROADMAP.md`.

## Architecture

```text
                    ┌─────────────┐
                    │  Frontend   │  web client (board render, clocks, socket)
                    │  (pnpm)     │
                    └──────┬──────┘
                           │ HTTPS + WS  (API_URL / WS_URL)
                    ┌──────▼──────┐      ┌──────────────┐
                    │  Backend    │─────▶│  MongoDB     │  durable store    
                    │  (API+WS)   │      └──────────────┘
                    │             │      ┌──────────────┐
                    │  authorita- │─────▶│  Redis       │  pub/sub, queues,
                    │  tive host  │      │              │  rate limits, cache
                    └──────┬──────┘      └──────────────┘
                           │ internal HTTP (auth header)
                    ┌──────▼──────┐      ┌──────────────┐
                    │ Python      │      │ TS engine    │  deterministic rules,
                    │ engine      │      │ (shared lib) │  BFS, replays
                    │ (FastAPI)   │      └──────────────┘
                    └─────────────┘
```

- **Source of truth:** backend validates every action through the
  deterministic engine (`engine/typescript`). Clients are dumb renderers.
- **Realtime:** WebSocket rooms per game; Redis pub/sub fans out so any
  backend replica can serve any game (see `docs/architecture/realtime.md`).
- **Persistence:** MongoDB is durable (users, games, ratings, ...); Redis holds only ephemeral state (queues, presence, locks).
- **AI:** provider abstraction (`docs/ai/architecture.md`) with graceful
  fallback and monthly budget caps.
- **Python engine:** offline search/simulation/evaluation
  (`engine/python`), never on the hot move path.

## Quickstart

Prereqs: Node ≥ 20, `pnpm@12`. Redis is optional locally (see below).

```bash
# 1. install + build engine + verify everything
pnpm setup

# 2. env (only if you do not have .env yet)
cp .env.example .env      # then paste MONGODB_URI + 3 secrets
pnpm doctor               # tells you exactly what is missing or unreachable
```

`pnpm doctor` checks `.env`, the engine build, MongoDB, Redis, and ports
3000/5173/5174, then prints the run commands. Re-run it any time — it is the
fastest way to find out why the server will not boot.

### Running

```bash
pnpm dev          # engine build, then backend :3000 + frontend :5173 + admin :5174
pnpm start        # production build + preview servers (all three)

# single service
pnpm dev:backend  # http://localhost:3000
pnpm dev:frontend # http://localhost:5173
pnpm dev:admin    # http://localhost:5174
```

`pnpm dev` builds the engine first (`predev`) — the backend imports
`engine/typescript/dist`, so a stale engine build breaks the backend at boot.
`pnpm start` builds everything first (`prestart`).

Health probes on the backend: `/health` (liveness), `/ready` (MongoDB + Redis),
`/live`.

### Services

- **MongoDB** — required. Either local (`docker compose up -d mongodb`) or an
  Atlas URI in `MONGODB_URI`. Collections and indexes are created on boot
  (`ensureIndexes`, idempotent).
- **Redis** — optional but recommended. Without it the server still boots:
  sessions fall back to a process-local store (single instance only) and
  matchmaking / presence / queues run **degraded**. Fix with
  `docker run -d -p 6379:6379 redis:7` or point `REDIS_URL` at a real instance.

```bash
# 3. tests
pnpm test                # all workspaces
pnpm --filter ./engine/typescript test
python -m pytest engine/python -q  # once implemented
```

## Environment variables

| Key | Required | Used by | Notes |
|-----|----------|---------|-------|
| `NODE_ENV` | yes | all | `development` / `test` / `production` |
| `APP_NAME` | yes | all | `PROJECT_NEXUS` |
| `FRONTEND_URL` / `BACKEND_URL` / `API_URL` / `WS_URL` | yes | frontend, backend | CORS, callbacks, socket |
| `MONGODB_URI` / `MONGODB_DB_NAME` | yes | backend | MongoDB durable store |
| `REDIS_URL` | yes | backend | pub/sub, queues, cache |
| `JWT_SECRET` / `COOKIE_SECRET` / `SESSION_SECRET` | yes | backend | distinct 256-bit values |
| `CORS_ORIGINS` | yes | backend | comma-separated allowlist |
| `OWNER_EMAIL` / `OWNER_USERNAME` / `OWNER_INITIAL_PASSWORD` | bootstrap only | seed script | single-use, rotate after login |
| `AI_PROVIDER` + `*_API_KEY` + `AI_MODEL_*` | for AI features | backend, python-engine | at least one for AI; budget cap applies |
| S3 (`S3_*`) | for uploads | backend | avatars, exports, replays |
| SMTP (`SMTP_*`, `MAIL_FROM`) | for mail | backend | verification, reset |
| Payments (`PAYMENT_PROVIDER`, stripe…) | for monetisation | backend | `none` disables |
| `SENTRY_DSN`, `LOG_LEVEL` | optional | all | observability |

Full reference with per-key feature notes: `.env.example`.
Validate: `pnpm env:check`. Bootstrap owner: `pnpm owner:create`.

## Pointers

| Area | Doc |
|------|-----|
| Rules (goal race, move-or-wall, jumps, no-seal, clocks, modes) | `docs/game-rules/rules.md` |
| Special party modes (Team 2v2 real; Fog/Chaos/Siege status) | `docs/game-rules/special-modes.md` |
| Multiplayer board scaling + wall economy | `docs/game-rules/multi-balance.md` |
| Server-authoritative design | `docs/architecture/overview.md` |
| Realtime / Redis fan-out | `docs/architecture/realtime.md` |
| MongoDB + Redis architecture | `docs/architecture/database.md` |
| AI abstraction + providers | `docs/ai/architecture.md`, `docs/ai/providers.md` |
| Threat model | `docs/security/threat-model.md` |
| Admin runbook | `docs/operations/admin.md` |
| Incidents | `docs/operations/incident-response.md` |
| Product roadmap | `docs/product/roadmap.md`, `ROADMAP.md` |
| Branding research | `docs/branding/BRAND_CANDIDATES.md` |
| Python engine | `engine/python/README.md` |

## Contributing

1. Pick a task from `docs/TODO.md` (Critical first).
2. Keep the engine deterministic — no RNG, no I/O in `engine/typescript`.
3. Mirror rule changes in `engine/python/pathfinding/bfs.py` + tests.
4. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before pushing.
5. Never commit `.env`, keys, or dumps (`.gitignore` already excludes them).

## Security

Report vulnerabilities privately to the owner contact in
`docs/security/threat-model.md`. Do not open public issues for exploits.
Bootstrap secret handling: see `scripts/setup/owner-create.mjs` header.

## Roadmap

Phases 00–29 checklist: `ROADMAP.md`. Live phase tracker: `PROJECT_STATUS.md`.
