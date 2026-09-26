# Free-tier cloud setup (Atlas + Upstash)

Run production-like experiments without paid services. Credentials live
ONLY in `.env` (never in git).

## MongoDB Atlas Free (M0)

1. Create an M0 cluster (mongodb.com/atlas). Current M0 limits are small
   (~512 MB storage, shared CPU) — enough for MVP experiments, not for
   production traffic. Check Atlas docs for current caps.
2. Create a database user (least privilege) + IP allowlist.
3. Connection string looks like:
   `mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority`
4. Set in `.env`:
   ```env
   MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=project_nexus
   ```
5. The backend needs a replica set for any future transactions — Atlas
   provides one by default.

## Redis-compatible Free (e.g. Upstash)

1. Create a free Redis database (upstash.com/redis). Free tiers typically
   cap commands/day + storage — check current limits.
2. Use the `rediss://` (TLS) endpoint + token as password, e.g.:
   ```env
   REDIS_URL=rediss://default:TOKEN@host:6379
   ```
3. `ioredis` supports `rediss://` out of the box.

## Safety

- NEVER commit `.env` or paste connection strings into chat/logs.
- The backend masks credentials in error output (`maskUri`).
- Rotate tokens from the provider dashboards; update `.env` only.
