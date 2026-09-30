/**
 * Nemesis: a counter-strategy bot built from YOUR mistake profile.
 * Tallies WALL_BLUNDER / PATH_BLUNDER / TEMPO_LOSS / MISSED_CHOKE across
 * recent reviews, then tunes search weights to punish the dominant flaw.
 * Never impersonates the user and never touches anyone else's data.
 */
import { getMongoDb } from '../../database/mongodb/client.js';
import { GameRepository } from '../../database/mongodb/repositories/game.repository.js';
import { ReplayRepository } from '../../database/mongodb/repositories/replay.repository.js';
import type { EvalWeights } from '../../../../engine/typescript/dist/bots/index.js';

export interface NemesisProfile {
  games: number;
  flaws: { wallWaste: number; pathErrors: number; passive: number; missedChokes: number };
  explanation: string;
  weights: EvalWeights;
  wallCandidates: number;
  noise: number;
  wallBias: number;
  replySearch: boolean;
  budgetMs: number;
  baseName: string;
}

const BASE: EvalWeights = { pathAdvantage: 12, wallAdvantage: 0.7, mobility: 0.7 };

export async function nemesisFor(userId: string): Promise<NemesisProfile> {
  const flaws = { wallWaste: 0, pathErrors: 0, passive: 0, missedChokes: 0 };
  let games = 0;
  try {
    const db = await getMongoDb();
    const gamesRepo = new GameRepository(db);
    const replays = new ReplayRepository(db);
    const docs = await gamesRepo.listByUser(userId, 6);
    const rev = await import('../../../../engine/typescript/dist/review/index.js');
    for (const g of docs) {
      if (g.status !== 'FINISHED') continue;
      const replay = await replays.findByGame(g.engineId ?? g._id).catch(() => null);
      if (replay === null || replay.actions.length === 0) continue;
      const seat = g.players.find((p) => p.userId === userId)?.seat ?? 0;
      const initial = replay.initialState as { size?: number; wallsPerPlayer?: number };
      const review = rev.reviewGame(
        { size: initial.size ?? 9, wallsPerPlayer: initial.wallsPerPlayer ?? 10 },
        replay.actions as { type: 'move'; to: { r: number; c: number } }[] | { type: 'wall'; wall: { r: number; c: number; orientation: 'h' | 'v' } }[],
        11,
        { wallCandidates: 8, budgetMs: 15 },
      );
      games++;
      for (const m of review.moves) {
        if (m.by !== seat) continue;
        if (m.labels.includes('WALL_BLUNDER')) flaws.wallWaste++;
        if (m.labels.includes('PATH_BLUNDER')) flaws.pathErrors++;
        if (m.labels.includes('TEMPO_LOSS')) flaws.passive++;
        if (m.labels.includes('MISSED_CHOKE')) flaws.missedChokes++;
      }
    }
  } catch {
    // thin history degrades to the default counter
  }

  const entries: [keyof typeof flaws, number][] = [
    ['wallWaste', flaws.wallWaste],
    ['pathErrors', flaws.pathErrors],
    ['passive', flaws.passive],
    ['missedChokes', flaws.missedChokes],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0] as [keyof typeof flaws, number];

  let weights: EvalWeights = { ...BASE };
  let wallBias = 1.1;
  let baseName = 'Calculator';
  let explanation: string;
  if (top[1] === 0) {
    explanation = 'Too little history to profile — your Nemesis plays balanced, sharp chess-style walls until it learns your habits.';
  } else if (top[0] === 'wallWaste') {
    weights = { pathAdvantage: 11, wallAdvantage: 1.6, mobility: 0.5 };
    wallBias = 0.8;
    baseName = 'Fortress';
    explanation = `You waste walls (${flaws.wallWaste} flagged). Your Nemesis conserves its stock, outlasts your spending, then punishes the thin endgame.`;
  } else if (top[0] === 'pathErrors') {
    weights = { pathAdvantage: 16, wallAdvantage: 0.3, mobility: 0.4 };
    wallBias = 1.4;
    baseName = 'Assassin';
    explanation = `Your routes leak steps (${flaws.pathErrors} flagged). Your Nemesis aims every wall at your shortest path.`;
  } else if (top[0] === 'missedChokes') {
    weights = { pathAdvantage: 13, wallAdvantage: 0.9, mobility: 0.9 };
    wallBias = 1.7;
    baseName = 'Architect';
    explanation = `You miss chokes (${flaws.missedChokes} flagged). Your Nemesis never does — it builds the maze you walked past.`;
  } else {
    weights = { pathAdvantage: 12, wallAdvantage: 1.1, mobility: 0.8 };
    wallBias = 1.2;
    baseName = 'Endgame';
    explanation = `You drift in quiet positions (${flaws.passive} flagged). Your Nemesis stays patient and strikes when the finish line is close.`;
  }

  return {
    games,
    flaws,
    explanation,
    weights,
    wallCandidates: 48,
    noise: 0.5,
    wallBias,
    replySearch: true,
    budgetMs: 400,
    baseName,
  };
}
