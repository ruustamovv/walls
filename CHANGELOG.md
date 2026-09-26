# Changelog

All notable changes to PROJECT_NEXUS (dev codename) are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-09-26 — verify:live graceful shutdown + DB-01 verification

### Fixed
- `pnpm --filter ./backend verify:live` hung forever after all tests passed.
  Root cause: `backend/src/tests/redis.test.ts` closed only its local probe
  Redis client, never the shared `getRedis()` singleton used by
  `RedisQueueStore`/`tryAcquireLock` — the `node --test` child kept the event
  loop open, the parent never reached `mongod.stop()`. The `after` hook now
  closes both; pub/sub subscriber + watchdog timer are released in `finally`.
- Hardened `backend/src/database/live-verify.ts`: child SIGTERM with SIGKILL
  fallback, SIGINT/SIGTERM forwarding, teardown in `finally`, exit via
  `process.exitCode` (no `process.exit`).

### Verified
- `verify:live`: 8/8 PASS, `cleanup done`, exit 0, no orphan `mongod`/node.
- Forced-failure probe: failure reported, cleanup still ran, exit 1 (probe reverted).
- Backend `test` 24/24, backend `typecheck` clean, engine 30/30, frontend
  `typecheck` clean, frontend `build` ok.
- Migration audit: no active PostgreSQL/Prisma runtime references
  (only intentional legacy docs). Phase DB-01 marked COMPLETE.

## [0.1.0] — 2026-09-26 — Phase 00 scaffold

### Added
- Monorepo wiring (`pnpm-workspace.yaml`, root scripts for dev/db/test/env).
- Root configs: `.gitignore`, `.env.example`, `.env.local.example`,
  `.env.production.example`, `docker-compose.yml` (postgres:16, redis:7,
  backend, frontend profile, python-engine) with volumes + healthchecks.
- TS engine core (pre-existing): deterministic rules, BFS pathfinding,
  replay helpers, unit tests.
- Python engine scaffold: FastAPI stubs, BFS mirror, alpha-beta stub,
  10 bot personalities, simulation runner, heuristic features.
- Docs skeleton: architecture (overview/realtime/database), game rules,
  AI (architecture/providers), security threat model, admin + incident
  runbooks, product roadmap, TODO lists.
- Branding research pack: 32 invented candidates with UNVERIFIED domain
  status + machine-readable `candidates.json`.
- Setup scripts: `env-check.mjs` (`pnpm env:check`), `owner-create.mjs`
  (`pnpm owner:create`) stubs.
- `README.md`, `ROADMAP.md` (00–29), `PROJECT_STATUS.md`, `LICENSE` (MIT),
  `docs/TODO.md`.
