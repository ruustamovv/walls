# Incident response (stub — drill in Phase 28)

## Severities
- **SEV1** — data loss / auth bypass / prod down: page owner, war-room now.
- **SEV2** — degraded play (WS drops, AI over-spend): respond < 1 h.
- **SEV3** — cosmetic / single-feature: next business day.

## Procedure
1. **Detect:** Sentry alert / uptime ping / user report → open incident
   (`INC-YYYY-NNN`), assign commander.
2. **Contain:** freeze deploys; if cheating wave → enable lockdown flag
   (disable ranked queue); if spend spike → AI kill-switch; if breach →
   rotate secrets + revoke sessions.
3. **Mitigate:** rollback / scale replicas / pause clocks (`server_pause`).
4. **Communicate:** status line in-app + owner-approved message; updates
   every 30 min for SEV1.
5. **Resolve & review:** blameless post-mortem within 5 days: timeline,
   root cause, action items filed in `docs/TODO.md`.

## Contacts & links
- Commander: project owner (see `OWNER_EMAIL`).
- War-room: TBD (Phase 23). Logs: Sentry + backend `logs/`.
- Rollback: `pnpm build` previous tag; DB restore per Phase 23 drill.
