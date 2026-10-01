/**
 * CosmeticsRepository — equipped frame per user (inventories collection).
 * Free frames need no rows; premium frames need the PREMIUM_COSMETICS
 * entitlement (checked by callers, not here).
 */
import type { Db } from 'mongodb';
import { COLLECTIONS } from '../collections.js';
import { COSMETICS, cosmeticById } from '../../../modules/cosmetics/catalog.js';

const SLOT = 'frame';
const DEFAULT_FRAME = 'frame-none';

export class CosmeticsRepository {
  constructor(private readonly db: Db) {}

  async equippedFrame(userId: string): Promise<string> {
    try {
      const row = await this.db.collection(COLLECTIONS.inventories).findOne({ userId, slot: SLOT });
      const id = typeof row?.['cosmeticId'] === 'string' ? (row['cosmeticId'] as string) : DEFAULT_FRAME;
      return cosmeticById(id) !== null ? id : DEFAULT_FRAME;
    } catch {
      return DEFAULT_FRAME;
    }
  }

  /** Equip an owned frame. Returns false when unknown. */
  async equipFrame(userId: string, cosmeticId: string): Promise<boolean> {
    if (cosmeticById(cosmeticId) === null) return false;
    await this.db.collection(COLLECTIONS.inventories).updateOne(
      { userId, slot: SLOT },
      { $set: { userId, slot: SLOT, cosmeticId, updatedAt: new Date() } },
      { upsert: true },
    );
    return true;
  }

  /** Catalog annotated for a viewer (ownership resolved by caller). */
  catalogWith(hasPremium: boolean): { id: string; kind: string; name: string; ring: string; premium: boolean; owned: boolean }[] {
    return COSMETICS.map((c) => ({ ...c, owned: !c.premium || hasPremium }));
  }
}
