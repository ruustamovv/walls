/**
 * UserStore — persistence boundary for accounts.
 *
 * MemoryUserStore keeps unit tests + offline dev working with zero services.
 * MongoUserStore is the production path (unique username/email enforced by
 * database indexes; duplicate-key races surface as conflicts, not 500s).
 * getAuthService() resolves Mongo when reachable and caches the choice.
 */
import { UserRepository, UserConflictError } from '../../database/mongodb/repositories/user.repository.js';
import type { UserDoc } from '../../database/mongodb/types.js';
import { getMongoDb } from '../../database/mongodb/client.js';
import { ConflictError } from '../../common/errors/errors.js';
import type { UserRecord } from './service.js';

export interface UserStore {
  create(input: { email: string; username: string; passwordHash: string }): Promise<UserRecord>;
  findByLogin(login: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Find by verified email, else create (OAuth linking). */
  findOrCreate(input: { email: string; username: string; passwordHash: string }): Promise<UserRecord>;
}

function toRecord(doc: UserDoc): UserRecord {
  return {
    id: doc._id,
    email: doc.email,
    username: doc.username,
    passwordHash: doc.passwordHash,
    role: doc.role === 'OWNER' || doc.role === 'ADMIN' ? 'admin' : doc.role === 'MODERATOR' ? 'moderator' : 'user',
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : Date.now(),
  };
}

export class MemoryUserStore implements UserStore {
  private readonly byId = new Map<string, UserRecord>();
  private readonly idByEmail = new Map<string, string>();
  private readonly idByUsername = new Map<string, string>();

  async create(input: { email: string; username: string; passwordHash: string }): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();
    if (this.idByEmail.has(email)) throw new ConflictError('Email already registered');
    if (this.idByUsername.has(username.toLowerCase())) throw new ConflictError('Username taken');
    const g = globalThis.crypto;
    const tail = typeof g?.randomUUID === 'function' ? g.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user: UserRecord = {
      id: `u_${tail}`, email, username, passwordHash: input.passwordHash, role: 'user', createdAt: Date.now(),
    };
    this.byId.set(user.id, user);
    this.idByEmail.set(email, user.id);
    this.idByUsername.set(username.toLowerCase(), user.id);
    return user;
  }

  async findByLogin(login: string): Promise<UserRecord | null> {
    const key = login.trim().toLowerCase();
    const id = this.idByEmail.get(key) ?? this.idByUsername.get(key);
    return id !== undefined ? (this.byId.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findOrCreate(input: { email: string; username: string; passwordHash: string }): Promise<UserRecord> {
    const existing = await this.findByLogin(input.email.trim().toLowerCase());
    if (existing !== null) return existing;
    // Unique-ify the username against collisions.
    let candidate = input.username.trim();
    let n = 0;
    for (;;) {
      try {
        return await this.create({ ...input, username: candidate });
      } catch (err) {
        if (!(err instanceof ConflictError) || !String((err as Error).message).includes('Username')) throw err;
        n++;
        if (n > 99) throw err;
        candidate = `${input.username.trim().slice(0, 18)}_${n}`;
      }
    }
  }
}

export class MongoUserStore implements UserStore {
  private readonly repo: UserRepository;

  constructor(repo: UserRepository) {
    this.repo = repo;
  }

  async create(input: { email: string; username: string; passwordHash: string }): Promise<UserRecord> {
    try {
      const doc = await this.repo.create({
        email: input.email.trim().toLowerCase(),
        username: input.username.trim(),
        passwordHash: input.passwordHash,
      });
      return toRecord(doc);
    } catch (err) {
      if (err instanceof UserConflictError) {
        throw new ConflictError(err.field === 'email' ? 'Email already registered' : 'Username taken');
      }
      throw err;
    }
  }

  async findByLogin(login: string): Promise<UserRecord | null> {
    const key = login.trim();
    const byEmail = await this.repo.findByEmail(key).catch(() => null);
    if (byEmail !== null) return toRecord(byEmail);
    const byName = await this.repo.findByUsername(key).catch(() => null);
    return byName === null ? null : toRecord(byName);
  }

  async findById(id: string): Promise<UserRecord | null> {
    // Memory-store ids (u_...) can never match a Mongo user — skip the query.
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
    const doc = await this.repo.findById(id).catch(() => null);
    return doc === null ? null : toRecord(doc);
  }

  async findOrCreate(input: { email: string; username: string; passwordHash: string }): Promise<UserRecord> {
    const existing = await this.findByLogin(input.email.trim().toLowerCase());
    if (existing !== null) return existing;
    let candidate = input.username.trim();
    for (let n = 0; n < 100; n++) {
      try {
        return await this.create({ ...input, username: candidate });
      } catch (err) {
        if (!(err instanceof ConflictError) || !String((err as Error).message).includes('Username')) throw err;
        candidate = `${input.username.trim().slice(0, 18)}_${n + 1}`;
      }
    }
    throw new ConflictError('Username taken');
  }
}

export async function createMongoUserStore(): Promise<MongoUserStore | null> {
  try {
    const db = await getMongoDb();
    return new MongoUserStore(new UserRepository(db));
  } catch {
    return null;
  }
}
