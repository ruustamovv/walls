/**
 * Club persistence: clubs, memberships with roles. IDs stay strings
 * at the boundary (see ../ids.js).
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { tryToObjectId, withDomainId } from '../ids.js';
import type { ClubDoc, ClubMemberDoc, ClubRole } from '../types.js';

export class ClubRepository {
  constructor(private readonly db: Db) {}

  async create(ownerId: string, name: string, description: string): Promise<ClubDoc> {
    const clean = name.trim().slice(0, 40);
    if (clean.length < 3) throw new Error('club name too short');
    const res = await this.db.collection(COLLECTIONS.clubs).insertOne({
      name: clean, description: description.trim().slice(0, 500),
      ownerId, createdAt: new Date(),
    });
    await this.db.collection(COLLECTIONS.club_members).insertOne({
      clubId: res.insertedId.toHexString(), userId: ownerId, role: 'OWNER' satisfies ClubRole, joinedAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.clubs).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('club insert failed');
    return withDomainId<ClubDoc>(raw as Record<string, unknown>);
  }

  async list(limit = 30): Promise<{ club: ClubDoc; members: number }[]> {
    const rows = await this.db.collection(COLLECTIONS.clubs)
      .find({}).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
    const out: { club: ClubDoc; members: number }[] = [];
    for (const r of rows) {
      const club = withDomainId<ClubDoc>(r as Record<string, unknown>);
      const members = await this.db.collection(COLLECTIONS.club_members).countDocuments({ clubId: club._id });
      out.push({ club, members });
    }
    return out;
  }

  async findById(id: string): Promise<ClubDoc | null> {
    const oid = tryToObjectId(id);
    if (oid === null) return null;
    const raw = await this.db.collection(COLLECTIONS.clubs).findOne({ _id: oid });
    return raw === null ? null : withDomainId<ClubDoc>(raw as Record<string, unknown>);
  }

  async join(clubId: string, userId: string): Promise<boolean> {
    const club = await this.findById(clubId);
    if (club === null) return false;
    await this.db.collection(COLLECTIONS.club_members).updateOne(
      { clubId: club._id, userId },
      { $setOnInsert: { clubId: club._id, userId, role: 'MEMBER' satisfies ClubRole, joinedAt: new Date() } },
      { upsert: true },
    );
    return true;
  }

  async leave(clubId: string, userId: string): Promise<boolean> {
    const club = await this.findById(clubId);
    if (club === null) return false;
    if (club.ownerId === userId) return false; // owners keep the lights on
    const res = await this.db.collection(COLLECTIONS.club_members).deleteOne({ clubId: club._id, userId });
    return res.deletedCount === 1;
  }

  async members(clubId: string): Promise<ClubMemberDoc[]> {
    const club = await this.findById(clubId);
    if (club === null) return [];
    const rows = await this.db.collection(COLLECTIONS.club_members)
      .find({ clubId: club._id }).sort({ joinedAt: 1 }).toArray();
    return rows.map((r) => withDomainId<ClubMemberDoc>(r as Record<string, unknown>));
  }

  async myClubs(userId: string): Promise<ClubDoc[]> {
    const links = await this.db.collection(COLLECTIONS.club_members).find({ userId }).toArray();
    const out: ClubDoc[] = [];
    for (const l of links) {
      const oid = tryToObjectId(String((l as Record<string, unknown>)['clubId']));
      if (oid === null) continue;
      const raw = await this.db.collection(COLLECTIONS.clubs).findOne({ _id: oid });
      if (raw !== null) out.push(withDomainId<ClubDoc>(raw as Record<string, unknown>));
    }
    return out;
  }
}
