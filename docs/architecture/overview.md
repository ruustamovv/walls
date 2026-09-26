# Architecture overview

## Principles
1. **Server-authoritative.** The backend owns every game state transition.
   Clients send *intents* (`move`, `wall`, `resign`, `offer`); the server
   validates via the deterministic TS engine and broadcasts *events*.
   A client that disagrees with the server is wrong by definition.
2. **Deterministic engine.** `engine/typescript` is pure: no RNG, no clock,
   no I/O. Same action log ⇒ same state ⇒ same hash. This powers replays,
   anti-cheat, and cross-language mirrors.
3. **MongoDB durable, Redis ephemeral.** Anything that must survive a
   restart lives in MongoDB. Redis holds sockets, presence, queues,
   rate-limit counters, locks, and pub/sub — all reconstructible.
4. **Horizontal-ready backend.** Any replica can serve any game: durable
   state loads from MongoDB, live deltas flow over Redis pub/sub, and
   per-game locks elect a single writer.

## Request paths
- **REST (`/api/v1`):** auth, profiles, matchmaking enqueue, game history,
  admin, AI review (async job). Stateless; JWT + Redis-backed revocation.
- **WebSocket (`/socket`):** one room per game (`game:{id}`), presence
  channel per lobby. Heartbeats every 20 s; missed ×2 ⇒ marked AFK.
- **Internal (`/internal/*`):** python-engine callbacks (`/evaluate`,
  `/best-move`), guarded by a shared `ENGINE_INTERNAL_TOKEN` header
  (to be added to env in Phase 04 — currently a stub check).

## Component map
| Component | Responsibility | Scaling note |
|-----------|---------------|--------------|
| frontend | render, input, clocks display, WS client | static CDN |
| backend API | validation, clocks authority, persistence | N replicas + sticky-free WS via Redis adapter |
| mongodb:7 | users, games, moves, replays, ratings, audit | replica set (Atlas) → sharding in Phase 24 |
| redis:7 | pub/sub, matchmaking ZSETs, locks, rate limits | single → cluster in Phase 24 |
| python-engine | BFS mirror, alpha-beta search, sims, eval | CPU pool, off hot path, job queue |

## Failure posture
- Backend replica dies ⇒ clients reconnect (backoff + resync from
  `moveNumber`); room state rehydrates from MongoDB + Redis log tail.
- Redis dies ⇒ matchmaking/presence/locks degrade; games continue on a
  sticky single-instance path where possible. No move is ever accepted
  without a MongoDB `game_moves` write.
- MongoDB dies ⇒ full write halt; WS sends `server_pause`, `/ready` fails.
  RPO ≈ 0 (majority writes on Atlas), RTO per restore drill (Phase 23).
