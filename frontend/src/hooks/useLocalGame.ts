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
} from '../../../engine/typescript/index.js';
import type { Action, GameState, Pos, Wall } from '../../../engine/typescript/core/types.js';

export interface LocalGameOptions {
  size: number;
  wallsPerPlayer: number;
  mode: 'local' | 'bot';
  botId?: string;
  /** Starting clock per side in ms (0 = untimed). */
  clockMs?: number;
  incrementMs?: number;
}

export interface LocalGame extends LocalGameState {
  doMove: (to: Pos) => void;
  doWall: (wall: Wall) => void;
  restart: () => void;
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
  const { size, wallsPerPlayer, mode, botId, clockMs = 0, incrementMs = 0 } = opts;
  const [state, setState] = useState<GameState>(() => createGame({ size, wallsPerPlayer }));
  const [actions, setActions] = useState<Action[]>([]);
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

  const doMove = useCallback((to: Pos) => apply({ type: 'move', to }), [apply]);
  const doWall = useCallback((wall: Wall) => apply({ type: 'wall', wall }), [apply]);

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
  useEffect(() => {
    if (!clockOn || over) return;
    const id = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastTick.current;
      lastTick.current = now;
      setClocks((c) => {
        const next = [...c] as [number, number];
        next[state.turn] = Math.max(0, next[state.turn] - elapsed);
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

  // Bot driver.
  useEffect(() => {
    if (mode !== 'bot' || over || state.turn !== 1) return;
    const def = getBot(botId ?? 'rookie');
    if (def === null) return;
    setBotThinking(true);
    const id = setTimeout(() => {
      try {
        const action = botAction(def, state, seedBase.current + state.moveNumber);
        setBotThinking(false);
        apply(action);
      } catch {
        setBotThinking(false);
      }
    }, 350);
    return () => clearTimeout(id);
  }, [mode, over, state, botId, apply]);

  return useMemo(() => ({
    state, actions, clocks, clockOn, message, botThinking, winnerSeat, reason, startedAt,
    doMove, doWall, restart,
  }), [state, actions, clocks, clockOn, message, botThinking, winnerSeat, reason, startedAt, doMove, doWall, restart]);
}
