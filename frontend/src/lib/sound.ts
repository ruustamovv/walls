/**
 * Tiny WebAudio synth for game feedback — zero assets, all toggleable.
 * Sounds: move (soft hop), wall (wood plunk), illegal (dull thud),
 * win (rising triad), lose (falling pair), match (chime), tick (clock warning).
 */
import { useSettings } from '../stores/settings.js';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (useSettings.getState().sound === false) return null;
  try {
    if (ctx === null) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC === undefined) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, type: OscillatorType, gain: number): void {
  const ac = audio();
  if (ac === null) return;
  const vol = useSettings.getState().volume / 100;
  if (vol <= 0) return;
  try {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ac.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain * vol), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch {
    // audio never breaks gameplay
  }
}

export type GameSound = 'move' | 'wall' | 'illegal' | 'win' | 'lose' | 'match' | 'tick' | 'notify';

export function playSound(kind: GameSound): void {
  switch (kind) {
    case 'move':
      tone(520, 0, 0.09, 'sine', 0.16);
      tone(780, 0.03, 0.08, 'sine', 0.1);
      break;
    case 'wall':
      tone(180, 0, 0.12, 'triangle', 0.22);
      tone(120, 0.02, 0.14, 'sine', 0.18);
      break;
    case 'illegal':
      tone(140, 0, 0.15, 'sawtooth', 0.08);
      break;
    case 'win':
      tone(523, 0, 0.16, 'sine', 0.16);
      tone(659, 0.12, 0.16, 'sine', 0.16);
      tone(784, 0.24, 0.28, 'sine', 0.18);
      break;
    case 'lose':
      tone(392, 0, 0.2, 'sine', 0.14);
      tone(311, 0.16, 0.3, 'sine', 0.14);
      break;
    case 'match':
      tone(880, 0, 0.12, 'sine', 0.14);
      tone(1174, 0.1, 0.2, 'sine', 0.14);
      break;
    case 'tick':
      tone(1000, 0, 0.05, 'square', 0.05);
      break;
    case 'notify':
      tone(660, 0, 0.1, 'sine', 0.12);
      break;
  }
}
