# Realtime design

## Transport
- WebSocket (Socket.IO-compatible room semantics or native WS — decision in
  Phase 05). One persistent connection per client; multiplexed rooms.
- Fallback: long-poll `/api/v1/games/:id/sync?since=<moveNumber>` for
  networks that kill WS. Same event envelope both ways.

## Rooms & channels (Redis-backed)
- `game:{id}` — the two players + spectators. Server publishes
  `state_patch` after every validated action.
- `lobby:{queue}` — matchmaking presence + countdown ticks.
- `user:{id}` — cross-device pings (move reminder, game start, offer).

Any backend replica subscribes on demand and republishes to its local
sockets (Redis adapter pattern), so deploys need no sticky sessions.

## Event envelope
```json
{
  "t": "state_patch",
  "gameId": "g_abc123",
  "moveNumber": 17,
  "patch": { "type": "wall", "wall": { "r": 4, "c": 4, "orientation": "h" } },
  "clocksMs": { "0": 284000, "1": 291500 },
  "serverTime": "2026-09-26T00:00:00.000Z"
}
```

## Clocks (server-owned)
- Config per game: `initialMs`, `incrementMs`, `timeoutPolicy`.
- Server stamps `serverTime` on every patch; clients interpolate display.
- Flag detection happens server-side only. Late packets never extend time.

## Reconnect & resync
1. Client reconnects with `lastSeenMoveNumber`.
2. Server replies `sync_diff`: compact list of missed patches, or
   `full_snapshot` if the gap exceeds the retained tail (default 200).
3. Client replays patches through its local engine copy and must match
   the server `stateHash` — mismatch ⇒ forced full snapshot + report.

## Ordering & idempotency (IMPLEMENTED, RTG-003)
- Every move/wall intent carries `actionId` (client UUID) and
  `baseMoveNumber` (the move count the client acted on).
- Socket payloads: `{ gameId, action, actionId?, baseMoveNumber? }`
  (`multi:*` mirrors this). REST accepts the raw action or the
  `{ action, actionId?, baseMoveNumber? }` envelope.
- Server keeps the last 50 action ids per game. A retried `actionId` is a
  no-op returning the current record (duplicate delivery applies once);
  snapshots echo `lastActionId` so clients can match replies.
- A present-but-stale `baseMoveNumber` is rejected with
  `Stale action — resync and retry` (wrong-turn and illegal-action checks
  still apply independently).
- Wall-clock note: dedupe is per-process memory. Cross-replica dedupe via
  the Redis room-leader lock above is future work; single-process and
  sticky-session deployments are fully covered.
- One writer per game: the room leader (first replica to `SETNX
  game:{id}:lock`, TTL 5 s, renewed while active). All intents funnel
  through it; others proxy over Redis.
- Client intents carry `clientOpId`; server echoes it, dedupes retries.
