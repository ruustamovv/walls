# Legacy PostgreSQL + Prisma schema (RETIRED)

> **Status: LEGACY — retired in Phase DB-01 (2026-09-26).**
> This document preserves the original PostgreSQL/Prisma schema as a domain reference.
> Runtime persistence is now **MongoDB (primary) + Redis (realtime)** via the official `mongodb` driver + `ioredis`.
> Do NOT build new features against this schema. See `docs/architecture/database.md` and `docs/architecture/mongodb-migrations.md`.

## What existed
- Prisma `schema.prisma` (PostgreSQL provider) with normalized tables for identity, ratings, games, social, moderation, billing.
- Prisma Client singleton (`backend/src/database/client.ts`), `prisma generate/migrate` scripts, `DATABASE_URL`.
- `docker-compose.yml` `postgres:16` service with `pgdata` volume.

## Why it was replaced
- Target architecture is low-cost: MongoDB Atlas Free + Redis-compatible (Upstash) Free; local Mongo/Redis in Docker.
- Document modeling fits game history/replays/ratings better; avoids relational ORM coupling.
- Official `mongodb` driver + typed repositories + Zod validation instead of Prisma.

## Original schema (verbatim copy)

```prisma
// PROJECT_NEXUS — canonical Postgres schema (spec §33).
// Normalized store for users, games, ratings, social, moderation, billing.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Identity ─────────────────────────────────────────
model User {
  id           String     @id @default(uuid())
  email        String     @unique
  username     String     @unique
  passwordHash String
  role         UserRole   @default(USER)
  status       UserStatus @default(ACTIVE)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  profile           Profile?
  sessions          Session[]
  ratings           Rating[]
  gamePlayers       GamePlayer[]
  friendsA          Friend[]           @relation("FriendA")
  friendsB          Friend[]           @relation("FriendB")
  sentRequests      FriendRequest[]    @relation("RequestFrom")
  recvRequests      FriendRequest[]    @relation("RequestTo")
  notifications     Notification[]
  reportsFiled      Report[]           @relation("Reporter")
  reportsAgainst    Report[]           @relation("ReportedUser")
  bans              Ban[]
  subscriptions     Subscription[]
  payments          Payment[]
  inventory         InventoryItem[]
  achievements      UserAchievement[]
  puzzleAttempts    PuzzleAttempt[]
  aiSessions        AiSession[]
  clubMembers       ClubMember[]
  tournamentPlayers TournamentPlayer[]
  auditActs         AdminAudit[]       @relation("AuditActor")
  chatMessages      ChatMessage[]

  @@index([role])
  @@index([status])
  @@index([createdAt])
}

enum UserRole {
  USER
  MODERATOR
  ADMIN
  OWNER
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  BANNED
  DELETED
}

model Profile {
  id          String   @id @default(uuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  displayName String?
  bio         String?  @db.VarChar(500)
  avatarUrl   String?
  country     String?  @db.VarChar(2)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model Session {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userAgent String?
  ip        String?
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
  @@index([expiresAt])
}

// ── Ratings (per-mode Glicko-2) ──────────────────────
model Rating {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  mode        String   @db.VarChar(32)
  rating      Float    @default(1500)
  rd          Float    @default(350)
  vol         Float    @default(0.06)
  gamesPlayed Int      @default(0)
  updatedAt   DateTime @updatedAt

  @@unique([userId, mode])
  @@index([mode, rating(sort: Desc)])
}

model RatingHistory {
  id        String   @id @default(uuid())
  userId    String
  mode      String   @db.VarChar(32)
  gameId    String?
  before    Float
  after     Float
  createdAt DateTime @default(now())

  @@index([userId, mode, createdAt])
}

// ── Games ────────────────────────────────────────────
model Game {
  id             String     @id @default(uuid())
  boardSize      Int        @default(9)
  wallsPerPlayer Int        @default(10)
  timeControl    String     @db.VarChar(8)
  status         GameStatus @default(WAITING)
  winnerSeat     Int?
  rulesVersion   String     @default("1.0.0")
  seed           Int?
  createdAt      DateTime   @default(now())
  finishedAt     DateTime?
  updatedAt      DateTime   @updatedAt

  players GamePlayer[]
  moves   GameMove[]
  events  GameEvent[]
  replay  Replay?

  @@index([status])
  @@index([createdAt])
}

enum GameStatus {
  WAITING
  ACTIVE
  FINISHED
  ABORTED
}

model GamePlayer {
  id      String @id @default(uuid())
  gameId  String
  game    Game   @relation(fields: [gameId], references: [id], onDelete: Cascade)
  userId  String
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  seat    Int
  clockMs Int    @default(180000)

  @@unique([gameId, seat])
  @@unique([gameId, userId])
  @@index([userId])
}

model GameMove {
  id       String   @id @default(uuid())
  gameId   String
  game     Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  ply      Int
  seat     Int
  kind     String   @db.VarChar(8) // move | wall
  payload  Json
  serverAt DateTime @default(now())

  @@unique([gameId, ply])
  @@index([gameId])
}

model GameEvent {
  id       String   @id @default(uuid())
  gameId   String
  game     Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  type     String   @db.VarChar(32)
  payload  Json?
  serverAt DateTime @default(now())

  @@index([gameId, serverAt])
}

model Replay {
  id        String   @id @default(uuid())
  gameId    String   @unique
  game      Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  version   String   @default("1")
  hash      String
  data      Json
  createdAt DateTime @default(now())

  @@index([hash])
}

// ── Bots ─────────────────────────────────────────────
model BotProfile {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  difficulty  Int      @default(1)
  config      Json?
  createdAt   DateTime @default(now())
}

// ── Matchmaking ──────────────────────────────────────
model MatchmakingTicket {
  id          String   @id @default(uuid())
  userId      String
  mode        String   @db.VarChar(32)
  timeControl String   @db.VarChar(8)
  rating      Float
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@unique([userId])
  @@index([mode, timeControl, rating])
  @@index([expiresAt])
}

// ── Tournaments ──────────────────────────────────────
model Tournament {
  id        String           @id @default(uuid())
  name      String
  status    TournamentStatus @default(DRAFT)
  startsAt  DateTime?
  endsAt    DateTime?
  config    Json?
  createdAt DateTime         @default(now())

  players TournamentPlayer[]
  rounds  TournamentRound[]

  @@index([status, startsAt])
}

enum TournamentStatus {
  DRAFT
  OPEN
  RUNNING
  FINISHED
  CANCELLED
}

model TournamentPlayer {
  id           String     @id @default(uuid())
  tournamentId String
  tournament   Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  userId       String
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  seed         Int?

  @@unique([tournamentId, userId])
}

model TournamentRound {
  id           String     @id @default(uuid())
  tournamentId String
  tournament   Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  roundNo      Int
  pairings     Json
  createdAt    DateTime   @default(now())

  @@unique([tournamentId, roundNo])
}

// ── Clubs ────────────────────────────────────────────
model Club {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  ownerId     String
  createdAt   DateTime @default(now())

  members ClubMember[]
}

model ClubMember {
  id       String   @id @default(uuid())
  clubId   String
  club     Club     @relation(fields: [clubId], references: [id], onDelete: Cascade)
  userId   String
  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role     String   @default("member") @db.VarChar(16)
  joinedAt DateTime @default(now())

  @@unique([clubId, userId])
}

// ── Social ───────────────────────────────────────────
model Friend {
  id        String   @id @default(uuid())
  userAId   String
  userA     User     @relation("FriendA", fields: [userAId], references: [id], onDelete: Cascade)
  userBId   String
  userB     User     @relation("FriendB", fields: [userBId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userAId, userBId])
  @@index([userBId])
}

model FriendRequest {
  id        String   @id @default(uuid())
  fromId    String
  from      User     @relation("RequestFrom", fields: [fromId], references: [id], onDelete: Cascade)
  toId      String
  to        User     @relation("RequestTo", fields: [toId], references: [id], onDelete: Cascade)
  status    String   @default("pending") @db.VarChar(16)
  createdAt DateTime @default(now())

  @@unique([fromId, toId])
  @@index([toId, status])
}

model Notification {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      String    @db.VarChar(32)
  payload   Json?
  readAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, createdAt])
}

// ── Chat ─────────────────────────────────────────────
model ChatChannel {
  id        String   @id @default(uuid())
  name      String   @unique
  kind      String   @db.VarChar(16) // global | club | game | dm
  createdAt DateTime @default(now())

  messages ChatMessage[]
}

model ChatMessage {
  id        String      @id @default(uuid())
  channelId String
  channel   ChatChannel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  userId    String
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  body      String      @db.VarChar(500)
  createdAt DateTime    @default(now())

  @@index([channelId, createdAt])
}

// ── Moderation ───────────────────────────────────────
model Report {
  id             String   @id @default(uuid())
  reporterId     String
  reporter       User     @relation("Reporter", fields: [reporterId], references: [id], onDelete: Cascade)
  reportedUserId String?
  reportedUser   User?    @relation("ReportedUser", fields: [reportedUserId], references: [id], onDelete: SetNull)
  gameId         String?
  reason         String
  status         String   @default("open") @db.VarChar(16)
  createdAt      DateTime @default(now())

  @@index([status, createdAt])
}

model ModerationCase {
  id         String   @id @default(uuid())
  reportId   String?
  assigneeId String?
  status     String   @default("open") @db.VarChar(16)
  notes      String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([status])
}

model Ban {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  reason    String
  expiresAt DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
}

// ── Billing ──────────────────────────────────────────
model Subscription {
  id        String    @id @default(uuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan      String    @db.VarChar(32)
  status    String    @db.VarChar(16)
  renewsAt  DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, status])
}

model Payment {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider    String   @db.VarChar(16)
  amountCents Int
  currency    String   @db.VarChar(8)
  status      String   @db.VarChar(16)
  createdAt   DateTime @default(now())

  @@index([userId, createdAt])
}

// ── Cosmetics / achievements / seasons ───────────────
model Cosmetic {
  id         String @id @default(uuid())
  kind       String @db.VarChar(32)
  name       String @unique
  priceCents Int    @default(0)
  data       Json?

  inventory InventoryItem[]
}

model InventoryItem {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  cosmeticId String
  cosmetic   Cosmetic @relation(fields: [cosmeticId], references: [id], onDelete: Cascade)
  acquiredAt DateTime @default(now())

  @@unique([userId, cosmeticId])
}

model Achievement {
  id          String  @id @default(uuid())
  key         String  @unique
  name        String
  description String?

  holders UserAchievement[]
}

model UserAchievement {
  id            String      @id @default(uuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  achievementId String
  achievement   Achievement @relation(fields: [achievementId], references: [id], onDelete: Cascade)
  earnedAt      DateTime    @default(now())

  @@unique([userId, achievementId])
}

model Season {
  id       String   @id @default(uuid())
  name     String   @unique
  startsAt DateTime
  endsAt   DateTime

  @@index([startsAt, endsAt])
}

// ── Puzzles ──────────────────────────────────────────
model Puzzle {
  id         String   @id @default(uuid())
  fen        String
  solution   Json
  difficulty Int      @default(1)
  createdAt  DateTime @default(now())

  attempts PuzzleAttempt[]

  @@index([difficulty])
}

model PuzzleAttempt {
  id        String   @id @default(uuid())
  puzzleId  String
  puzzle    Puzzle   @relation(fields: [puzzleId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  solved    Boolean
  createdAt DateTime @default(now())

  @@index([userId, puzzleId])
}

// ── AI ───────────────────────────────────────────────
model AiSession {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  kind      String   @db.VarChar(32)
  tokens    Int      @default(0)
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}

model AiUsage {
  id        String @id @default(uuid())
  userId    String
  period    String @db.VarChar(16) // YYYY-MM
  tokens    Int    @default(0)
  costCents Int    @default(0)

  @@unique([userId, period])
}

model AiJob {
  id        String   @id @default(uuid())
  kind      String   @db.VarChar(32)
  status    String   @default("queued") @db.VarChar(16)
  payload   Json?
  createdAt DateTime @default(now())

  @@index([status, createdAt])
}

// ── Admin / platform ─────────────────────────────────
model AdminAudit {
  id        String   @id @default(uuid())
  actorId   String
  actor     User     @relation("AuditActor", fields: [actorId], references: [id], onDelete: Cascade)
  action    String   @db.VarChar(64)
  target    String?
  payload   Json?
  createdAt DateTime @default(now())

  @@index([actorId, createdAt])
}

model FeatureFlag {
  key       String   @id
  enabled   Boolean  @default(false)
  payload   Json?
  updatedAt DateTime @updatedAt
}

model Announcement {
  id       String    @id @default(uuid())
  title    String
  body     String
  startsAt DateTime  @default(now())
  endsAt   DateTime?

  @@index([startsAt, endsAt])
}

model SystemSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}

model AnalyticsEvent {
  id        String   @id @default(uuid())
  userId    String?
  type      String   @db.VarChar(64)
  payload   Json?
  createdAt DateTime @default(now())

  @@index([type, createdAt])
  @@index([userId, createdAt])
}
```
