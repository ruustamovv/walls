# PROJECT_NEXUS — master roadmap (phases 00–29)

Legend: `NOT_STARTED` · `IN_PROGRESS` · `COMPLETE`
Detail per phase lives in `docs/product/roadmap.md`; live status in `PROJECT_STATUS.md`.

- [x] **Phase 00 — Repo scaffold & foundations** — `IN_PROGRESS`
  monorepo, `.env.*` templates, compose, TS engine core, docs skeleton.
- [ ] **Phase 01 — Brand & domain** — `NOT_STARTED`
  name shortlist (see `docs/branding/`), trademark screen, `.com` + `.uz` acquisition.
- [ ] **Phase 02 — Engine rules hardening** — `NOT_STARTED`
  full move/jump/wall validation, no-seal proof, replay hashes, fuzz tests.
- [ ] **Phase 03 — Backend core (auth, users)** — `NOT_STARTED`
  JWT + sessions, owner bootstrap, roles (owner/admin/moderator/player).
- [ ] **Phase 04 — Persistence layer** — `NOT_STARTED`
  MongoDB collections + indexes + seed, Redis ephemeral keys.
- [ ] **Phase 05 — Realtime game server** — `NOT_STARTED`
  WS rooms, Redis pub/sub fan-out, reconnect/resync, clocks.
- [ ] **Phase 06 — Matchmaking & queues** — `NOT_STARTED`
  rating, queue, pairing, rematch, AFK handling.
- [ ] **Phase 07 — Frontend shell & board** — `NOT_STARTED`
  layout, board renderer, wall preview, move list, responsive.
- [ ] **Phase 08 — Game UX (clocks, offers, chat)** — `NOT_STARTED`
  timers, draw/resign offers, in-game chat + mute.
- [ ] **Phase 09 — Bots (in-engine)** — `NOT_STARTED`
  10 personalities, difficulty ladder, offline play.
- [ ] **Phase 10 — AI commentary & coaching** — `NOT_STARTED`
  provider abstraction, post-game review, cost caps.
- [ ] **Phase 11 — Replays & analysis board** — `NOT_STARTED`
  stored replays, share links, eval graphs.
- [ ] **Phase 12 — Tournaments** — `NOT_STARTED`
  brackets, scheduling, arbiters, prizes.
- [ ] **Phase 13 — Rankings & seasons** — `NOT_STARTED`
  Elo/Glicko, leaderboards, season rollover.
- [ ] **Phase 14 — Social (friends, clubs, DMs)** — `NOT_STARTED`
  friend graph, clubs, messaging + moderation.
- [ ] **Phase 15 — Admin console** — `NOT_STARTED`
  user/game/AI-ops dashboards, feature flags, audit log.
- [ ] **Phase 16 — Moderation & anti-cheat** — `NOT_STARTED`
  reports, engine-side validation, anomaly flags.
- [ ] **Phase 17 — Payments & premium** — `NOT_STARTED`
  provider integration, entitlements, webhooks.
- [ ] **Phase 18 — Email & notifications** — `NOT_STARTED`
  SMTP templates, digests, push hooks.
- [ ] **Phase 19 — Storage & media** — `NOT_STARTED`
  S3 avatars/exports, quotas, CDN.
- [ ] **Phase 20 — Observability** — `NOT_STARTED`
  Sentry, metrics, tracing, alerting.
- [ ] **Phase 21 — Testing & QA gates** — `NOT_STARTED`
  unit/e2e/load, coverage thresholds, release checklist.
- [ ] **Phase 22 — CI/CD** — `NOT_STARTED`
  pipelines, preview envs, migration safety.
- [ ] **Phase 23 — Staging & production envs** — `NOT_STARTED`
  secrets management, backups, restore drills.
- [ ] **Phase 24 — Performance & scaling** — `NOT_STARTED`
  WS horizontal scale, read replicas, cache tuning.
- [ ] **Phase 25 — Security hardening** — `NOT_STARTED`
  audits, pentest, rate-limit tuning, header policy.
- [ ] **Phase 26 — Legal & compliance** — `NOT_STARTED`
  ToS/privacy, data export/delete, age gates.
- [ ] **Phase 27 — Launch (open beta)** — `NOT_STARTED`
  beta cohorts, feedback loop, status page.
- [ ] **Phase 28 — Post-launch ops** — `NOT_STARTED`
  on-call rotation, incident drills, cost review.
- [ ] **Phase 29 — V2 exploration** — `NOT_STARTED`
  variants, mobile clients, experimental modes.
