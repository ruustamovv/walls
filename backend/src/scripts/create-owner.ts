/**
 * Owner bootstrap: creates (or promotes) the OWNER account with an
 * argon2id hash, writes an audit entry, and refuses production without
 * --allow-production. Run: pnpm --filter ./backend owner:create
 *
 * Env: OWNER_EMAIL, OWNER_USERNAME, OWNER_INITIAL_PASSWORD (+ MONGODB_*).
 * The bootstrap password is single-use: rotate it after first login.
 */
import { UserRepository } from '../database/mongodb/repositories/user.repository.js';
import { AuditRepository } from '../database/mongodb/repositories/social.repository.js';
import { getMongoDb, closeMongo } from '../database/mongodb/client.js';
import { ensureIndexes } from '../database/mongodb/indexes.js';
import { hashPassword } from '../modules/auth/hashing.js';

function fail(msg: string): never {
  console.error(`[owner:create] ERROR: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { OWNER_EMAIL, OWNER_USERNAME, OWNER_INITIAL_PASSWORD, NODE_ENV } = process.env;
  const allowProd = process.argv.includes('--allow-production');
  if (NODE_ENV === 'production' && !allowProd) {
    fail('refusing production bootstrap without --allow-production');
  }
  if (OWNER_EMAIL === undefined || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(OWNER_EMAIL)) fail('OWNER_EMAIL missing/invalid');
  if (OWNER_USERNAME === undefined || !/^[a-zA-Z0-9_]{3,24}$/.test(OWNER_USERNAME)) fail('OWNER_USERNAME missing/invalid (3-24 chars)');
  if (OWNER_INITIAL_PASSWORD === undefined || OWNER_INITIAL_PASSWORD.length < 12) fail('OWNER_INITIAL_PASSWORD missing/too short (min 12)');
  if (/PASTE_YOUR/i.test(OWNER_INITIAL_PASSWORD)) fail('OWNER_INITIAL_PASSWORD is still the placeholder');

  const db = await getMongoDb().catch((err: unknown) => fail(`mongo unreachable: ${err instanceof Error ? err.message : err}`));
  await ensureIndexes(db);
  const users = new UserRepository(db);
  const existing = (await users.findByEmail(OWNER_EMAIL).catch(() => null))
    ?? (await users.findByUsername(OWNER_USERNAME).catch(() => null));

  if (existing !== null) {
    await users.updateRole(existing._id, 'OWNER');
    await users.updateStatus(existing._id, 'ACTIVE');
    await new AuditRepository(db).append(existing._id, 'owner.promote', existing._id, { email: OWNER_EMAIL });
    console.log(`[owner:create] promoted ${existing.username} to OWNER (password unchanged — rotate after login)`);
  } else {
    const created = await users.create({
      email: OWNER_EMAIL,
      username: OWNER_USERNAME,
      passwordHash: await hashPassword(OWNER_INITIAL_PASSWORD),
      role: 'OWNER',
    });
    await new AuditRepository(db).append(created._id, 'owner.create', created._id, { email: OWNER_EMAIL });
    console.log(`[owner:create] OWNER account created: ${created.username} <${OWNER_EMAIL}>`);
  }
  console.log('[owner:create] single-use password: rotate it after first login.');
  await closeMongo();
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
