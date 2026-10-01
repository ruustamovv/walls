/**
 * Conduct recording hooks (best-effort, never break the game path).
 * Mongo-backed when reachable; otherwise the score simply stays at its
 * default until the database is back (reads default to 100).
 */
import { getMongoDb } from '../../database/mongodb/client.js';
import { FairPlayRepository } from '../../database/mongodb/repositories/fairplay.repository.js';
import type { ReportDoc } from '../../database/mongodb/repositories/social.repository.js';

/** resign/goal/draw for everyone; timeout flags the side to move. */
export async function recordGameConduct(
  userIds: (string | null)[],
  turnAtFinish: number,
  reason: string | null,
): Promise<void> {
  let db;
  try {
    db = await getMongoDb();
  } catch {
    return;
  }
  const repo = new FairPlayRepository(db);
  for (let seat = 0; seat < userIds.length; seat++) {
    const uid = userIds[seat];
    if (uid === null || uid === undefined) continue;
    const event = reason === 'timeout' && seat === turnAtFinish ? 'abandon' : 'completed';
    await repo.record(uid, event).catch(() => undefined);
  }
}

/** Staff verdicts move conduct: RESOLVED user-reports hit the target,
 *  DISMISSED ones nick the reporter (report-spam deterrent). */
export async function applyReportOutcome(
  report: Pick<ReportDoc, 'targetType' | 'targetId' | 'reporterId'>,
  status: 'RESOLVED' | 'DISMISSED',
): Promise<void> {
  let db;
  try {
    db = await getMongoDb();
  } catch {
    return;
  }
  const repo = new FairPlayRepository(db);
  if (status === 'RESOLVED' && report.targetType === 'user') {
    await repo.record(report.targetId, 'verified_abuse').catch(() => undefined);
  } else if (status === 'DISMISSED') {
    await repo.record(report.reporterId, 'false_report').catch(() => undefined);
  }
}

/** Read a score for matchmaking/profile display (100 when unknown). */
export async function conductScoreOf(userId: string): Promise<number> {
  try {
    const db = await getMongoDb();
    return (await new FairPlayRepository(db).get(userId)).score;
  } catch {
    return 100;
  }
}
