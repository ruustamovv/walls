# TODO — working backlog

## Critical (blocks next phase)
- [ ] Verify all Phase 00 files: `node scripts/setup/env-check.mjs`,
      `docker compose config`, `pnpm -r test`.
- [ ] Live WHOIS/registrar re-check for top-5 brand candidates (`.com` + `.uz`).
- [ ] Trademark pre-screen (USPTO/EUIPO + local registry) before buying domains.
- [ ] Engine fuzz harness: random plies, assert no-seal invariant + replay determinism.
- [ ] Backend auth skeleton: JWT issue/verify, owner bootstrap hashing (argon2).

## Important (this quarter)
- [ ] Postgres schema v1: users, games, moves, walls, ratings, audit log.
- [ ] WS room protocol: join/resync/clock/offer events + Redis fan-out.
- [ ] Matchmaking queue with rating bands + AFK timeout.
- [ ] Board renderer with wall-ghost preview + touch support.
- [ ] AI provider abstraction implementation + budget guard middleware.
- [ ] Admin console v0: user lookup, game inspector, feature flags.
- [ ] CI pipeline: lint + typecheck + unit + e2e smoke on every PR.

## Later (post-beta)
- [ ] Tournaments (Swiss + single-elim), season rollover job.
- [ ] Clubs, DMs, friend graph moderation tooling.
- [ ] Payments: entitlements, webhooks, refund flow.
- [ ] S3 media pipeline: avatar resize, replay export, CDN signing.
- [ ] Full observability: tracing, SLO dashboards, on-call rotation.

## Experimental (may cut)
- [ ] TTS commentary track for featured matches.
- [ ] Variant modes (fog, blitz draft, 4-player free-for-all) behind flags.
- [ ] Mobile wrapper (Capacitor) sharing the web board renderer.
- [ ] LLM opening-book miner over anonymised game corpus.
