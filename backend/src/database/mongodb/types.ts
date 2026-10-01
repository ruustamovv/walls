/**
 * MongoDB domain types — plain TS interfaces decoupled from BSON.
 * Repositories map between these and stored documents.
 * IDs are strings (hex ObjectId) at the domain boundary.
 */

export type UserRole = 'USER' | 'MODERATOR' | 'ADMIN' | 'OWNER';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DELETED';
export type GameStatus = 'WAITING' | 'ACTIVE' | 'FINISHED' | 'ABORTED';

export interface UserDoc {
  _id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  /** Ephemeral guest account: casual-only, no ranked ratings. */
  guest: boolean;
  /** Email ownership confirmed via the verify flow (guests: false). */
  emailVerified: boolean;  /** Previous guest username, kept for audit when converted to a full account. */
  convertedFromGuestId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProfileDoc {
  _id: string;
  userId: string;
  displayName?: string;
  bio?: string;
  avatarUrl?: string;
  country?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: string;
  userId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface RatingDoc {
  _id: string;
  userId: string;
  mode: string;
  rating: number;
  deviation: number;
  volatility: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  peak: number;
  updatedAt: Date;
}

export interface RatingHistoryDoc {
  _id: string;
  userId: string;
  mode: string;
  gameId?: string;
  before: number;
  after: number;
  createdAt: Date;
}

export interface GamePlayerSnapshot {
  userId: string;
  seat: number;
  usernameAtStart: string;
  ratingAtStart: number;
  clockMs: number;
}

export interface GameDoc {
  _id: string;
  /** Engine-side game id (g_... / m_...) linking the live record; absent on legacy docs. */
  engineId?: string;
  rulesVersion: string;
  engineVersion: string;
  mode: string;
  timeControl: string;
  boardSize: number;
  wallCount: number;
  players: GamePlayerSnapshot[];
  status: GameStatus;
  result?: { winnerSeat: number | null; reason: string };
  currentTurn: number;
  moveCount: number;
  clocks?: { baseMs: number; incrementMs: number };
  /** 'duel' for classic 1v1, 'multi' for N-seat free-for-all. */
  variant?: 'duel' | 'multi';
  /** Winner-first seat order for multi games. */
  placement?: number[];
  /** Who may spectate / open replays. Defaults to public on old docs. */
  visibility?: 'public' | 'friends' | 'unlisted' | 'private';
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  finalStateHash?: string;
  version: number;
}

export interface GameMoveDoc {
  _id: string;
  gameId: string;
  sequence: number;
  playerId: string;
  seat: number;
  action: { type: 'move'; to: { r: number; c: number } } | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } };
  timestamp: Date;
  serverTimeMs: number;
  stateHash: string;
  clockAfterMs?: number;
}

export interface ReplayDoc {
  _id: string;
  gameId: string;
  rulesVersion: string;
  engineVersion: string;
  initialState: unknown;
  actions: GameMoveDoc['action'][];
  result?: GameDoc['result'];
  hash: string;
  visibility: 'public' | 'friends' | 'unlisted' | 'private';
  createdAt: Date;
}

export type TournamentFormat = 'single-elim' | 'round-robin' | 'swiss' | 'arena';

export interface TournamentDoc {
  _id: string;
  title: string;
  status: string;
  mode: string;
  timeControl: string;
  format: TournamentFormat;
  rounds: number;
  playersCap: number;
  ownerId?: string;
  champion?: string | null;
  startAt?: Date;
  endAt?: Date;
  /** Recurrence for daily/weekly series; none = one-off. */
  recurrence?: 'none' | 'daily' | 'weekly';
  /** When the next edition should be spawned (set on FINISHED recurring docs). */
  nextRunAt?: Date;
  /** Edition counter, incremented per spawned series entry. */
  edition?: number;
  createdAt: Date;
}

export interface NotificationDoc {
  _id: string;
  userId: string;
  kind: string;
  title: string;
  body?: string;
  read: boolean;
  createdAt: Date;
}

export interface PuzzleDoc {
  _id: string;
  fen_like?: string;
  prompt: string;
  solution: unknown;
  rating: number;
  createdAt: Date;
}

export type FriendRequestStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export interface FriendRequestDoc {
  _id: string;
  fromUserId: string;
  toUserId: string;
  status: FriendRequestStatus;
  createdAt: Date;
}

export interface FriendDoc {
  _id: string;
  userId: string;
  friendId: string;
  createdAt: Date;
}

export interface BlockDoc {
  _id: string;
  userId: string;
  blockedId: string;
  createdAt: Date;
}

export interface AdminAuditDoc {
  _id: string;
  actorId: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
}

export interface FeatureFlagDoc {
  _id: string;
  key: string;
  enabled: boolean;
  updatedAt: Date;
}

export type ClubRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface ClubDoc {
  _id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: Date;
}

export interface ClubMemberDoc {
  _id: string;
  clubId: string;
  userId: string;
  role: ClubRole;
  joinedAt: Date;
}
