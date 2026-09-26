# PROJECT_STATUS — live phase tracker

> Updated: 2026-09-26. Source of truth for "where are we".
> Statuses: `NOT_STARTED` · `IN_PROGRESS` · `COMPLETE` · `BLOCKED`.
> Spec phases 00–29 map below (master prompt §§164–193).

| Phase | Name (spec) | Status | Updated | Tests / evidence |
|------:|-------------|--------|---------|------------------|
| 00 | Repository and Architecture | COMPLETE | 2026-09-26 | pnpm install ok; frontend build ok; backend typecheck ok; engine 30/30; no .env committed |
| 01 | Branding research | COMPLETE | 2026-09-26 | 36 candidates in docs/branding/; all domains UNVERIFIED (no live WHOIS in env — must re-check) |
| 02 | Design system | IN_PROGRESS | 2026-09-26 | tokens.css + Tailwind + App shell + home/login/lobby; board visual language draft (Board.tsx) |
| 03 | Database (MongoDB + Redis) | COMPLETE | 2026-09-26 | Phase DB-01 verified: `verify:live` 8/8 PASS (mongo users/games/replay/ratings/tournaments/notifications + redis queue/locks/presence/pubsub) with graceful shutdown, exit 0 |
| 04 | Auth | IN_PROGRESS | 2026-09-26 | hashing/session service stubs; backend tests 16/16 incl. auth round-trip |
| 05 | Core engine | COMPLETE | 2026-09-26 | engine 30/30 pass (§108); typecheck clean; BFS + jump/diagonal + no-seal enforced |
| 06 | Local game | COMPLETE | 2026-09-26 | /play local 9×9 playable, engine-validated; frontend build passes |
| 07 | Backend game service + realtime | IN_PROGRESS | 2026-09-26 | game service + socket.io handlers stubbed; 2-client live play not yet E2E-tested |
| 08 | Matchmaking | IN_PROGRESS | 2026-09-26 | in-memory queue + rating window; Redis persist pending |
| 09 | Ratings (Glicko-2) | IN_PROGRESS | 2026-09-26 | glicko2.ts + tests passing; per-mode history pending DB |
| 10–11 | Profiles / Replays | NOT_STARTED | — | routes stubbed |
| 12 | Bots | IN_PROGRESS | 2026-09-26 | TS baseline pending; python personalities (10 defs) stubbed |
| 13–15 | Leaderboards / Puzzles / Review | NOT_STARTED | — | — |
| 16–19 | AI Coach/Nemesis/Mirror/Architect | NOT_STARTED | — | provider abstraction doc'd; no keys required; graceful fallback planned |
| 20–21 | Tournaments / Clubs-social | NOT_STARTED | — | schema tables reserved |
| 22–23 | Admin core/advanced | NOT_STARTED | — | runbook stub |
| 24 | Premium/cosmetics | NOT_STARTED | — | env keys reserved |
| 25 | Special modes (Fog/4P/Siege…) | NOT_STARTED | — | siege 17×17 preset in engine only |
| 26–29 | Hardening/load/polish/readiness | NOT_STARTED | — | threat-model + incident stubs |

## Phase DB-01 — PostgreSQL → MongoDB + Redis

Status: COMPLETE (verified 2026-09-26 — ephemeral mongod + live Redis; no Docker daemon in this env, Redis provided via ephemeral server on redis://localhost:6379)

- PostgreSQL removed (compose, deps, env, docs, scripts, health checks); legacy schema preserved at `docs/architecture/legacy-postgres-prisma-schema.md`.
- Prisma removed from runtime (`mongodb@^6` + `ioredis` only). Audit 2026-09-26: no `schema.prisma`, no migrations dir, no `@prisma`/`DATABASE_URL`/pg/knex references in project source (only intentional legacy docs + third-party node_modules examples).
- MongoDB layer: client singleton, collections registry, index bootstrap, User/Game/Rating/Replay/Tournament/Notification/Puzzle repositories.
- Redis layer: client, key factory (`REDIS_PREFIX`), distributed locks, health, Redis matchmaking store.
- Env: `MONGODB_URI` / `MONGODB_DB_NAME` / `REDIS_URL` / `REDIS_PREFIX` required; `DATABASE_URL` gone.
- Scripts: `db:setup db:seed db:indexes db:reset:dev db:health` (root + backend).
- `verify:live` graceful-shutdown bug FIXED 2026-09-26: root cause was the shared `getRedis()` singleton (used by `RedisQueueStore`/`tryAcquireLock`) never being disconnected in `redis.test.ts` `after` hook — only the probe client was closed — so the `node --test` child held the event loop open forever and the parent never reached `mongod.stop()`. Fix: `after` now closes both clients; pub/sub subscriber + watchdog timer cleaned in `finally`; `live-verify.ts` parent hardened (child SIGTERM/SIGKILL fallback, SIGINT/SIGTERM forwarding, `finally` teardown, `process.exitCode` only — no `process.exit`). Evidence: success path 8/8 PASS, `cleanup done`, exit 0, no orphan mongod/node; forced-failure probe: 7/1 FAIL reported, `cleanup done`, exit 1.

## Current focus
1. Phase 07 E2E: two-browser live game via sockets + server clocks.
2. Phase 08: Redis-persisted matchmaking queue (replace in-memory default in production path).
3. Phase 01 follow-up: live registrar checks for top-5 brands (.com + .uz) + trademark screen before purchase.
