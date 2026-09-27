/**
 * Ops persistence: announcements, analytics events, bans/mutes, AI quotas.
 * IDs stay strings at the boundary.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { tryToObjectId, withDomainId } from '../ids.js';

export interface AnnouncementDoc {
  _id: string;
  title: string;
  body: string;
  audience: 'all' | 'premium' | 'new';
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
}

export class AnnouncementRepository {
  constructor(private readonly db: Db) {}

  async create(input: { title: string; body: string; audience?: string; startsAt?: Date; endsAt?: Date | null }): Promise<AnnouncementDoc> {
    const title = input.title.trim().slice(0, 120);
    const body = input.body.trim().slice(0, 2000);
    if (title.length < 3 || body.length < 3) throw new Error('announcement too short');
    const audience = input.audience === 'premium' || input.audience === 'new' ? input.audience : 'all';
    const res = await this.db.collection(COLLECTIONS.announcements).insertOne({
      title, body, audience,
      startsAt: input.startsAt ?? new Date(),
      endsAt: input.endsAt ?? null,
      createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.announcements).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('announcement insert failed');
    return withDomainId<AnnouncementDoc>(raw as Record<string, unknown>);
  }

  async active(now = new Date()): Promise<AnnouncementDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.announcements).find({
      startsAt: { $lte: now },
      $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
    }).sort({ createdAt: -1 }).limit(5).toArray();
    return rows.map((r) => withDomainId<AnnouncementDoc>(r as Record<string, unknown>));
  }

  async list(limit = 30): Promise<AnnouncementDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.announcements)
      .find({}).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
    return rows.map((r) => withDomainId<AnnouncementDoc>(r as Record<string, unknown>));
  }

  async remove(id: string): Promise<boolean> {
    const oid = tryToObjectId(id);
    if (oid === null) return false;
    const res = await this.db.collection(COLLECTIONS.announcements).deleteOne({ _id: oid });
    return res.deletedCount === 1;
  }
}

export interface BanDoc {
  _id: string;
  userId: string;
  type: 'MUTE' | 'BAN';
  reason: string;
  until: Date | null;
  by: string;
  createdAt: Date;
}

export class BanRepository {
  constructor(private readonly db: Db) {}

  async mute(userId: string, reason: string, minutes: number, by: string): Promise<BanDoc> {
    const res = await this.db.collection(COLLECTIONS.bans).insertOne({
      userId, type: 'MUTE', reason: reason.slice(0, 500),
      until: new Date(Date.now() + Math.min(Math.max(minutes, 1), 43200) * 60000),
      by, createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.bans).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('mute insert failed');
    return withDomainId<BanDoc>(raw as Record<string, unknown>);
  }

  async mutedUntil(userId: string): Promise<Date | null> {
    const row = await this.db.collection(COLLECTIONS.bans).findOne({
      userId, type: 'MUTE', until: { $gt: new Date() },
    });
    if (row === null) return null;
    return (row as Record<string, unknown>)['until'] as Date;
  }

  async listActive(limit = 50): Promise<BanDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.bans)
      .find({}).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 200)).toArray();
    return rows.map((r) => withDomainId<BanDoc>(r as Record<string, unknown>));
  }
}

export class QuotaRepository {
  constructor(private readonly db: Db) {}

  /** Per-user daily AI quota override (null = default, 0 = blocked). */
  async get(userId: string, day: string): Promise<number | null> {
    const row = await this.db.collection('ai_quotas').findOne({ userId, day }).catch(() => null);
    if (row === null) return null;
    const v = Number((row as Record<string, unknown>)['limit']);
    return Number.isFinite(v) && v >= 0 ? Math.min(v, 1000) : null;
  }

  async set(userId: string, day: string, limit: number): Promise<void> {
    await this.db.collection('ai_quotas').updateOne(
      { userId, day },
      { $set: { limit: Math.min(Math.max(Math.round(limit), 0), 1000), updatedAt: new Date() } },
      { upsert: true },
    );
  }
}

export async function trackEvent(db: Db, userId: string | null, name: string, props: Record<string, unknown> = {}): Promise<void> {
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64);
  if (clean.length < 2) return;
  await db.collection(COLLECTIONS.analytics_events).insertOne({
    userId, name: clean, props, createdAt: new Date(),
  }).catch(() => undefined);
}
