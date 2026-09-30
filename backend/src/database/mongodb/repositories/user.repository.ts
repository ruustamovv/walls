/**
 * UserRepository — domain-oriented user persistence.
 * Unique indexes on username/email enforce identity integrity;
 * duplicate-key errors surface as typed conflicts (not raw driver errors).
 */
import type { Db } from 'mongodb';
import { z } from 'zod';
import { COLLECTIONS } from '../collections.js';
import { toDomainId, tryToObjectId } from '../ids.js';
import type { UserDoc, UserRole, UserStatus } from '../types.js';

export const CreateUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers, underscore only'),
  passwordHash: z.string().min(1),
  role: z.enum(['USER', 'MODERATOR', 'ADMIN', 'OWNER']).default('USER'),
  guest: z.boolean().default(false),
  convertedFromGuestId: z.string().max(64).optional(),
});
export type CreateUserInput = z.input<typeof CreateUserSchema>;

export class UserConflictError extends Error {
  readonly field: 'email' | 'username';
  constructor(field: 'email' | 'username') {
    super(`${field} already taken`);
    this.field = field;
  }
}

function toDoc(raw: Record<string, unknown>): UserDoc {
  return {
    _id: toDomainId(raw['_id']),
    email: String(raw['email']),
    username: String(raw['username']),
    passwordHash: String(raw['passwordHash']),
    role: raw['role'] as UserRole,
    status: raw['status'] as UserStatus,
    guest: raw['guest'] === true,
    ...(typeof raw['convertedFromGuestId'] === 'string' ? { convertedFromGuestId: raw['convertedFromGuestId'] } : {}),
    createdAt: raw['createdAt'] as Date,
    updatedAt: raw['updatedAt'] as Date,
  };
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  private get users() {
    return this.db.collection<Record<string, unknown>>(COLLECTIONS.users);
  }

  async create(input: CreateUserInput): Promise<UserDoc> {
    const parsed = CreateUserSchema.parse(input);
    const now = new Date();
    try {
      const res = await this.users.insertOne({
        email: parsed.email,
        username: parsed.username,
        passwordHash: parsed.passwordHash,
        role: parsed.role,
        guest: parsed.guest,
        ...(parsed.convertedFromGuestId !== undefined ? { convertedFromGuestId: parsed.convertedFromGuestId } : {}),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      });
      const created = await this.users.findOne({ _id: res.insertedId });
      if (created === null) throw new Error('user insert did not return a document');
      return toDoc(created);
    } catch (err: unknown) {
      if (err !== null && typeof err === 'object' && (err as { code?: number }).code === 11000) {
        const key = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
        throw new UserConflictError('email' in key ? 'email' : 'username');
      }
      throw err;
    }
  }

  async findById(id: string): Promise<UserDoc | null> {
    const oid = tryToObjectId(id);
    if (oid === null) return null;
    const raw = await this.users.findOne({ _id: oid });
    return raw === null ? null : toDoc(raw);
  }

  async findByUsername(username: string): Promise<UserDoc | null> {
    const raw = await this.users.findOne({ username });
    return raw === null ? null : toDoc(raw);
  }

  async findByEmail(email: string): Promise<UserDoc | null> {
    const raw = await this.users.findOne({ email: email.toLowerCase() });
    return raw === null ? null : toDoc(raw);
  }

  async search(prefix: string, limit = 20): Promise<UserDoc[]> {
    const clean = prefix.trim().slice(0, 24);
    if (clean.length === 0) return [];
    const rows = await this.users
      .find({
        username: { $regex: `^${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
        // Ephemeral guests have no persistent identity — never searchable.
        guest: { $ne: true },
      })
      .limit(Math.min(Math.max(limit, 1), 50))
      .toArray();
    return rows.map((r) => toDoc(r as Record<string, unknown>));
  }

  async count(): Promise<number> {
    return this.users.countDocuments({});
  }

  async updatePassword(id: string, passwordHash: string): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.users.updateOne(
      { _id: oid },
      { $set: { passwordHash, updatedAt: new Date() } },
    );
    return res.matchedCount === 1;
  }

  async updateRole(id: string, role: UserDoc['role']): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.users.updateOne(
      { _id: oid },
      { $set: { role, updatedAt: new Date() } },
    );
    return res.matchedCount === 1;
  }

  async updateStatus(id: string, status: UserStatus): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.users.updateOne(
      { _id: oid },
      { $set: { status, updatedAt: new Date() } },
    );
    return res.matchedCount === 1;
  }

  /**
   * Guest conversion: upgrade the SAME document (identity preserved, so all
   * userId-keyed history — games, puzzles, notifications — transfers
   * automatically). Ranked history cannot exist for guests (never settled),
   * so nothing fake is ever migrated.
   */
  async convertGuest(id: string, input: { email: string; username: string; passwordHash: string }): Promise<UserDoc> {
    const oid = tryToObjectId(id);
    if (oid === null) throw new UserConflictError('username');
    const current = await this.users.findOne({ _id: oid });
    if (current === null) throw new UserConflictError('username');
    if (current['guest'] !== true) throw new UserConflictError('email');
    try {
      const res = await this.users.updateOne(
        { _id: oid, guest: true },
        {
          $set: {
            email: input.email.trim().toLowerCase(),
            username: input.username.trim(),
            passwordHash: input.passwordHash,
            guest: false,
            convertedFromGuestId: String(current['username'] ?? 'guest'),
            updatedAt: new Date(),
          },
        },
      );
      if (res.matchedCount === 0) throw new UserConflictError('username');
    } catch (err: unknown) {
      if (err !== null && typeof err === 'object' && (err as { code?: number }).code === 11000) {
        const key = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
        throw new UserConflictError('email' in key ? 'email' : 'username');
      }
      throw err;
    }
    const raw = await this.users.findOne({ _id: oid });
    if (raw === null) throw new Error('guest conversion did not return a document');
    return toDoc(raw as Record<string, unknown>);
  }
}
