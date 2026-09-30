/**
 * Bot banter: deterministic personality quips for game milestones.
 * Static lines (no LLM) — toggleable in UI, never during rated play.
 */
import type { BotDef } from './personalities.js';

export type BanterTrigger = 'greet' | 'wall' | 'losing' | 'winning' | 'win' | 'lose';

const GENERIC: Record<BanterTrigger, string[]> = {
  greet: ['Good luck. You will need it.', 'Shall we dance?', 'I have studied your kind.'],
  wall: ['Interesting choice.', 'Bricks. Bold.', 'Noted.'],
  losing: ['Hmm.', 'You fight well.', 'This is getting uncomfortable.'],
  winning: ['As calculated.', 'The maze grows.', 'Patience wins races.'],
  win: ['Well played. Rematch?', 'The walls remember.', 'GG.'],
  lose: ['Impossible... well played.', 'You earned that one.', 'Teach me that line sometime.'],
};

const PERSONAL: Record<string, Partial<Record<BanterTrigger, string[]>>> = {
  rookie: {
    greet: ['Hi! I am still learning, be nice!', 'Is this the goal over there? Or...?'],
    win: ['I won?! Did you see that?!'],
    lose: ['Good game! I almost had you. Probably.'],
  },
  runner: {
    greet: ['Race you to the other side!', 'Walls are for people who stop running.'],
    wall: ['Wait, I can do that too?'],
    win: ['Too fast!'],
  },
  fortress: {
    greet: ['Come. My walls are ready.', 'Attack if you dare.'],
    wall: ['Another brick in the fortress.', 'Feel free to walk around. It is a long walk.'],
  },
  architect: {
    greet: ['I have already built your defeat. You just live in it.', 'Admire the geometry. Briefly.'],
    wall: ['Load-bearing wall.', 'This one has a name.'],
  },
  assassin: {
    greet: ['I see your route. All of it.', 'Run.'],
    wall: ['Right there. That is where it hurts.'],
    win: ['Told you.'],
  },
  calculator: {
    greet: ['I have evaluated 12 continuations. You chose... this one.', 'Let us be precise.'],
    losing: ['Recalibrating. This changes the priors.'],
  },
  speedster: {
    greet: ['Blink and miss it!', 'Fast game? Good. I hate waiting.'],
    win: ['Under a minute. New record-ish!'],
  },
  endgame: {
    greet: ['The ending is my favorite part. Let us skip to it.', 'I save my walls. You will see why.'],
    winning: ['And now, the part where I win.'],
  },
  chaos: {
    greet: ['Rules are suggestions. Walls are confetti!', 'I have a plan. It involves this wall. Probably.'],
    wall: ['Wheee.', 'Trust the process. There is no process.'],
    lose: ['That was never going to work. Beautiful.'],
  },
  grandmaster: {
    greet: ['I do not play opponents. I play positions.', 'Show me something I have not seen.'],
    win: ['As expected. Again?'],
    lose: ['...Noted. Forever.'],
  },
  nemesis: {
    greet: ['I have read your games. All of them.', 'You waste walls. I counted.'],
    wall: ['Like that one in your last game? No. Like this.'],
    winning: ['This is the part where you usually drift.'],
    win: ['Fixed yet? Come back when it is fixed.'],
    lose: ['Interesting. Updating your profile...'],
  },
};

/** Deterministic quip for a bot + trigger (index breaks ties). */
export function quip(bot: Pick<BotDef, 'id'>, trigger: BanterTrigger, index = 0): string {
  const personal = PERSONAL[bot.id]?.[trigger] ?? [];
  const pool = personal.length > 0 ? personal : GENERIC[trigger];
  return pool[index % pool.length] as string;
}
