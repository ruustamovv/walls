/**
 * Bot-vs-bot calibration round-robin.
 *
 * Plays every pairing (seat-swapped) on 9x9 and reports win rate, average
 * game length and wall usage per bot. Use the table to anchor the internal
 * difficulty ratings in bots/personalities.ts — never present them as
 * proven human skill ratings.
 *
 * Usage:
 *   pnpm calibrate                    # quick smoke: rookie/runner/fortress, 2 games each
 *   pnpm calibrate --games 6          # more games per pairing
 *   pnpm calibrate --bots rookie,runner,fortress,architect,assassin
 *   pnpm calibrate --full             # all 10 bots (slow: grandmaster-class
 *                                     # budgets × long games can take 10+ min)
 */
import fs from 'node:fs';
import { applyMove, createGame } from '../rules/game.js';
import { BOTS, botAction, getBot } from '../bots/personalities.js';
import type { Action } from '../core/types.js';

interface Args {
  games: number;
  bots: string[];
  full: boolean;
  json: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { games: 2, bots: ['rookie', 'runner', 'fortress'], full: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--games') args.games = Math.max(1, Number(argv[i + 1]) || 2);
    if (argv[i] === '--bots') args.bots = String(argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    if (argv[i] === '--full') args.full = true;
    if (argv[i] === '--json') args.json = String(argv[i + 1] ?? '').trim() || null;
  }
  if (args.full) args.bots = BOTS.map((b) => b.id);
  return args;
}

interface Stats {
  wins: number;
  games: number;
  plies: number;
  walls: number;
}

function describeShort(a: Action): string {
  return a.type === 'move' ? `m${a.to.r},${a.to.c}` : `w${a.wall.orientation}${a.wall.r},${a.wall.c}`;
}

function playOne(whiteId: string, blackId: string, seed: number): { winner: 0 | 1 | null; plies: number; wallsBy: [number, number]; line: string } {
  const white = getBot(whiteId);
  const black = getBot(blackId);
  if (white === null || black === null) throw new Error(`unknown bot in pairing ${whiteId}/${blackId}`);
  let state = createGame({ size: 9, wallsPerPlayer: 10 });
  const wallsBy: [number, number] = [0, 0];
  const line: string[] = [];
  let guard = 0;
  while (!state.isOver && guard < 400) {
    const def = state.turn === 0 ? white : black;
    const action: Action = botAction(def, state, seed * 1000 + guard);
    if (line.length < 6) line.push(describeShort(action));
    if (action.type === 'wall') wallsBy[state.turn]++;
    state = applyMove(state, action).state;
    guard++;
  }
  return { winner: state.winner, plies: guard, wallsBy, line: line.join(' ') };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const ids = args.bots.filter((id) => getBot(id) !== null);
  if (ids.length < 2) throw new Error('need at least 2 known bot ids');
  const stats = new Map<string, Stats>();
  for (const id of ids) stats.set(id, { wins: 0, games: 0, plies: 0, walls: 0 });

  // Opening book: first-6-ply lines with outcomes (for the explorer).
  const lines = new Map<string, { games: number; whiteWins: number }>();

  let gameNo = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i] as string;
      const b = ids[j] as string;
      for (let k = 0; k < args.games; k++) {
        // Seat-swap every game for fairness.
        const white = k % 2 === 0 ? a : b;
        const black = k % 2 === 0 ? b : a;
        gameNo++;
        const t0 = Date.now();
        const res = playOne(white, black, gameNo);
        const ms = Date.now() - t0;
        if (res.winner !== null) {
          const winnerId = res.winner === 0 ? white : black;
          stats.get(winnerId)!.wins++;
        }
        stats.get(white)!.games++;
        stats.get(black)!.games++;
        stats.get(white)!.plies += res.plies;
        stats.get(black)!.plies += res.plies;
        stats.get(white)!.walls += res.wallsBy[0];
        stats.get(black)!.walls += res.wallsBy[1];
        const entry = lines.get(res.line) ?? { games: 0, whiteWins: 0 };
        entry.games++;
        if (res.winner === 0) entry.whiteWins++;
        lines.set(res.line, entry);
        console.log(`game ${gameNo}: ${white} (W) vs ${black} (B) -> ${res.winner === null ? 'draw/cap' : `seat${res.winner + 1} wins`} in ${res.plies} plies, ${res.wallsBy[0] + res.wallsBy[1]} walls, ${ms}ms`);
      }
    }
  }

  console.log('\nbot        | win%  | games | avg plies | avg walls');
  console.log('-----------|-------|-------|-----------|----------');
  const rows = [...stats.entries()]
    .map(([id, s]) => ({ id, win: s.games > 0 ? (s.wins / s.games) * 100 : 0, games: s.games, plies: s.games > 0 ? s.plies / s.games : 0, walls: s.games > 0 ? s.walls / s.games : 0 }))
    .sort((x, y) => y.win - x.win);
  for (const r of rows) {
    console.log(`${r.id.padEnd(10)} | ${r.win.toFixed(1).padStart(5)} | ${String(r.games).padStart(5)} | ${r.plies.toFixed(0).padStart(9)} | ${r.walls.toFixed(1).padStart(9)}`);
  }

  if (args.json !== null) {
    const book = {
      generatedAt: new Date().toISOString(),
      board: '9x9',
      games: gameNo,
      bots: rows,
      openings: [...lines.entries()]
        .map(([line, s]) => ({ line, games: s.games, whiteWinPct: Math.round((s.whiteWins / s.games) * 100) }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 40),
    };
    fs.writeFileSync(args.json, JSON.stringify(book, null, 1));
    console.log(`\nopening book written to ${args.json} (${book.openings.length} lines)`);
  }
}

main();
