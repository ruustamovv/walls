/**
 * Local multiplayer controller (2–4 seats, humans + engine bots).
 * First `humans` seats are human; the rest run the multi bot core.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMultiMove,
  chooseMultiBotAction,
  createMultiGame,
  validateMultiMove,
} from '../../../engine/typescript/index.js';
import type { MultiAction, MultiPos, MultiState, MultiWall } from '../../../engine/typescript/index.js';
import { playSound } from '../lib/sound.js';

export interface MultiGameOptions {
  players: number;
  humans: number;
  size: number;
  wallsPerPlayer: number;
}

export function useMultiGame(opts: MultiGameOptions) {
  const { players, humans, size, wallsPerPlayer } = opts;
  const [state, setState] = useState<MultiState>(() => createMultiGame({ players, size, wallsPerPlayer }));
  const [actions, setActions] = useState<MultiAction[]>([]);
  const [message, setMessage] = useState('');
  const [botThinking, setBotThinking] = useState(false);
  const seedBase = useRef(Math.floor(Math.random() * 1e9));

  const humanSeats = useMemo(
    () => Array.from({ length: Math.min(humans, players) }, (_, i) => i),
    [humans, players],
  );
  const over = state.isOver;

  const apply = useCallback((action: MultiAction) => {
    setState((prev) => {
      if (prev.isOver) return prev;
      const verdict = validateMultiMove(prev, action);
      if (!verdict.ok) {
        setMessage(action.type === 'move' ? 'Illegal move.' : `Illegal wall (${verdict.reason ?? 'rejected'}).`);
        return prev;
      }
      const out = applyMultiMove(prev, action);
      setActions((a) => [...a, action]);
      setMessage('');
      return out.state;
    });
  }, []);

  const doMove = useCallback((to: MultiPos) => apply({ type: 'move', to }), [apply]);
  const doWall = useCallback((wall: MultiWall) => apply({ type: 'wall', wall }), [apply]);

  const restart = useCallback(() => {
    setState(createMultiGame({ players, size, wallsPerPlayer }));
    setActions([]);
    setMessage('');
    setBotThinking(false);
    seedBase.current = Math.floor(Math.random() * 1e9);
  }, [players, size, wallsPerPlayer]);

  const configKey = `${players}x${humans}:${size}x${wallsPerPlayer}`;
  const seenConfig = useRef(configKey);
  useEffect(() => {
    if (seenConfig.current !== configKey) {
      seenConfig.current = configKey;
      restart();
    }
  }, [configKey, restart]);

  // Bot driver: any non-human seat to move.
  useEffect(() => {
    if (over || humanSeats.includes(state.turn)) return;
    setBotThinking(true);
    const id = setTimeout(() => {
      try {
        const action = chooseMultiBotAction(state, { seed: seedBase.current + state.moveNumber, budgetMs: 150 });
        setBotThinking(false);
        apply(action);
      } catch {
        setBotThinking(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [over, state, humanSeats, apply]);

  // Sound cues.
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
    if (state.isOver) playSound('win');
  }, [state.isOver]);

  return useMemo(() => ({
    state, actions, message, botThinking, humanSeats,
    doMove, doWall, restart,
  }), [state, actions, message, botThinking, humanSeats, doMove, doWall, restart]);
}
