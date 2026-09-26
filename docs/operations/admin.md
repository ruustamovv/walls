# Admin runbook (v0 stub — full console in Phase 15)

## Roles
`owner` > `admin` > `moderator` > `player`. Owner-only: role grants,
feature-flag publishes, payment config, destructive ops. All admin reads
and writes land in `audit_log`.

## Daily checks
1. Error budget: Sentry open issues / error rate < 0.5 %.
2. Queues: matchmaking depth, AI review backlog age.
3. Spend: AI daily vs prorated `AI_MONTHLY_BUDGET_USD`; storage growth.
4. Reports queue: new user/game reports triaged within 24 h.

## Common ops
| Task | How (target UX) |
|------|-----------------|
| Look up user | admin → search email/username → profile + games + ratings |
| Inspect game | open `game:{id}` → action log, hashes, clocks, WS room members |
| Mute/ban | preset durations; reason required; auto-audit entry |
| Void result (cheat) | void + rating rollback entry in `ratings_history` |
| Toggle flag | `flags.set(name, value, %rollout)`; owner confirms > 10 % |
| Rotate secret | secret manager update → rolling backend restart → revoke old |

## Destructive ops (dual-confirm)
DB restore, mass ban, prize payout, flag publish > 10 %: second owner/admin
approves in-console; both identities recorded in `audit_log`.
