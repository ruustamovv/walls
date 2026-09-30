/**
 * Local game controller: deterministic engine + client clocks + bot driver.
 * Clocks here are presentational (local play). Online games use the
 * server-authoritative clock via useOnlineGame instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMove,
  botAction,
  createGame,
  getBot,
  validateMove,
  type BotDef,
} from '../../../engine/typescript/index.js';
import type { Action, GameState, Pos, Wall } from '../../../engine/typescript/core/types.js';
import { playSound } from '../lib/sound.js';

export interface LocalGameOptions {
  size: number;
  wallsPerPlayer: number;
  mode: 'local' | 'bot';
  botId?: string;
  /** Custom personality (e.g. Nemesis) when botId is not a stock bot. */
  customBot?: BotDef;
  /** Starting clock per side in ms (0 = untimed). */
  clockMs?: number;
  incrementMs?: number;
  /** Start from a designed position instead of the opening. */
  from?: { state: GameState; actions: Action[] };
}

export interface LocalGame extends LocalGameState {
  doMove: (to: Pos) => void;
  doWall: (wall: Wall) => void;
  restart: () => void;
  /** Take back `plies` plies (rebuilds from the action log). */
  undo: (plies: number) => void;
}

interface LocalGameState {
  state: GameState;
  actions: Action[];
  clocks: [number, number];
  clockOn: boolean;
  message: string;
  botThinking: boolean;
  winnerSeat: 0 | 1 | null;
  reason: 'goal' | 'timeout' | null;
  startedAt: number;
}

export function useLocalGame(opts: LocalGameOptions): LocalGame {
  const { size, wallsPerPlayer, mode, botId, customBot, clockMs = 0, incrementMs = 0, from } = opts;
  const [state, setState] = useState<GameState>(() => from !== undefined ? { ...from.state } : createGame({ size, wallsPerPlayer }));
  const [actions, setActions] = useState<Action[]>(() => (from !== undefined ? [...from.actions] : []));
  const [clocks, setClocks] = useState<[number, number]>([clockMs, clockMs]);
  const [message, setMessage] = useState('');
  const [botThinking, setBotThinking] = useState(false);
  const [winnerSeat, setWinnerSeat] = useState<0 | 1 | null>(null);
  const [reason, setReason] = useState<'goal' | 'timeout' | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const lastTick = useRef(Date.now());
  const seedBase = useRef(Math.floor(Math.random() * 1e9));

  const clockOn = clockMs > 0;
  const over = state.isOver || winnerSeat !== null;

  const finish = useCallback((winner: 0 | 1, why: 'goal' | 'timeout') => {
    setWinnerSeat(winner);
    setReason(why);
  }, []);

  const apply = useCallback((action: Action) => {
    setState((prev) => {
      if (prev.isOver) return prev;
      const verdict = validateMove(prev, action);
      if (!verdict.ok) {
        setMessage(action.type === 'move' ? 'Illegal move.' : `Illegal wall (${verdict.reason ?? 'rejected'}).`);
        // Side-effect inside the updater is StrictMode-unsafe; the illegal
        // cue replays from the message effect below instead.
        return prev;
      }
      const mover = prev.turn;
      const out = applyMove(prev, action);
      setActions((a) => [...a, action]);
      setMessage('');
      if (clockOn) {
        setClocks((c) => {
          const next = [...c] as [number, number];
          next[mover] += incrementMs;
          return next;
        });
      }
      lastTick.current = Date.now();
      if (out.state.isOver && out.state.winner !== null) finish(out.state.winner, 'goal');
      return out.state;
    });
  }, [clockOn, incrementMs, finish]);

  // Sound cues derived from rendered state (StrictMode-safe).
  const lastSounded = useRef(-1);
  useEffect(() => {
    if (actions.length > 0 && actions.length !== lastSounded.current) {
      lastSounded.current = actions.length;
      const last = actions[actions.length - 1];
      if (last !== undefined) playSound(last.type === 'move' ? 'move' : 'wall');
    }
  }, [actions]);
  useEffect(() => {
    if (message !== '') playSound('illegal');
  }, [message]);
  useEffect(() => {
    if (winnerSeat === null) return;
    if (mode === 'bot') playSound(winnerSeat === 0 ? 'win' : 'lose');
    else playSound('win');
  }, [winnerSeat, mode]);

  const doMove = useCallback((to: Pos) => apply({ type: 'move', to }), [apply]);
  const doWall = useCallback((wall: Wall) => apply({ type: 'wall', wall }), [apply]);

  const undo = useCallback((plies: number) => {
    if (actions.length === 0 || botThinking) return;
    const kept = actions.slice(0, Math.max(0, actions.length - plies));
    let s = createGame({ size, wallsPerPlayer });
    for (const a of kept) {
      try {
        s = applyMove(s, a).state;
      } catch {
        return;
      }
    }
    setState(s);
    setActions(kept);
    setMessage('');
    setWinnerSeat(null);
    setReason(null);
    lastTick.current = Date.now();
    lastSounded.current = kept.length;
  }, [actions, botThinking, size, wallsPerPlayer]);

  const restart = useCallback(() => {
    setState(createGame({ size, wallsPerPlayer }));
    setActions([]);
    setClocks([clockMs, clockMs]);
    setMessage('');
    setBotThinking(false);
    setWinnerSeat(null);
    setReason(null);
    setStartedAt(Date.now());
    lastTick.current = Date.now();
    seedBase.current = Math.floor(Math.random() * 1e9);
  }, [size, wallsPerPlayer, clockMs]);

  // Restart when the configuration changes.
  const configKey = `${size}x${wallsPerPlayer}:${mode}:${botId ?? ''}:${clockMs}`;
  const seenConfig = useRef(configKey);
  useEffect(() => {
    if (seenConfig.current !== configKey) {
      seenConfig.current = configKey;
      restart();
    }
  }, [configKey, restart]);

  // Client clock tick (decrement only; timeout is derived below).
  // Second-granular: re-renders at most once per displayed second, and
  // pauses while the tab is hidden (no fake time loss on return).
  const lastShownSec = useRef<[number, number]>([-1, -1]);
  useEffect(() => {
    if (!clockOn || over) return;
    const id = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick.current;
      lastTick.current = now;
      if (document.hidden) return;
      setClocks((c) => {
        const next = [...c] as [number, number];
        next[state.turn] = Math.max(0, next[state.turn] - elapsed);
        const shown: [number, number] = [Math.ceil(next[0] / 1000), Math.ceil(next[1] / 1000)];
        if (shown[0] === lastShownSec.current[0] && shown[1] === lastShownSec.current[1] && next[state.turn] > 0) {
          return c; // same rendered second — skip the render entirely
        }
        lastShownSec.current = shown;
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [clockOn, over, state.turn]);

  // Timeout resolution (runs after the tick renders the new clock).
  useEffect(() => {
    if (clockOn && !over && clocks[state.turn] <= 0) {
      finish((1 - state.turn) as 0 | 1, 'timeout');
    }
  }, [clockOn, over, clocks, state.turn, finish]);

  // Bot driver (adaptive budget: browser cap keeps UI fluid, clock-aware
  // shrink prevents flag-burn; calibration CLI still runs full budgets).
  useEffect(() => {
    if (mode !== 'bot' || over || state.turn !== 1) return;
    const def = getBot(botId ?? 'rookie') ?? (botId === 'nemesis' ? customBot ?? null : null);
    if (def === null || def === undefined) return;
    setBotThinking(true);
    const id = setTimeout(() => {
      try {
        const action = botAction(def, state, seedBase.current + state.moveNumber, {
          ...(clockOn ? { clockMsLeft: clocks[1] } : {}),
          hardCapMs: 800,
        });
        setBotThinking(false);
        apply(action);
      } catch {
        setBotThinking(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [mode, over, state, botId, customBot, apply, clockOn, clocks]);

  return useMemo(() => ({
    state, actions, clocks, clockOn, message, botThinking, winnerSeat, reason, startedAt,
    doMove, doWall, restart, undo,
  }), [state, actions, clocks, clockOn, message, botThinking, winnerSeat, reason, startedAt, doMove, doWall, restart, undo]);
}
