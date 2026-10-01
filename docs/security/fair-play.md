# Fair play: conduct score + matchmaking fairness (FRP-001 / MTM-002)

Skill rating and conduct are separate systems. Rating measures skill;
the conduct score (0–100, starts at 100) measures reliability. It is
transparent — shown on every profile — and only ever affects pairing
preference, never hidden rating cuts.

## Score events

| Event | Delta | Source |
|-------|------:|--------|
| Finished game (goal/resign/draw) | +1 | settlement hooks (1v1 + party) |
| Abandon (timeout / disconnect; resigns excluded) | −8 | settlement hooks |
| Staff-RESOLVED user report | −20 | admin report resolution |
| Staff-DISMISSED report (reporter) | −2 | admin report resolution (spam deterrent) |

Idle accounts heal +1/day toward 100 on read (no cron). Levels:
90+ exemplary · 70+ good · 40+ caution · below restricted.

## Matchmaking use (MTM-002)

Tickets carry server-resolved `behavior` (default 100 unknown) plus an
optional client-declared `region` (coarse IANA timezone from the client;
preference only, never a gate — no GeoIP claims).

Pairing order per head ticket:
1. Rating window (existing expanding window).
2. Trust gap: `|behaviorA − behaviorB| ≤ 15 + waitedSec`, capped at 60.
   Wide gaps wait longer; decay + completed games heal scores back.
3. Region: same-region preferred for the first 20s, then cross-region.
   Missing region on either side counts as compatible.
4. Rematch avoidance: no repeat pairing within 10 minutes unless the head
   ticket waited 60s+.

Party (multi) buckets stay rating/behavior-free FFA casual for now.

## What this is NOT (honest limits)

- No automation/collusion detection yet (FRP-002 PARTIAL): only
  abandon + verified-report signals feed the score.
- No single-signal bans: low scores only deprioritize pairing; bans and
  mutes remain staff actions with audit rows.
- Cross-replica dedupe/queue fairness assumes sticky routing until the
  Redis room-leader work lands (see realtime.md).
