# Database architecture (MongoDB + Redis)

> PostgreSQL removed from architecture in Phase DB-01.
> Legacy relational schema preserved at `docs/architecture/legacy-postgres-prisma-schema.md` (reference only).

## Topology

```text
FRONTEND → HTTPS/WSS → BACKEND → MongoDB (durable) + Redis (ephemeral)
```

- **MongoDB** — primary persistent store: users, profiles, sessions,
  games, moves, replays, ratings, tournaments, clubs, notifications,
  billing, audit, feature flags, analytics. Driver: official `mongodb`
  package, typed repositories, Zod validation. No ORM.
- **Redis** — matchmaking queues (sorted sets), online presence,
  active-game coordination, distributed locks, rate limiting, pub/sub,
  cache, short-lived sessions, job-queue state. Client: `ioredis`.

## MongoDB modeling (embed vs reference)

- Small bounded settings (profile preferences) may embed in the owner doc.
- Games reference `playerAId/playerBId` + immutable snapshots
  (`usernameAtStart`, `ratingAtStart`) for historical integrity.
- Move history lives in `game_moves` (one doc per ply, unique
  `gameId + sequence`), not embedded — games stay far below document limits.
- Replays store `initialState + ordered actions + rulesVersion +
  engineVersion + result`; the engine reconstructs state.
- Ratings: one doc per `(userId, mode)` (unique index); history appended
  to `rating_history`, never rewritten.
- Users stay small: games, rating history, analytics, AI usage, and
  notifications live in their own collections.

## Collections

`users profiles sessions games game_moves game_events ratings
rating_history replays game_analysis bot_profiles tournaments
tournament_players tournament_rounds clubs club_members friends
friend_requests notifications chat_channels chat_messages reports
moderation_cases bans subscriptions subscription_events payments
cosmetics inventories achievements user_achievements seasons
season_progress puzzles puzzle_attempts ai_sessions ai_usage ai_jobs
admin_users admin_audit_logs feature_flags announcements
system_settings analytics_events`

See `backend/src/database/mongodb/collections.ts` (single source of truth).

## Indexes (ensured at startup + `pnpm db:indexes`)

- `users`: `username!`, `email!`, `createdAt`
- `profiles`: `userId!`
- `sessions`: `userId`, `expiresAt`
- `games`: `(status, createdAt)`, `createdAt`, `(players.userId, createdAt)`
- `game_moves`: `(gameId, sequence)!`
- `game_events`: `(gameId, serverAt)`
- `ratings`: `(userId, mode)!`, `(mode, rating↓)`
- `rating_history`: `(userId, mode, createdAt)`
- `replays`: `gameId!`, `hash`
- `notifications`: `(userId, createdAt↓)`
- `tournaments`: `(status, startAt)`
- (`!` = unique)

## Redis keyspace (`REDIS_PREFIX`, default `pn`)

| Key | Type | Purpose |
|-----|------|---------|
| `pn:matchmaking:<mode>:<tc>` | zset | queue ordered by join time |
| `pn:matchmaking:ticket:<uid>` | hash | ticket payload (anti-duplicate) |
| `pn:game:<id>` | hash | ephemeral active-game state |
| `pn:lock:game:<id>` | string NX PX | single-writer election |
| `pn:presence:<uid>` | hash | online/device/heartbeat (TTL 60s) |
| `pn:ratelimit:<scope>:<key>` | counter | rate limits |
| `pn:sess:<sid>` | string | short-lived session cache |

Matchmaking NEVER polls Mongo. Mongo stores only the resulting game.

## Atomicity (no relational transactions by default)

- Idempotency keys, `version` guards (`finishGame`), unique indexes
  (`gameId + sequence`, `userId + mode`), atomic `$set/$inc/$setOnInsert`.
- Multi-document transactions only when truly needed (documented in
  `mongodb-migrations.md`; requires a replica set).

## Connection & lifecycle

- One shared `MongoClient` (pool min 2 / max 20) + one shared Redis client.
- Startup: env → Mongo → Redis → indexes → HTTP/WS/workers.
- Shutdown: HTTP → matchmaking → sockets → workers → Redis → Mongo.
- `/ready` fails when Mongo is down; Redis down = `DEGRADED` (capabilities listed).
- Atlas URIs with credentials are never logged (masked in errors).

## Backups

- MongoDB Atlas continuous backup (or `mongodump` schedule on self-host);
  Redis is ephemeral — never the system of record. Restore drill monthly.
