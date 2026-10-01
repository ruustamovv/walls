/**
 * Social persistence: friend requests, friendships, blocks, admin audit
 * log, feature flags. IDs stay strings at the boundary (see ../ids.js).
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { tryToObjectId, withDomainId } from '../ids.js';
import type { AdminAuditDoc, BlockDoc, FeatureFlagDoc, FriendDoc, FriendRequestDoc } from '../types.js';

export class FriendRepository {
  constructor(private readonly db: Db) {}

  async request(fromUserId: string, toUserId: string): Promise<FriendRequestDoc> {
    if (fromUserId === toUserId) throw new Error('cannot friend yourself');
    if (await this.isBlocked(fromUserId, toUserId)) throw new Error('request not allowed');
    const existing = await this.db.collection(COLLECTIONS.friend_requests).findOne({
      $or: [
        { fromUserId, toUserId, status: 'PENDING' },
        { fromUserId: toUserId, toUserId: fromUserId, status: 'PENDING' },
      ],
    });
    if (existing !== null) return withDomainId<FriendRequestDoc>(existing as Record<string, unknown>);
    const res = await this.db.collection(COLLECTIONS.friend_requests).insertOne({
      fromUserId, toUserId, status: 'PENDING', createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.friend_requests).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('friend request insert failed');
    return withDomainId<FriendRequestDoc>(raw as Record<string, unknown>);
  }

  async incoming(userId: string): Promise<FriendRequestDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.friend_requests)
      .find({ toUserId: userId, status: 'PENDING' }).sort({ createdAt: -1 }).toArray();
    return rows.map((r) => withDomainId<FriendRequestDoc>(r as Record<string, unknown>));
  }

  async accept(requestId: string, userId: string): Promise<boolean> {
    const oid = tryToObjectId(requestId);
    if (oid === null) return false;
    const req = await this.db.collection(COLLECTIONS.friend_requests).findOne({ _id: oid, toUserId: userId, status: 'PENDING' });
    if (req === null) return false;
    const r = req as unknown as { fromUserId: string; toUserId: string };
    await this.db.collection(COLLECTIONS.friend_requests).updateOne({ _id: oid }, { $set: { status: 'ACCEPTED' } });
    const now = new Date();
    await this.db.collection(COLLECTIONS.friends).updateOne(
      { userId: r.fromUserId, friendId: r.toUserId },
      { $setOnInsert: { userId: r.fromUserId, friendId: r.toUserId, createdAt: now } },
      { upsert: true },
    );
    await this.db.collection(COLLECTIONS.friends).updateOne(
      { userId: r.toUserId, friendId: r.fromUserId },
      { $setOnInsert: { userId: r.toUserId, friendId: r.fromUserId, createdAt: now } },
      { upsert: true },
    );
    return true;
  }

  async list(userId: string): Promise<FriendDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.friends).find({ userId }).sort({ createdAt: -1 }).toArray();
    return rows.map((r) => withDomainId<FriendDoc>(r as Record<string, unknown>));
  }

  async areFriends(a: string, b: string): Promise<boolean> {
    const row = await this.db.collection(COLLECTIONS.friends).findOne({ userId: a, friendId: b });
    return row !== null;
  }

  async block(userId: string, blockedId: string): Promise<void> {
    await this.db.collection(COLLECTIONS.blocks).updateOne(
      { userId, blockedId },
      { $setOnInsert: { userId, blockedId, createdAt: new Date() } },
      { upsert: true },
    );
    await this.db.collection(COLLECTIONS.friends).deleteMany({
      $or: [{ userId, friendId: blockedId }, { userId: blockedId, friendId: userId }],
    });
    await this.db.collection(COLLECTIONS.friend_requests).deleteMany({
      $or: [
        { fromUserId: userId, toUserId: blockedId },
        { fromUserId: blockedId, toUserId: userId },
      ],
    });
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const row = await this.db.collection(COLLECTIONS.blocks).findOne({
      $or: [{ userId: a, blockedId: b }, { userId: b, blockedId: a }],
    });
    return row !== null;
  }
}

export type { BlockDoc };

export type ReportStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

export interface ReportDoc {
  _id: string;
  reporterId: string;
  targetType: 'user' | 'game' | 'club';
  targetId: string;
  reason: string;
  status: ReportStatus;
  resolution?: string;
  createdAt: Date;
}

export class ReportRepository {
  constructor(private readonly db: Db) {}

  async submit(reporterId: string, targetType: ReportDoc['targetType'], targetId: string, reason: string): Promise<ReportDoc> {
    const clean = reason.trim().slice(0, 1000);
    if (clean.length < 3) throw new Error('reason too short');
    if (targetId.trim().length === 0) throw new Error('target required');
    const res = await this.db.collection(COLLECTIONS.reports).insertOne({
      reporterId, targetType, targetId: targetId.trim(), reason: clean, status: 'OPEN', createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.reports).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('report insert failed');
    return withDomainId<ReportDoc>(raw as Record<string, unknown>);
  }

  async list(status: ReportStatus | 'ALL', limit = 50): Promise<ReportDoc[]> {
    const filter = status === 'ALL' ? {} : { status };
    const rows = await this.db.collection(COLLECTIONS.reports)
      .find(filter).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray();
    return rows.map((r) => withDomainId<ReportDoc>(r as Record<string, unknown>));
  }

  async findById(id: string): Promise<ReportDoc | null> {
    const oid = tryToObjectId(id);
    if (oid === null) return null;
    const raw = await this.db.collection(COLLECTIONS.reports).findOne({ _id: oid });
    return raw === null ? null : withDomainId<ReportDoc>(raw as Record<string, unknown>);
  }

  async resolve(id: string, status: Exclude<ReportStatus, 'OPEN'>, resolution: string): Promise<boolean> {    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.reports).updateOne(
      { _id: oid, status: 'OPEN' },
      { $set: { status, resolution: resolution.slice(0, 500) } },
    );
    return res.modifiedCount === 1;
  }

  async countOpen(): Promise<number> {
    return this.db.collection(COLLECTIONS.reports).countDocuments({ status: 'OPEN' });
  }
}

export class AuditRepository {
  constructor(private readonly db: Db) {}

  async append(actorId: string, action: string, target?: string, meta?: Record<string, unknown>): Promise<void> {
    await this.db.collection(COLLECTIONS.admin_audit_logs).insertOne({
      actorId, action, ...(target !== undefined ? { target } : {}),
      ...(meta !== undefined ? { meta } : {}), createdAt: new Date(),
    }).catch(() => undefined);
  }

  async list(limit = 50, filter: { actionPrefix?: string; actorId?: string } = {}): Promise<AdminAuditDoc[]> {
    const query: Record<string, unknown> = {};
    if (filter.actionPrefix !== undefined && filter.actionPrefix !== '') {
      query['action'] = { $regex: `^${filter.actionPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
    }
    if (filter.actorId !== undefined && filter.actorId !== '') query['actorId'] = filter.actorId;
    const rows = await this.db.collection(COLLECTIONS.admin_audit_logs)
      .find(query).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray();
    return rows.map((r) => withDomainId<AdminAuditDoc>(r as Record<string, unknown>));
  }
}

export class FlagRepository {
  constructor(private readonly db: Db) {}

  async list(): Promise<FeatureFlagDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.feature_flags).find({}).sort({ key: 1 }).toArray();
    return rows.map((r) => withDomainId<FeatureFlagDoc>(r as Record<string, unknown>));
  }

  async set(key: string, enabled: boolean): Promise<FeatureFlagDoc> {
    const clean = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 64);
    if (clean.length === 0) throw new Error('invalid flag key');
    await this.db.collection(COLLECTIONS.feature_flags).updateOne(
      { key: clean },
      { $set: { enabled, updatedAt: new Date() }, $setOnInsert: { key: clean } },
      { upsert: true },
    );
    const raw = await this.db.collection(COLLECTIONS.feature_flags).findOne({ key: clean });
    if (raw === null) throw new Error('flag upsert failed');
    return withDomainId<FeatureFlagDoc>(raw as Record<string, unknown>);
  }
}
