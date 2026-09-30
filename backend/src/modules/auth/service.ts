/**
 * Auth service — register / login / logout over a pluggable UserStore.
 *
 * - Passwords hashed with argon2id (scrypt fallback in dev/test).
 * - Rate-limit hooks: each method returns a `rateLimitKey`; routes enforce
 *   limits via @fastify/rate-limit keyed on ip + action.
 * - Default store is in-memory (unit tests, offline dev). Production routes
 *   resolve a Mongo-backed store via getAuthService() when Mongo is up.
 */
import { AuthError } from '../../common/errors/errors.js';
import { hashPassword, verifyPassword } from './hashing.js';
import { SessionService, createSessionStore, type SessionRecord } from './session.js';
import { MemoryUserStore, createMongoUserStore, type UserStore } from './store.js';

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'moderator' | 'admin' | 'owner';
  /** Ephemeral guest: casual-only, excluded from ranked settlement. */
  guest: boolean;
  createdAt: number;
}

export interface AuthResult {
  user: Pick<UserRecord, 'id' | 'email' | 'username' | 'role' | 'guest'>;
  session: SessionRecord;
  /** Suggested rate-limit bucket for the route layer. */
  rateLimitKey: string;
}

function publicUser(user: UserRecord): AuthResult['user'] {
  return { id: user.id, email: user.email, username: user.username, role: user.role, guest: user.guest };
}

export class AuthService {
  private readonly sessions: SessionService;
  private readonly store: UserStore;

  constructor(store: UserStore = new MemoryUserStore(), sessions: SessionService = new SessionService()) {
    this.store = store;
    this.sessions = sessions;
  }

  async register(input: { email: string; username: string; password: string }): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.store.create({
      email: input.email,
      username: input.username,
      passwordHash,
    });

    const session = await this.sessions.create(user.id);
    return {
      user: publicUser(user),
      session,
      rateLimitKey: `auth:register`,
    };
  }

  async login(input: { login: string; password: string }): Promise<AuthResult> {
    const user = await this.store.findByLogin(input.login);
    if (user === null) throw new AuthError('Invalid credentials');
    const ok = await verifyPassword(user.passwordHash, input.password);
    if (!ok) throw new AuthError('Invalid credentials');

    const session = await this.sessions.create(user.id);
    return {
      user: publicUser(user),
      session,
      rateLimitKey: `auth:login`,
    };
  }

  /** OAuth / trusted linking: find by verified email or create. */
  async loginOAuth(input: { email: string; username: string; passwordHash: string }): Promise<AuthResult> {
    const user = await this.store.findOrCreate({
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
    });
    const session = await this.sessions.create(user.id);
    return {
      user: publicUser(user),
      session,
      rateLimitKey: `auth:oauth`,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  /** Revoke every session for a user (logout all devices). */
  async logoutAll(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser(userId);
  }

  async me(sessionId: string): Promise<UserRecord | null> {
    const s = await this.sessions.get(sessionId);
    if (s === null) return null;
    return this.store.findById(s.userId);
  }

  /** Ephemeral guest session: no credentials, casual-only (GST-001). */
  async createGuest(): Promise<AuthResult> {
    const user = await this.store.createGuest();
    const session = await this.sessions.create(user.id);
    return { user: publicUser(user), session, rateLimitKey: `auth:guest` };
  }

  /**
   * Upgrade a guest session to a full account IN PLACE (same id, so all
   * userId-keyed history transfers). Guests never settle ranked ratings,
   * so no fabricated competitive history can migrate (GST-005).
   */
  async convertGuest(guestId: string, input: { email: string; username: string; password: string }): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    const user = await this.store.convertGuest(guestId, {
      email: input.email,
      username: input.username,
      passwordHash,
    });
    if (user.guest) throw new AuthError('Conversion failed');
    const session = await this.sessions.create(user.id);
    return { user: publicUser(user), session, rateLimitKey: `auth:convert` };
  }

  /** True when the user id belongs to an ephemeral guest (any store). */
  async isGuest(userId: string): Promise<boolean> {
    const user = await this.store.findById(userId).catch(() => null);
    return user?.guest === true;
  }
}

export const authService = new AuthService();

let resolved: AuthService | null = null;

/**
 * Production resolver: Mongo-backed accounts + shared Redis sessions when
 * the infrastructure is reachable, otherwise the in-memory service
 * (offline dev stays usable). Decisions are cached per process.
 */
export async function getAuthService(): Promise<AuthService> {
  if (resolved !== null) return resolved;
  const mongoStore = await createMongoUserStore();
  if (mongoStore === null) {
    resolved = authService;
    return resolved;
  }
  const sessions = new SessionService(await createSessionStore());
  resolved = new AuthService(mongoStore, sessions);
  return resolved;
}

/** Test helper — drop the cached resolver decision. */
export function __resetAuthServiceForTests(): void {
  resolved = null;
}
