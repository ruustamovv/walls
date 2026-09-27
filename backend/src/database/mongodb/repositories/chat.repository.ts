/**
 * Club/channel chat persistence. Best-effort writes — the socket broadcast
 * is the live path; history replays on join.
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { withDomainId } from '../ids.js';

export interface ChatMessageDoc {
  _id: string;
  channelId: string;
  userId: string;
  body: string;
  createdAt: Date;
}

export class ChatRepository {
  constructor(private readonly db: Db) {}

  async post(channelId: string, userId: string, body: string): Promise<ChatMessageDoc> {
    const clean = body.trim().slice(0, 500);
    if (clean.length === 0) throw new Error('empty message');
    const res = await this.db.collection(COLLECTIONS.chat_messages).insertOne({
      channelId, userId, body: clean, createdAt: new Date(),
    });
    const raw = await this.db.collection(COLLECTIONS.chat_messages).findOne({ _id: res.insertedId });
    if (raw === null) throw new Error('chat insert failed');
    return withDomainId<ChatMessageDoc>(raw as Record<string, unknown>);
  }

  async history(channelId: string, limit = 30): Promise<ChatMessageDoc[]> {
    const rows = await this.db.collection(COLLECTIONS.chat_messages)
      .find({ channelId }).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).toArray();
    return rows.reverse().map((r) => withDomainId<ChatMessageDoc>(r as Record<string, unknown>));
  }
}
