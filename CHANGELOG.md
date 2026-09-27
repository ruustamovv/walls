# Changelog

All notable changes to PROJECT_NEXUS (dev codename) are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-09-27 — M6 game theater + auth + social + admin depth

### Added
- Game theater: algebraic notation + click-to-seek/exportable move lists,
  live path-pressure meter, wall ghost with projected route deltas, pawn
  hop arcs, winner ring, low-time tick escalation, 3 board themes + 2 pawn
  sets, volume + wall-confirm settings, share/export/replay links, rated
  badges, rematch, scroll-to-review, duration + rating-delta result lines,
  board flip, chat mute, sound toggle, takeback vs bots/local, replay
  keyboard shortcuts.
- Auth: split `/login` + `/signup` (benefits, strength meter, terms),
  Google/GitHub OAuth code flow (buttons only when configured) + tests,
  password change, logout-everywhere, account closure, per-user settings
  (privacy/challenges/chat scope/notify prefs) enforced server-side
  (profiles, challenges, chat, notifications).
- Social/discovery: notifications inbox + sidebar bell, global search,
  legal pages (terms/privacy/fair-play) + full footer, profile seat
  splits + form streaks, i18n shell (EN/RU/UZ nav).
- Admin depth: announcements publish/retract + player banner, analytics
  ingestion + top events, warn/mute (chat-enforced) + bans list, chat
  delete, game annul (documented rating policy), AI monthly budget cap +
  kill-switch + per-user quota overrides + spend estimates, filtered
  audit + CSV export; player-app telemetry (authed page views).

### Fixed
- AI zero-quota overrides now block instead of falling through.

## [Unreleased] — 2026-09-27 — M5 light restore + standalone admin + keys

### Changed
- Light-first dual theme restored (dark arena on game routes only);
  dark-default experiment reverted per owner feedback.

### Added
- Standalone admin console: new top-level `admin/` app on
  `http://localhost:5174` (`pnpm dev:admin`, compose service, own
  Dockerfile) with staff login, section sidebar, dashboard, users,
  games, tournaments, clubs, reports, AI providers, flags, audit.
  Player app keeps only an `/admin` pointer page; CORS covers both hosts
  via new `ADMIN_URL` env.
- `.env` created with empty provider slots (`GROQ/OPENAI/ANTHROPIC/GEMINI/
  OPENROUTER_API_KEY`, `AI_MODEL_COACH`, Stripe/SMTP/S3/Sentry) — paste
  keys, restart backend, watch the admin AI tab light up. Required
  secrets stay empty so boot forces you to fill them.
- `AI_MODEL_COACH` added to `.env.example`; env-check labels OAuth/OTEL.

## [Unreleased] — 2026-09-27 — M4 dark redesign + full admin

### Added
- Dark-first theme: whole app renders the arena palette by default, light
  opt-in via Settings; specificity-safe selectors; dark theme-color.
- Full admin command center (`/admin` sidebar): dashboard vitals + weekly
  SVG charts + AI usage, users (search/detail/suspend/ban/entitlements),
  live games + queue depths, tournament cancel, club delete, moderation
  reports queue with resolve/dismiss, flags, audit — all RBAC-gated and
  audited; admin HTTP E2E test green.
- Moderation intake: `POST /reports` + Report buttons on game and profile
  pages; ReportRepository with status lifecycle.
- Admin stats/queue endpoints (7-day aggregates, AI usage by provider).

## [Unreleased] — 2026-09-27 — M3 remaining subsystems

### Added
- Personal mistake-puzzles: engine review mines your blunders into drills
  (`/training`), reference-band grading accepts alternate winning lines.
- Club chat: members-only socket rooms + persisted history + REST fallback.
- Live AI coach: OpenAI-compatible calls (groq/openai/openrouter) with
  20s timeout, token cap, per-user daily quotas (entitlement-aware),
  `ai_usage` log, per-move Explain buttons; anthropic/gemini honestly
  unimplemented; no-key deployments unchanged (graceful message).
- Tournaments: pure pairing core (seeded single-elim, circle round-robin,
  swiss-lite with rematch avoidance), lifecycle (draft/open/live/finished),
  standings, champions + full `/tournaments` UI (brackets, reporting).
- Premium: entitlement ledger, coach-quota gating (5→200), admin
  grant/revoke (audited), `/premium` UI; checkout honestly disabled.
- Multiplayer engine (`engine/typescript/multi/`): 2–4 seats, rotation,
  any-pawn jumps, N-path no-seal rule, side goals, serialization/hash,
  multi bots + 8 tests; 2P core untouched. Party table UI (`/play/multi`):
  4P/3P presets, humans + bots, N-pawn board, seat HUD, winner titles.

### Fixed
- AI quota probe teardown hangs (self-cleaning Redis probe + test cleanup).

## [Unreleased] — 2026-09-27 — Reference-spec alignment (sidebar, sound, draws, clubs, reset)

### Added
- Persistent sidebar layout (desktop) + top bar/drawer (tablet) + bottom
  tabs (mobile); Settings page with theme pin, sound toggle, coords note.
- WebAudio synth SFX (move/wall/illegal/win/lose/match/notify), mutable.
- Pawn glide animation via positioned overlay layer (grid stays semantic).
- Draw offers: service + socket + REST + game UI (offer/accept/decline),
  rated 0.5/0.5 through existing settlement.
- Rating-history endpoint + SVG profile chart (no chart dep).
- Clubs: found/browse/join/leave/roster + /clubs UI (chat deferred).
- Password reset: hashed single-use tokens, session revocation, nodemailer
  SMTP with non-prod dev-log fallback; forgot/reset pages.
- Env: OAuth (Google/GitHub) + OTEL keys reserved; env-check labels them.

### Deferred honestly
- 4-player/3/5-player modes (needs 2P-core engine rework — not faked).
- Club chat, personal puzzles from mistakes, live AI calls, tournaments
  bracket engine, premium — still roadmap.

## [Unreleased] — 2026-09-27 — D3/D4 unprecedented design pass

### Added
- Dual-theme system (`styles/theme.css`): light site + dark arena, type/
  spacing/radius/shadow/token scales, Space Grotesk display + JetBrains Mono
  clocks, `useTheme` route scoping, favicon glyph, font preconnect.
- Identity: SVG wall-notch Logo, generated Avatar sigils, 6 rating
  Divisions + DivisionBadge, expanded brand.ts (name swap = one line).
- Arena theater: glowing active pawns, turn aura + wall-pip HUD cards,
  mono redline clocks, win/podium result modal, coordinate tooltips.
- New landing: dark key-art hero with live-battle proof, 3-step rules,
  bot ladder strip, platform stats.
- Component consolidation: Tabs/Stat/Skeleton/sizes replace ad-hoc pills;
  leaderboard/profile/bots/play refreshed; old tokens.css removed.

## [Unreleased] — 2026-09-27 — M2 social, training & control

### Added
- Deterministic daily wall puzzle (engine generator, Mongo cache, streaks)
  + `/puzzles` UI; solutions never leave the server (tested).
- Friends lifecycle (request/accept/list/block), Redis presence, challenges,
  notifications + `/friends` UI.
- Live game chat over sockets (players-only, 2s throttle, 500 chars).
- Admin core: RBAC (moderator/admin), overview, user search/detail/
  suspend/ban/restore, recent games, feature flags, append-only audit,
  `/admin` UI, real `pnpm owner:create` (argon2id, audited).
- Replay viewer (`/replay/:id`, play/pause/step/scrub) + engine Game Review
  panel (GREAT_WALL / BLUNDER / TEMPO / CHOKE / CLUTCH from path facts).
- `pnpm calibrate` bot round-robin; Redis sessions (shared, TTL-enforced);
  bounded Redis probe (fast degraded fallback, no retry storms).
- HTTP+socket two-client E2E test (4s, clean exit).

### Fixed
- E2E teardown hangs: Redis probe singleton now disconnects + resets on
  failure; test teardowns close Redis.
- RBAC role refresh from Mongo (promotions apply without re-login).

## [Unreleased] — 2026-09-26 — M1 playable competitive core

### Added
- Engine bots (`engine/typescript/bots/`): heuristic evaluation, budgeted
  1-ply + reply search, deterministic RNG, 10 named personalities
  (Rookie…Grandmaster) with internal difficulty ratings; 5 new engine tests.
- Premium board UX: `GameBoard` (wall grooves, hover ghost preview with
  legality coloring, SVG pawns, goal rows, last-action highlight, analysis
  path overlay), `PlayerCard` clocks/inventory, `MoveList`, `ResultModal`;
  old debug board with coordinate inputs removed.
- Offline play: local 2P + vs-bot on 9×9/15×15/17×17 with client clocks,
  bot driver, lobby (`/play`), bot roster (`/bots`).
- Online play: socket move/wall/resign + REST, server-authoritative clocks
  with timeout resolution, `game:state` broadcast, spectator mode,
  matchmaking status polling, ranked→Standard 15×15 preset.
- Persistence: Mongo-backed auth (`UserStore`, memory fallback), game
  journaling (create/append/finish, `engineId` link + sparse-unique index),
  exactly-once settlement (Glicko bullet/blitz/rapid/casual + replay).
- Real profiles (ratings + recent games), leaderboard, spectator directory.
- AI provider abstraction (`groq/openai/anthropic/gemini/openrouter`),
  `/api/v1/ai/status`, coach endpoint with honest unconfigured state.
- Self-contained `match-flow` backend test: register→match→play→resign→
  settle verified against in-process Mongo (ratings diverge, replay + game
  doc written).

### Changed
- `GameRecord`: action history, `winnerSeat`/`finishReason`/`settled`,
  `mode`; snapshot exposes seats, increment, move count.
- Frontend routes: `/play` lobby, `/play/local`, `/play/bot`, `/game/:id`,
  `/bots`, `/leaderboard`, `/watch`; `/lobby` redirects to `/play`.

### Fixed (2026-09-26) — verify:live graceful shutdown + DB-01 verification

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
