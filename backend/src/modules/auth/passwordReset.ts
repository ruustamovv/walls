/**
 * Password reset: single-use SHA-256-hashed tokens (60 min), generic
 * responses (no account enumeration), sessions revoked on success.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getMongoDb } from '../../database/mongodb/client.js';
import { COLLECTIONS } from '../../database/mongodb/collections.js';
import { UserRepository } from '../../database/mongodb/repositories/user.repository.js';
import { hashPassword } from './hashing.js';
import { sendMail } from '../mail/mailer.js';
import { logger } from '../../common/logging/logger.js';

const TOKEN_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function collection() {
  const db = await getMongoDb();
  return db.collection(COLLECTIONS.password_resets);
}

export async function requestReset(email: string): Promise<void> {
  const address = email.trim().toLowerCase();
  try {
    const db = await getMongoDb();
    const users = new UserRepository(db);
    const user = await users.findByEmail(address).catch(() => null);
    if (user === null) return; // generic: no enumeration
    const token = randomBytes(32).toString('hex');
    await (await collection()).insertOne({
      tokenHash: hashToken(token),
      userId: user._id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      createdAt: new Date(),
    });
    const base = (process.env['FRONTEND_URL'] ?? 'http://localhost:5173').replace(/\/$/, '');
    await sendMail({
      to: user.email,
      subject: 'Reset your NEXUS password',
      text: `Reset link (valid 60 minutes): ${base}/reset-password?token=${token}\nIf you did not ask, ignore this mail.`,
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'password reset request failed');
  }
}

export async function confirmReset(token: string, password: string, revokeSessions: (userId: string) => Promise<unknown>): Promise<boolean> {
  try {
    const col = await collection();
    const row = (await col.findOne({ tokenHash: hashToken(token) })) as unknown as {
      userId: string;
      expiresAt: Date;
    } | null;
    if (row === null) return false;
    if (row.expiresAt.getTime() <= Date.now()) {
      await col.deleteOne({ tokenHash: hashToken(token) }).catch(() => undefined);
      return false;
    }
    const db = await getMongoDb();
    const ok = await new UserRepository(db).updatePassword(row.userId, await hashPassword(password));
    if (!ok) return false;
    await col.deleteMany({ userId: row.userId }).catch(() => undefined);
    await revokeSessions(row.userId).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
