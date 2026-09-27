/**
 * Pure tournament pairing (no I/O — fully unit-tested).
 * Players are user-id strings; ordering inputs must already be seeded
 * (rating desc, join order, or draw) by the caller.
 */
export type Pair = [string, string | null]; // null = bye (auto-advance)

/** Single elimination: top seed vs bottom seed; odd count → middle bye. */
export function pairSingleElim(seeded: string[]): Pair[] {
  const players = [...seeded];
  const pairs: Pair[] = [];
  if (players.length % 2 === 1) {
    const bye = players.splice(Math.floor(players.length / 2), 1)[0] as string;
    pairs.push([bye, null]);
  }
  while (players.length > 0) {
    const a = players.shift() as string;
    const b = players.pop() as string;
    pairs.push([a, b]);
  }
  return pairs;
}

/** Winners advance; byes carry their holder forward. */
export function advanceSingleElim(results: { winner: string | null }[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    if (r.winner !== null) out.push(r.winner);
  }
  return out;
}

/** Round-robin circle method: every pairing exactly once. */
export function roundRobinSchedule(players: string[]): Pair[][] {
  const list = [...players];
  if (list.length % 2 === 1) list.push('\0BYE\0');
  const n = list.length;
  const rounds: Pair[][] = [];
  const fixed = list[0] as string;
  let rotating = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const order = [fixed, ...rotating];
    const pairs: Pair[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i] as string;
      const b = order[n - 1 - i] as string;
      if (a === '\0BYE\0' && b === '\0BYE\0') continue;
      pairs.push(b === '\0BYE\0' ? [a, null] : a === '\0BYE\0' ? [b, null] : [a, b]);
    }
    rounds.push(pairs);
    rotating = [rotating[rotating.length - 1] as string, ...rotating.slice(0, -1)];
  }
  return rounds;
}

export interface SwissStanding {
  userId: string;
  points: number;
}

/**
 * Swiss-lite: sort by points desc, greedily pair top-down avoiding rematches
 * (pastPairs holds "a|b" sorted keys). Odd player out gets the bye (lowest
 * scorer without one gets priority — simplified to lowest scorer).
 */
export function pairSwiss(
  standings: SwissStanding[],
  pastPairs: Set<string>,
): { pairs: Pair[]; bye: string | null } {
  const ordered = [...standings].sort((x, y) => y.points - x.points || (x.userId < y.userId ? -1 : 1));
  const pairs: Pair[] = [];
  let bye: string | null = null;
  const rest = [...ordered];
  if (rest.length % 2 === 1) {
    const last = rest.pop() as SwissStanding;
    bye = last.userId;
  }
  const key = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  while (rest.length > 0) {
    const head = rest.shift() as SwissStanding;
    let idx = rest.findIndex((s) => !pastPairs.has(key(head.userId, s.userId)));
    if (idx === -1) idx = 0; // all rematches — accept the least-bad pairing
    const opp = rest.splice(idx, 1)[0] as SwissStanding;
    pairs.push([head.userId, opp.userId]);
  }
  return { pairs, bye };
}

export function pastPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
