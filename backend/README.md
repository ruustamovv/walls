# @nexus/backend

Production Fastify backend (MongoDB + Redis). See root `README.md` + `.env.example` for shared env.

## Setup

```bash
# from repo root
pnpm install

# start local services (MongoDB + Redis)
docker compose up -d mongodb redis

# ensure indexes + verify connectivity (no secrets printed)
pnpm --filter ./backend db:setup
pnpm --filter ./backend db:health

# seed demo data (idempotent upserts)
pnpm --filter ./backend db:seed

# dev (watch) / typecheck / build / test
pnpm --filter ./backend dev
pnpm --filter ./backend typecheck
pnpm --filter ./backend build
pnpm --filter ./backend test

# env sanity
pnpm env:check
```

Required env: `MONGODB_URI`, `MONGODB_DB_NAME`, `REDIS_URL`,
`JWT_SECRET`, `COOKIE_SECRET`, `SESSION_SECRET`. Everything AI-related is
optional (missing keys only disable AI features — the server still boots).

## Database scripts

| Script | Command |
|--------|---------|
| `db:setup` | connect + ensure indexes + health report |
| `db:seed` | idempotent demo seed (users, bots, puzzles, flags) |
| `db:indexes` | ensure indexes only |
| `db:reset:dev` | DEVELOPMENT ONLY — drops the dev database (refuses prod) |
| `db:health` | `MongoDB connection: OK` + `Redis connection: OK`, no secrets |

## Engine binding

`src/modules/games/service.ts` imports the game engine via relative path
`../../../../engine/typescript/index` so the backend compiles before
`pnpm install` links `@nexus/engine`. You may switch to
`@nexus/engine` once the workspace link exists — same pure functions.

## Notes

- `src/database/mongodb/*` — official `mongodb` driver, typed
  repositories, Zod validation. No ORM (Prisma retired — see
  `docs/architecture/legacy-postgres-prisma-schema.md`).
- `src/database/redis/*` — `ioredis` client, centralized key factory,
  distributed locks, Redis matchmaking store. Backend boots degraded
  (in-memory queue) when Redis is unreachable; `/ready` reports it.
- `src/jobs/queue.ts` lazy-loads BullMQ: no Redis → jobs are stubbed inline.
- Auth hashing prefers native `argon2`; falls back to Node `scrypt` in
  dev/test so `npm test` stays offline-friendly.
- Clocks and ratings are server-authoritative. Client-sent ratings/clocks
  are ignored (see validation schemas + services).
- RBAC placeholder: `User.role` (`user | moderator | admin | owner`).
  Admin-only fields must never leak via `/profiles` or `/leaderboard`.
