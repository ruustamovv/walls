# Threat model (concise)

## Assets
User accounts/ratings · live games + clocks · AI budget · PII (email) ·
owner/admin powers · audit trail.

## Actors
Cheating player (engine tampering, clock abuse, multi-accounting) ·
abusive user (spam, hate, grooming) · credential attacker · malicious
spectator/botnet (WS flood) · compromised dependency · insider admin.

## Key threats & mitigations
| # | Threat | Mitigation (phase) |
|---|--------|--------------------|
| T1 | Client forges moves/walls | server revalidates via engine; mismatch logged + forfeit (05) |
| T2 | Clock manipulation | server-only timing; signed `serverTime` on patches (05) |
| T3 | JWT theft / session fixation | httpOnly + SameSite cookies, short TTL, Redis revocation (03) |
| T4 | Owner seed password leak | single-use bootstrap, argon2 hash, forced rotation (03) |
| T5 | WS/DDoS flood | per-IP + per-user rate limits in Redis, room join caps (25) |
| T6 | Prompt injection → AI abuse | schema-validated outputs, no secrets in prompts, budget kill-switch (10) |
| T7 | Mass account creation | email verify + captcha + IP throttling (03/16) |
| T8 | Dependency supply chain | lockfiles, `pnpm audit` in CI, pinned base images (22) |
| T9 | Admin abuse | RBAC (owner/admin/mod), dual-confirm destructive ops, audit log (15) |
| T10 | Data leak (DB/S3) | least-privilege creds, presigned URLs, encrypted backups (23/25) |

## Out of scope (accepted risk, Phase 00)
Full pentest, kernel-level anti-cheat, E2E-encrypted DMs — tracked in
`docs/TODO.md` under Later/Experimental.

Report issues privately to the project owner. No public exploit write-ups
before a fix is deployed.
