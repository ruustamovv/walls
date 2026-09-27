/**
 * Entitlements: the ONLY source of truth for premium privileges.
 * Granted by admins/promos today; payment webhooks verify server-side and
 * write here when a provider is configured (none yet — see payments note).
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';

export const ENTITLEMENTS = [
  'AI_REVIEW_ADVANCED',
  'AI_COACH_UNLIMITED',
  'ADVANCED_STATS',
  'PREMIUM_COSMETICS',
  'REPLAY_ANALYTICS',
] as const;

export type Entitlement = (typeof ENTITLEMENTS)[number];

export function isEntitlement(value: string): value is Entitlement {
  return (ENTITLEMENTS as readonly string[]).includes(value);
}

export class EntitlementRepository {
  constructor(private readonly db: Db) {}

  async list(userId: string): Promise<Entitlement[]> {
    try {
      const rows = await this.db.collection(COLLECTIONS.entitlements).find({ userId }).toArray();
      return rows
        .map((r) => String((r as Record<string, unknown>)['entitlement']))
        .filter(isEntitlement);
    } catch {
      return [];
    }
  }

  async has(userId: string, entitlement: Entitlement): Promise<boolean> {
    try {
      const row = await this.db.collection(COLLECTIONS.entitlements).findOne({ userId, entitlement });
      return row !== null;
    } catch {
      return false;
    }
  }

  async grant(userId: string, entitlement: Entitlement, source: string): Promise<void> {
    await this.db.collection(COLLECTIONS.entitlements).updateOne(
      { userId, entitlement },
      { $setOnInsert: { userId, entitlement, source, grantedAt: new Date() } },
      { upsert: true },
    );
  }

  async revoke(userId: string, entitlement: Entitlement): Promise<void> {
    await this.db.collection(COLLECTIONS.entitlements).deleteOne({ userId, entitlement }).catch(() => undefined);
  }
}
