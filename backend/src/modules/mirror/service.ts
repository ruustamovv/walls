/**
 * Mirror: a bot that plays like YOU. Fits search weights to your measured
 * tendencies (wall rate, wall efficiency, move quality) from recent games.
 * Your data only — never anyone else's. Thin history yields a clearly
 * labeled default, never a fake precision profile.
 */
import { getMongoDb } from '../../database/mongodb/client.js';
import { GameRepository } from '../../database/mongodb/repositories/game.repository.js';
import { ReplayRepository } from '../../database/mongodb/repositories/replay.repository.js';
import type { EvalWeights } from '../../../../engine/typescript/dist/bots/index.js';

export interface MirrorFeatures {
  games: number;
  moves: number;
  wallRate: number; // walls / total own moves, 0..1
  avgGain: number; // mean opp-path gain per own wall
  efficiency: number; // share of own moves graded GOOD or better, 0..1
}

export interface MirrorProfile extends MirrorFeatures {
  explanation: string;
  weights: EvalWeights;
  wallCandidates: number;
  noise: number;
  wallBias: number;
  replySearch: boolean;
  budgetMs: number;
}

export const MIRROR_DEFAULT: MirrorProfile = {
  games: 0,
  moves: 0,
  wallRate: 0.25,
  avgGain: 1,
  efficiency: 0.5,
  explanation: 'Too little history to mirror — your Mirror plays balanced fundamentals until it has seen at least a few of your games.',
  weights: { pathAdvantage: 12, wallAdvantage: 0.7, mobility: 0.7 },
  wallCandidates: 32,
  noise: 2,
  wallBias: 1,
  replySearch: false,
  budgetMs: 300,
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Pure mapping: measured tendencies -> search personality. Tested directly. */
export function fitMirrorBot(f: MirrorFeatures): MirrorProfile {
  if (f.games === 0 || f.moves < 10) return { ...MIRROR_DEFAULT };
  const wallBias = clamp(0.5 + f.wallRate * 2.2, 0.5, 1.6);
  const wallAdvantage = clamp(0.2 + f.avgGain * 0.35, 0.2, 1.8);
  const noise = clamp(6 - f.efficiency * 6, 0.3, 6);
  const replySearch = f.efficiency > 0.55;
  return {
    ...f,
    explanation:
      `You wall about ${Math.round(f.wallRate * 100)}% of your turns for +${f.avgGain.toFixed(1)} enemy steps on average, ` +
      `with ${Math.round(f.efficiency * 100)}% sound moves. Your Mirror copies exactly that recipe — beat yourself.`,
    weights: { pathAdvantage: 12, wallAdvantage: Math.round(wallAdvantage * 100) / 100, mobility: 0.7 },
    wallCandidates: 32,
    noise: Math.round(noise * 100) / 100,
    wallBias: Math.round(wallBias * 100) / 100,
    replySearch,
    budgetMs: 300,
  };
}

export async function mirrorFor(userId: string): Promise<MirrorProfile> {
  let moves = 0;
  let walls = 0;
  let gainSum = 0;
  let good = 0;
  let games = 0;
  try {
    const db = await getMongoDb();
    const gamesRepo = new GameRepository(db);
    const replays = new ReplayRepository(db);
    const docs = await gamesRepo.listByUser(userId, 8);
    const rev = await import('../../../../engine/typescript/dist/review/index.js');
    for (const g of docs) {
      if (g.status !== 'FINISHED') continue;
      const replay = await replays.findByGame(g.engineId ?? g._id).catch(() => null);
      if (replay === null || replay.actions.length === 0) continue;
      const seat = g.players.find((p) => p.userId === userId)?.seat ?? 0;
      if (seat !== 0 && seat !== 1) continue;
      const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
      const review = rev.reviewGame(
        { size: initial.size ?? 9, wallsPerPlayer: initial.wallsPerPlayer ?? 10 },
        replay.actions as { type: 'move'; to: { r: number; c: number } }[] | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }[],
        21,
        { wallCandidates: 8, budgetMs: 15 },
      );
      games++;
      for (const m of review.moves) {
        if (m.by !== seat) continue;
        moves++;
        if (m.action.type === 'wall') {
          walls++;
          gainSum += m.oppAfter - m.oppBefore;
        }
        if (m.class === 'BRILLIANT' || m.class === 'GREAT' || m.class === 'BEST' || m.class === 'EXCELLENT' || m.class === 'GOOD') {
          good++;
        }
      }
    }
  } catch {
    // thin/offline history degrades to the labeled default
  }
  if (games === 0 || moves < 10) return { ...MIRROR_DEFAULT };
  const wallMoves = moves === 0 ? 0 : walls / moves;
  return fitMirrorBot({
    games,
    moves,
    wallRate: wallMoves,
    avgGain: walls === 0 ? 0 : gainSum / walls,
    efficiency: moves === 0 ? 0 : good / moves,
  });
}
