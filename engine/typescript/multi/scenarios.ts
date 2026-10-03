/**
 * Named party scenarios (SCE-001). Every scenario is a composition of the
 * engine's existing opt-in modifiers — no new rules, no hidden mechanics:
 * the catalog only names, describes and bundles flags the engine already
 * enforces (teamMode, continueAfterWin, fog, chaos, siege).
 *
 * Fog is `onlineOnly`: on a shared local screen every human sees the same
 * board, so fog belongs to online tables where the server projects one
 * snapshot per seat (see multi/fog.ts).
 */
import type { MultiConfig } from './types.js';

export interface ScenarioFlags {
  teamMode?: boolean;
  continueAfterWin?: boolean;
  fog?: boolean;
  chaos?: boolean;
  siege?: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  flags: ScenarioFlags;
  /** Minimum seats. 0 = any (2–6). */
  minPlayers: number;
  /** Exact seat counts allowed (empty = any 2–6). */
  seats: number[];
  /** True when the mode only makes sense online (separate screens). */
  onlineOnly: boolean;
}

function scenario(s: Scenario): Scenario {
  return s;
}

export const SCENARIOS: Scenario[] = [
  scenario({
    id: 'classic', name: 'Classic FFA', blurb: 'Everyone for themselves. First pawn to its edge wins.',
    flags: {}, minPlayers: 2, seats: [], onlineOnly: false,
  }),
  scenario({
    id: 'teams', name: '2v2 Teams', blurb: 'Seats 1+3 vs 2+4. First pawn home wins for its whole team.',
    flags: { teamMode: true }, minPlayers: 4, seats: [2, 4], onlineOnly: false,
  }),
  scenario({
    id: 'placement', name: 'Placement Race', blurb: 'Finishers leave in order — last pawn standing loses. Full placement table.',
    flags: { continueAfterWin: true }, minPlayers: 3, seats: [3, 4, 5, 6], onlineOnly: false,
  }),
  scenario({
    id: 'siege', name: 'Siege', blurb: 'Seat 1 starts ahead with bonus walls. Everyone else storms the castle.',
    flags: { siege: true }, minPlayers: 2, seats: [2], onlineOnly: false,
  }),
  scenario({
    id: 'chaos', name: 'Chaos Draft', blurb: 'Wall budgets rotate between seats — no banking an arsenal.',
    flags: { chaos: true }, minPlayers: 2, seats: [], onlineOnly: false,
  }),
  scenario({
    id: 'fog', name: 'Fog of War', blurb: 'You see only walls near your own pawn. Online only — separate screens required.',
    flags: { fog: true }, minPlayers: 2, seats: [], onlineOnly: true,
  }),
];

export function getScenario(id: string): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/** Merge scenario flags into a multi config (explicit opts win). */
export function configForScenario(base: MultiConfig, scenarioId: string | null): MultiConfig {
  if (scenarioId === null) return base;
  const s = getScenario(scenarioId);
  if (s === null) return base;
  return {
    ...base,
    ...(s.flags.teamMode !== undefined ? { teamMode: s.flags.teamMode } : {}),
    ...(s.flags.continueAfterWin !== undefined ? { continueAfterWin: s.flags.continueAfterWin } : {}),
    ...(s.flags.fog !== undefined ? { fog: s.flags.fog } : {}),
    ...(s.flags.chaos !== undefined ? { chaos: s.flags.chaos } : {}),
    ...(s.flags.siege !== undefined ? { siege: s.flags.siege } : {}),
  };
}
