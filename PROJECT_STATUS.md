# PROJECT_STATUS — live phase tracker

> Updated: 2026-09-26. Source of truth for "where are we".
> Statuses: `NOT_STARTED` · `IN_PROGRESS` · `COMPLETE` · `BLOCKED`.
> Spec phases 00–29 map below (master prompt §§164–193).

| Phase | Name (spec) | Status | Updated | Tests / evidence |
|------:|-------------|--------|---------|------------------|
| 00 | Repository and Architecture | COMPLETE | 2026-09-26 | pnpm install ok; frontend build ok; backend typecheck ok; engine 30/30; no .env committed |
| 01 | Branding research | COMPLETE | 2026-09-26 | 36 candidates in docs/branding/; all domains UNVERIFIED (no live WHOIS in env — must re-check) |
| 02 | Design system | COMPLETE | 2026-09-27 | light-first dual theme restored (dark arena on game routes); sidebar/tablet/mobile nav; settings + WebAudio synth; pawn glide overlay; full primitives; new landing; hex leaks removed |
| 03 | Database (MongoDB + Redis) | COMPLETE | 2026-09-26 | Phase DB-01 verified: `verify:live` 8/8 PASS with graceful shutdown, exit 0; games engineId link + sparse-unique index; listByUser for history |
| 04 | Auth | IN_PROGRESS | 2026-09-27 | Mongo accounts + Redis sessions; split /login + /signup (strength, terms, OAuth buttons only when configured); Google/GitHub code flow + tests; password change/logout-all/delete; per-user settings (privacy/chat/notify) enforced server-side |
| 05 | Core engine | COMPLETE | 2026-09-27 | engine 49/49 (rules + bots + review + puzzles + 8 multi); N-player core (2–4 seats, rotation, N-no-seal, multi bots); 2P core untouched; lint clean |
| 06 | Local game | COMPLETE | 2026-09-26 | local 2P + vs-bot (9×9/15×15/17×17) with clocks, HUD, move list, result sheet; debug board removed |
| 07 | Backend game service + realtime | IN_PROGRESS | 2026-09-27 | moves/walls/resign/draw + clocks + timeout; socket + REST; settle + journaling; live/meta/replay/review/notifications/search/announcements/analytics endpoints; game + club chat (mute + scope enforced); HTTP+socket E2E green; backend 61/61 lint-clean |
| 08 | Matchmaking | IN_PROGRESS | 2026-09-26 | Redis queue preferred w/ memory fallback; status poll + match registry; server-side ratings; ranked→Standard 15×15 preset |
| 09 | Ratings (Glicko-2) | IN_PROGRESS | 2026-09-26 | finished games update bullet/blitz/rapid/casual in Mongo (exactly-once settled flag); history appended; leaderboard endpoint live |
| 10–11 | Profiles / Replays | IN_PROGRESS | 2026-09-27 | profiles + replay viewer (/replay/:id) + engine review panel live; replays persisted per finished game |
| 12 | Bots | IN_PROGRESS | 2026-09-27 | 10 personalities playable; `pnpm calibrate` round-robin works (fortress 75% in smoke); full-matrix calibration + rating anchoring pending |
| 13–15 | Puzzles / Friends / Chat | IN_PROGRESS | 2026-09-27 | daily + personal puzzles + training; friends + presence + challenges; game + club chat; rating-history + seat stats + profile chart; live AI coach (budget/kill-switch/quota overrides, Explain UI) |
| 13–15 | Leaderboards / Puzzles / Review | NOT_STARTED | — | — |
| 16–19 | AI Coach/Nemesis/Mirror/Architect | IN_PROGRESS | 2026-09-27 | live coach calls (groq/openai/openrouter, quotas, usage log, per-move Explain UI); Nemesis/Mirror/Architect still future |
| 20–21 | Tournaments / Clubs-social | IN_PROGRESS | 2026-09-27 | clubs + members-only chat + /clubs UI; tournaments live: single-elim/round-robin/swiss-lite, brackets/standings/reporting + /tournaments UI |
| 22–23 | Admin core/advanced | IN_PROGRESS | 2026-09-27 | STANDALONE console (:5174): dashboard + weekly charts + top events, users + warn/mute/entitlements, live games + queue, tournaments cancel, clubs delete, reports triage, announcements publish, AI budgets/spend/quota overrides, flags, filtered audit + CSV — RBAC + audited; admin + ops HTTP E2E green |
| 24 | Premium/cosmetics | IN_PROGRESS | 2026-09-27 | entitlement ledger + coach-quota gating + admin grant/revoke + /premium UI; checkout honestly disabled (no provider); cosmetics catalog pending |
| 25 | Special modes (Fog/4P/Siege…) | IN_PROGRESS | 2026-09-27 | party table live: 2–4P local + bots (9×9/5, 13×13, 15×15 presets), own board/HUD/result; online 4P + Fog/Team/Chaos still pending |
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

## Milestone M1 — playable competitive core (2026-09-26)

Delivered: premium board UX (no debug inputs), 10 engine bots playable in UI,
Mongo-backed auth, matchmaking status flow, authoritative online play
(move/wall/resign + clocks + timeout), finish settlement (Glicko ratings +
replay + game journal), real profiles/leaderboard/watch pages, AI provider
abstraction with graceful unconfigured state. Evidence: engine 35/35, backend
27/27 (incl. self-contained register→match→play→resign→settle flow test),
`verify:live` 8/8 exit 0, frontend typecheck + build clean.

## Milestone M2 — social, training & control (2026-09-27)

Delivered: deterministic daily wall puzzle + streaks + /puzzles UI (solution
never leaves the server); friends lifecycle + presence + challenges +
/friends UI; live game chat (players-only, throttled); admin RBAC + overview
+ user moderation + games + flags + audit + /admin UI + real owner bootstrap;
replay viewer + engine review panel; `pnpm calibrate` round-robin;
HTTP+socket two-client E2E test (register→match→socket moves→resign→
ratings/replay/review/leaderboard, 4s). Evidence: engine 41/41 lint-clean,
backend 37/37, `verify:live` 8/8 exit 0, frontend typecheck + build clean.

## Milestone M3 — remaining subsystems (2026-09-27)

Delivered: personal mistake-puzzles + /training; club chat (rooms + history);
live AI coach (quota, usage log, Explain UI); tournaments (single-elim,
round-robin, swiss-lite + /tournaments UI); premium entitlements + gating +
/premium UI; multiplayer engine (2–4 seats) + party table UI (local + bots).
Evidence: engine 49/49 lint-clean, backend 51/51 lint-clean, `verify:live`
8/8 exit 0, frontend typecheck + build clean.

## Milestone M6 — theater, auth, social, admin depth (2026-09-27)

Delivered: notation/seek/export, pressure meter, preview deltas, hop arcs,
winner ring, tick escalation, themes/skins/volume/confirm-wall, share/
export/rematch/flip/takeback/keyboard, split auth + OAuth, notifications +
bell, search, legal/footer, i18n nav, profile stats, account security,
privacy enforcement, announcements, analytics, warn/mute/annul, AI budgets
+ kill-switch + quota overrides, filtered audit + CSV.
Evidence: backend 61/61 lint-clean, engine 49/49, `verify:live` 8/8 exit 0,
frontend + admin typecheck + build clean.

## Current focus
1. Manual two-browser + mobile-viewport QA pass (visual polish from findings).
2. Online 4P (service/socket/matchmaking for N seats), Fog/Team/Chaos modes.
3. Nemesis/Mirror/Architect, cosmetics catalog, lessons curriculum.
4. Phase 01 follow-up: live registrar checks for top-5 brands (.com + .uz) + trademark screen before purchase.
