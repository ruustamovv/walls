/**
 * Email verification: single-use SHA-256-hashed tokens (24h). Mirrors
 * passwordReset's token discipline. Without SMTP the link is dev-logged
 * (never in production); the endpoint still validates real tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import { getMongoDb } from '../../database/mongodb/client.js';
import { COLLECTIONS } from '../../database/mongodb/collections.js';
import { UserRepository } from '../../database/mongodb/repositories/user.repository.js';
import { sendMail } from '../mail/mailer.js';
import { logger } from '../../common/logging/logger.js';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function requestVerification(userId: string): Promise<{ mailed: boolean }> {
  const db = await getMongoDb();
  const users = new UserRepository(db);
  const user = await users.findById(userId).catch(() => null);
  if (user === null) return { mailed: false };
  const token = randomBytes(32).toString('hex');
  await db.collection(COLLECTIONS.email_verifications).insertOne({
    tokenHash: hashToken(token),
    userId: user._id,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    createdAt: new Date(),
  });
  const base = (process.env['FRONTEND_URL'] ?? 'http://localhost:5173').replace(/\/$/, '');
  const sent = await sendMail({
    to: user.email,
    subject: 'Verify your email',
    text: `Confirm your address (valid 24 hours): ${base}/verify-email?token=${token}\nIf you did not ask, ignore this mail.`,
  });
  logger.info({ userId, delivered: sent.delivered }, 'verification link issued');
  return { mailed: sent.delivered || sent.devLogged };
}

export async function confirmVerification(token: string): Promise<boolean> {
  try {
    const db = await getMongoDb();
    const col = db.collection(COLLECTIONS.email_verifications);
    const row = (await col.findOne({ tokenHash: hashToken(token) })) as unknown as {
      userId: string;
      expiresAt: Date;
    } | null;
    if (row === null) return false;
    if (row.expiresAt.getTime() <= Date.now()) {
      await col.deleteOne({ tokenHash: hashToken(token) }).catch(() => undefined);
      return false;
    }
    const ok = await new UserRepository(db).setEmailVerified(row.userId, true);
    if (!ok) return false;
    await col.deleteMany({ userId: row.userId }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
