/**
 * One-tap matchmaking: join the queue and follow the match.
 * Shared by Home quick-play (Play page keeps its richer inline flow).
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, clientRegion } from '../lib/api.js';
import { timeControlName } from '../lib/format.js';
import { useSession } from '../stores/session.js';
import { playSound } from '../lib/sound.js';
import { toast } from '../stores/toasts.js';

export function useQuickMatch() {
  const navigate = useNavigate();
  const { user, loginAsGuest } = useSession();
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desc, setDesc] = useState('');

  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await api.mmStatus();
        if (!cancelled && res.status === 'matched') {
          setSearching(false);
          playSound('match');
          toast('good', 'Match found — good luck!');
          navigate(`/game/${res.gameId}`);
        }
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [searching, navigate]);

  async function start(timeControl: string, mode: 'ranked' | 'casual'): Promise<boolean> {
    setError(null);
    let me = user;
    if (me === null) {
      if (!(await loginAsGuest())) return false;
      me = useSession.getState().user;
    }
    if (me === null) return false;
    setSearching(true);
    setDesc(`${timeControlName(timeControl)} · ${mode}`);
    try {
      const region = clientRegion();
      const res = await api.mmJoin({
        mode,
        timeControl,
        ...(region !== undefined ? { region } : {}),
      });
      if (res.status === 'matched') {
        setSearching(false);
        playSound('match');
        toast('good', 'Match found — good luck!');
        navigate(`/game/${res.gameId}`);
      }
      return true;
    } catch (err) {
      setSearching(false);
      setError(err instanceof Error ? err.message : 'Matchmaking failed');
      return false;
    }
  }

  async function cancel(): Promise<void> {
    try {
      await api.mmCancel();
    } finally {
      setSearching(false);
    }
  }

  return { searching, error, desc, start, cancel, isGuest: user === null || user.guest === true };
}
