/**
 * Admin RBAC: moderator (read + suspend), admin (full operational control).
 * DB OWNER rows map to 'admin' at the auth boundary; ownership transfer is
 * intentionally not exposed over HTTP.
 */
import type { FastifyRequest } from 'fastify';
import { AuthError, ForbiddenError } from '../../common/errors/errors.js';
import { getAuthService, type UserRecord } from '../auth/service.js';

export type AdminRole = 'moderator' | 'admin';

function rank(role: UserRecord['role']): number {
  if (role === 'admin' || role === 'owner') return 2;
  if (role === 'moderator') return 1;
  return 0;
}

async function currentUser(req: FastifyRequest): Promise<UserRecord> {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies ?? {};
  const sid = cookies['nexus_session'];
  if (typeof sid !== 'string' || sid.length === 0) throw new AuthError('Missing session');
  const h = req.headers['authorization'];
  const id = sid.length > 0 ? sid : (typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : null);
  if (id === null) throw new AuthError('Missing session');
  const me = await (await getAuthService()).me(id);
  if (me === null) throw new AuthError('Invalid session');
  return me;
}

/**
 * Require at least `minimum` admin power; banned/suspended users rejected.
 * Role and status refresh from Mongo on every check, so promotions and
 * restrictions take effect immediately without forcing re-login.
 */
export async function requireRole(req: FastifyRequest, minimum: AdminRole): Promise<UserRecord> {
  const me = await currentUser(req);
  let effective: UserRecord = me;
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const { UserRepository } = await import('../../database/mongodb/repositories/user.repository.js');
    const db = await getMongoDb();
    if (/^[0-9a-fA-F]{24}$/.test(me.id)) {
      const doc = await new UserRepository(db).findById(me.id).catch(() => null);
      if (doc !== null) {
        if (doc.status === 'BANNED' || doc.status === 'SUSPENDED') {
          throw new ForbiddenError('Account restricted');
        }
        effective = {
          ...me,
          role: doc.role === 'OWNER' || doc.role === 'ADMIN' ? 'admin' : doc.role === 'MODERATOR' ? 'moderator' : 'user',
        };
      }
    }
  } catch (err) {
    if (err instanceof ForbiddenError) throw err;
    // Offline dev: role from the session stands.
  }
  if (rank(effective.role) < rank(minimum)) throw new ForbiddenError('Admin access required');
  return effective;
}

export async function audit(actorId: string, action: string, target?: string, meta?: Record<string, unknown>): Promise<void> {
  try {
    const { getMongoDb } = await import('../../database/mongodb/client.js');
    const { AuditRepository } = await import('../../database/mongodb/repositories/social.repository.js');
    const db = await getMongoDb();
    await new AuditRepository(db).append(actorId, action, target, meta);
  } catch {
    // audit must never break the operation it records
  }
}
