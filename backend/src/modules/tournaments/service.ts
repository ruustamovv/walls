/**
 * Tournament lifecycle: draft → open → live → finished across three
 * formats. Matches reference live game ids optionally; results can also be
 * reported directly (club nights, OTB). Standings derive from recorded
 * rounds — single source of truth, no parallel bookkeeping.
 */
import { getMongoDb } from '../../database/mongodb/client.js';
import { TournamentRepository } from '../../database/mongodb/repositories/extended.repositories.js';
import { RatingRepository } from '../../database/mongodb/repositories/rating.repository.js';
import { defaultRating } from '../ratings/glicko2.js';
import { advanceSingleElim, pairSingleElim, pairSwiss, pastPairKey, roundRobinSchedule } from './pairing.js';
import type { TournamentDoc } from '../../database/mongodb/types.js';

export interface StandingRow {
  userId: string;
  wins: number;
  losses: number;
  points: number;
}

async function repo(): Promise<TournamentRepository> {
  const db = await getMongoDb();
  return new TournamentRepository(db);
}

/** Seed order: rating desc (best-effort), then join order. */
async function seedOrder(userIds: string[]): Promise<string[]> {
  try {
    const db = await getMongoDb();
    const ratings = new RatingRepository(db);
    const scored = await Promise.all(userIds.map(async (id) => ({
      id, rating: (await ratings.get(id, 'blitz').catch(() => null))?.rating ?? defaultRating().rating,
    })));
    return scored.sort((a, b) => b.rating - a.rating).map((s) => s.id);
  } catch {
    return [...userIds];
  }
}

export async function createTournament(ownerId: string, input: {
  title: string; format?: TournamentDoc['format']; timeControl?: string; mode?: string; rounds?: number; playersCap?: number;
  durationMinutes?: number; recurrence?: 'none' | 'daily' | 'weekly';
}): Promise<TournamentDoc> {
  const title = input.title.trim().slice(0, 80);
  if (title.length < 3) throw new Error('title too short');
  if (input.format !== undefined && !['single-elim', 'round-robin', 'swiss', 'arena'].includes(input.format)) {
    throw new Error('unknown format');
  }
  if (input.recurrence !== undefined && !['none', 'daily', 'weekly'].includes(input.recurrence)) {
    throw new Error('unknown recurrence');
  }
  const doc = await (await repo()).create({
    title,
    format: input.format ?? 'single-elim',
    timeControl: input.timeControl ?? '3+1',
    mode: input.mode ?? 'ranked',
    rounds: input.rounds,
    playersCap: input.playersCap,
    ownerId,
    ...(input.durationMinutes !== undefined && input.durationMinutes > 0
      ? { endAt: new Date(Date.now() + Math.min(input.durationMinutes, 24 * 60) * 60000) }
      : {}),
    ...(input.recurrence !== undefined && input.recurrence !== 'none' ? { recurrence: input.recurrence } : {}),
  });
  await (await repo()).addPlayer(doc._id, ownerId);
  return doc;
}

export async function joinTournament(tournamentId: string, userId: string): Promise<void> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) throw new Error('tournament not found');
  if (t.status !== 'DRAFT' && t.status !== 'OPEN') throw new Error('entries are closed');
  if ((await r.countPlayers(tournamentId)) >= (t.playersCap ?? 16)) throw new Error('tournament is full');
  await r.addPlayer(tournamentId, userId);
}

export async function openTournament(tournamentId: string): Promise<void> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) throw new Error('tournament not found');
  if (t.status !== 'DRAFT') throw new Error('already opened');
  await r.setStatus(tournamentId, 'OPEN');
}

export async function startTournament(tournamentId: string): Promise<void> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) throw new Error('tournament not found');
  if (t.status !== 'OPEN' && t.status !== 'DRAFT') throw new Error('already started');
  const players = (await r.listPlayers(tournamentId)).map((p) => p.userId);
  if (players.length < 2) throw new Error('need at least 2 players');
  const seeded = await seedOrder(players);
  const format = t.format ?? 'single-elim';
  if (format === 'arena') {
    // Arenas pair on demand while live; nothing to seed up front.
    await r.setStatus(tournamentId, 'LIVE');
    return;
  }
  if (format === 'single-elim') {
    const pairs = pairSingleElim(seeded);
    await r.saveRound(tournamentId, 1, pairs.map(([a, b]) => ({
      a, b, winner: b === null ? a : null, // byes auto-advance
    })));
  } else if (format === 'round-robin') {
    const schedule = roundRobinSchedule(seeded);
    for (let i = 0; i < schedule.length; i++) {
      const round = schedule[i];
      if (round === undefined) continue;
      await r.saveRound(tournamentId, i + 1, round.map(([a, b]) => ({ a, b, winner: b === null ? a : null })));
    }
  } else {
    const { pairs, bye } = pairSwiss(seeded.map((userId) => ({ userId, points: 0 })), new Set());
    await r.saveRound(tournamentId, 1, [
      ...pairs.map(([a, b]) => ({ a, b, winner: null as string | null })),
      ...(bye !== null ? [{ a: bye, b: null as string | null, winner: bye }] : []),
    ]);
  }
  await r.setStatus(tournamentId, 'LIVE');
}

export async function reportResult(tournamentId: string, round: number, matchIndex: number, winnerId: string, reporterId: string): Promise<void> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) throw new Error('tournament not found');
  if (t.status !== 'LIVE') throw new Error('tournament is not live');
  const rounds = await r.listRounds(tournamentId);
  const current = rounds.find((x) => x.round === round);
  if (current === undefined) throw new Error('round not found');
  const match = current.matches[matchIndex];
  if (match === undefined || match.b !== null && match.winner !== null) throw new Error('match already decided');
  if (match.a === null && match.b === null) throw new Error('empty match');
  const isPlayer = winnerId === match.a || winnerId === match.b;
  if (!isPlayer) throw new Error('winner is not in this match');
  const players = (await r.listPlayers(tournamentId)).map((p) => p.userId);
  const isOwner = t.ownerId === reporterId;
  if (!isOwner && !players.includes(reporterId)) throw new Error('not part of this tournament');
  match.winner = winnerId;
  await r.saveRound(tournamentId, round, current.matches);
  await advanceIfComplete(tournamentId);
}

async function advanceIfComplete(tournamentId: string): Promise<void> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null || t.status !== 'LIVE') return;
  const rounds = await r.listRounds(tournamentId);
  const format = t.format ?? 'single-elim';
  const latest = rounds[rounds.length - 1];
  if (latest === undefined || latest.matches.some((m) => m.b !== null && m.winner === null)) return;

  if (format === 'single-elim') {
    const winners = advanceSingleElim(latest.matches.map((m) => ({ winner: m.winner })));
    if (winners.length <= 1) {
      await r.setChampion(tournamentId, winners[0] ?? null);
      return;
    }
    const pairs = pairSingleElim(winners);
    await r.saveRound(tournamentId, latest.round + 1, pairs.map(([a, b]) => ({ a, b, winner: b === null ? a : null })));
    return;
  }

  if (format === 'round-robin') {
    // All rounds pre-generated: finished when every match has a winner.
    const pending = rounds.some((rd) => rd.matches.some((m) => m.b !== null && m.winner === null));
    if (!pending) {
      const table = await standings(tournamentId);
      await r.setChampion(tournamentId, table[0]?.userId ?? null);
    }
    return;
  }

  if (format === 'arena') {
    // Arenas never auto-advance: points accumulate until the owner (or the
    // deadline) calls finishTournament.
    return;
  }

  // Swiss: next round by points, or champion after `rounds` rounds.
  const table = await standings(tournamentId);
  if (latest.round >= (t.rounds || 4)) {
    await r.setChampion(tournamentId, table[0]?.userId ?? null);
    return;
  }
  const past = new Set<string>();
  for (const rd of rounds) {
    for (const m of rd.matches) {
      if (m.a !== null && m.b !== null) past.add(pastPairKey(m.a, m.b));
    }
  }
  const { pairs, bye } = pairSwiss(table.map((s) => ({ userId: s.userId, points: s.points })), past);
  await r.saveRound(tournamentId, latest.round + 1, [
    ...pairs.map(([a, b]) => ({ a, b, winner: null as string | null })),
    ...(bye !== null ? [{ a: bye, b: null as string | null, winner: bye }] : []),
  ]);
}

export async function standings(tournamentId: string): Promise<StandingRow[]> {
  const r = await repo();
  const players = (await r.listPlayers(tournamentId)).map((p) => p.userId);
  const rounds = await r.listRounds(tournamentId);
  const table = new Map<string, StandingRow>();
  for (const p of players) table.set(p, { userId: p, wins: 0, losses: 0, points: 0 });
  for (const rd of rounds) {
    for (const m of rd.matches) {
      if (m.winner === null) continue;
      if (m.b === null) {
        // Bye: counts as a point, not a win (keeps tiebreaks honest).
        const row = table.get(m.winner);
        if (row !== undefined) row.points += 1;
        continue;
      }
      const w = table.get(m.winner);
      if (w !== undefined) {
        w.wins += 1;
        w.points += 1;
      }
      const loser = m.a === m.winner ? m.b : m.a;
      if (loser !== null) {
        const l = table.get(loser);
        if (l !== undefined) l.losses += 1;
      }
    }
  }
  return [...table.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || (a.userId < b.userId ? -1 : 1));
}

/**
 * Arena pairing pool (in-process; Redis-backed matchmaking stays the
 * production path for rated play). Waiting players pair instantly into a
 * live game whose result is reportable in the current arena round.
 */
const arenaPools = new Map<string, string[]>();

export async function arenaPlay(tournamentId: string, userId: string): Promise<{ status: 'waiting' } | { status: 'matched'; gameId: string }> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) throw new Error('tournament not found');
  if ((t.format ?? 'single-elim') !== 'arena') throw new Error('not an arena tournament');
  if (t.status !== 'LIVE') throw new Error('arena is not live');
  if (t.endAt !== undefined && t.endAt.getTime() <= Date.now()) throw new Error('arena has ended');
  const players = (await r.listPlayers(tournamentId)).map((p) => p.userId);
  if (!players.includes(userId)) throw new Error('join the arena first');
  const pool = arenaPools.get(tournamentId) ?? [];
  const waiting = pool.filter((id) => id !== userId);
  if (waiting.length === 0) {
    arenaPools.set(tournamentId, [...pool.filter((id) => id !== userId), userId]);
    return { status: 'waiting' };
  }
  const opponent = waiting[0] as string;
  arenaPools.set(tournamentId, pool.filter((id) => id !== userId && id !== opponent));
  const { gamesService } = await import('../games/service.js');
  const { persistGameCreated } = await import('../games/persistence.js');
  const { ratingModeFor } = await import('../games/finish.js');
  const g = gamesService.create({
    creatorId: opponent,
    opponentId: userId,
    timeControl: t.timeControl,
    mode: 'arena',
    boardSize: 9,
    wallsPerPlayer: 10,
  });
  await persistGameCreated(g, ratingModeFor(g.timeControlId)).catch(() => undefined);
  // File the pairing into the running arena round (created on demand).
  const rounds = await r.listRounds(tournamentId);
  const open = rounds.length;
  await r.saveRound(tournamentId, open + 1, [{ a: opponent, b: userId, winner: null, gameId: g.id }]);
  return { status: 'matched', gameId: g.id };
}

export async function finishTournament(tournamentId: string, userId: string): Promise<void> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) throw new Error('tournament not found');
  if (t.ownerId !== userId) throw new Error('only the organizer can finish');
  if (t.status !== 'LIVE') throw new Error('tournament is not live');
  const table = await standings(tournamentId);
  await r.setChampion(tournamentId, table[0]?.userId ?? null);
  // Recurring series: schedule the next edition from now.
  const finished = await r.findById(tournamentId);
  if (finished !== null && (finished.recurrence === 'daily' || finished.recurrence === 'weekly')) {
    const period = finished.recurrence === 'daily' ? 86_400_000 : 7 * 86_400_000;
    await r.scheduleNext(tournamentId, new Date(Date.now() + period));
  }
  arenaPools.delete(tournamentId);
}

/**
 * Recurrence sweep (TRN-007): spawn the next edition of every finished
 * recurring tournament whose time has come. Called hourly by the server;
 * safe to run concurrently (edition title check keeps it idempotent-ish,
 * duplicates collapse on the next sweep via nextRunAt advance-first).
 */
export async function sweepRecurrence(now: number = Date.now()): Promise<string[]> {
  const r = await repo();
  const spawned: string[] = [];
  const due = await r.dueRecurrence(new Date(now));
  for (const t of due) {
    const period = t.recurrence === 'weekly' ? 7 * 86_400_000 : 86_400_000;
    // Advance FIRST so a crash cannot respawn endlessly.
    await r.scheduleNext(t._id, new Date(now + period));
    const edition = (t.edition ?? 1) + 1;
    const base = t.title.replace(/\s+#\d+$/, '');
    const next = await r.create({
      title: `${base} #${edition}`,
      mode: t.mode,
      timeControl: t.timeControl,
      format: t.format,
      rounds: t.rounds,
      playersCap: t.playersCap,
      ownerId: t.ownerId,
      recurrence: t.recurrence,
      edition,
    });
    spawned.push(next._id);
  }
  return spawned;
}

export async function tournamentDetail(tournamentId: string): Promise<{
  tournament: TournamentDoc;
  players: string[];
  rounds: { round: number; matches: { a: string | null; b: string | null; winner: string | null; gameId?: string }[] }[];
  standings: StandingRow[];
} | null> {
  const r = await repo();
  const t = await r.findById(tournamentId);
  if (t === null) return null;
  const players = (await r.listPlayers(tournamentId)).map((p) => p.userId);
  return {
    tournament: t,
    players,
    rounds: await r.listRounds(tournamentId),
    standings: t.status === 'LIVE' || t.status === 'FINISHED' ? await standings(tournamentId) : [],
  };
}
