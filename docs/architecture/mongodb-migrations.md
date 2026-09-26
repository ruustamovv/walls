# MongoDB schema evolution (no SQL-style migrations)

MongoDB has no `prisma migrate` equivalent here by design. Schema changes
are handled with explicit versioning + backfill scripts.

## Rules

1. **Additive first** — new fields are optional with defaults; old readers
   ignore unknown fields. Never rename a field in place without a backfill.
2. **Version fields** — games carry `rulesVersion` + `engineVersion`;
   replays pin both so old replays replay under old rules.
3. **Backfills are scripts** — one-shot `tsx` scripts under
   `backend/src/database/backfills/` (create the dir when needed), each with:
   - a date prefix (`20260926-...`),
   - dry-run mode,
   - batching (e.g. 500 docs),
   - idempotency (safe to re-run),
   - a log line per batch.
4. **Indexes separately** — index changes go through `ensureIndexes()`
   (`backend/src/database/mongodb/indexes.ts`), deployed before the code
   that depends on them.
5. **Deployment order** — backfill → deploy code that writes new shape →
   deploy code that requires new shape → (later) cleanup script.
6. **Transactions** — avoided by default. If a backfill needs
   multi-document atomicity, it must run against a replica set
   (Atlas provides one; local Docker single-node does NOT support
   transactions — design backfills to be idempotent instead).

## History

- DB-01 (2026-09-26): PostgreSQL + Prisma retired
  (`docs/architecture/legacy-postgres-prisma-schema.md`); MongoDB
  collections + indexes + repositories introduced.
