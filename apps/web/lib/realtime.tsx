'use client';

/**
 * Temps réel côté navigateur (06) : EventSource sur /api/v1/realtime/stream, invalidation des
 * requêtes TanStack Query par sujet, et repli en polling si le flux est indisponible.
 */
import type { RealtimeMessage } from '@batimint/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type Listener = (message: RealtimeMessage) => void;

interface RealtimeApi {
  connected: boolean;
  subscribe(listener: Listener): () => void;
  /** Ajoute des canaux (ex. project:{id}) le temps du montage d'un écran. */
  addChannels(channels: string[]): () => void;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

const FALLBACK_POLL_MS = 20_000;

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [channelCounts, setChannelCounts] = useState<Record<string, number>>({});
  const listeners = useRef(new Set<Listener>());

  const channels = useMemo(
    () => Object.keys(channelCounts).filter((c) => (channelCounts[c] ?? 0) > 0).sort().join(','),
    [channelCounts],
  );

  useEffect(() => {
    const url = `/api/v1/realtime/stream${channels ? `?channels=${encodeURIComponent(channels)}` : ''}`;
    const source = new EventSource(url, { withCredentials: true });
    source.addEventListener('ready', () => setConnected(true));
    source.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse((e as MessageEvent<string>).data) as RealtimeMessage;
        void queryClient.invalidateQueries({ queryKey: [msg.topic] });
        for (const l of listeners.current) l(msg);
      } catch {
        /* message ignoré */
      }
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [channels, queryClient]);

  // Repli : si le flux est coupé, on rafraîchit périodiquement les données affichées.
  useEffect(() => {
    if (connected) return;
    const timer = setInterval(() => void queryClient.invalidateQueries({ type: 'active' }), FALLBACK_POLL_MS);
    return () => clearInterval(timer);
  }, [connected, queryClient]);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const addChannels = useCallback((list: string[]) => {
    setChannelCounts((prev) => {
      const next = { ...prev };
      for (const c of list) next[c] = (next[c] ?? 0) + 1;
      return next;
    });
    return () =>
      setChannelCounts((prev) => {
        const next = { ...prev };
        for (const c of list) next[c] = Math.max(0, (next[c] ?? 0) - 1);
        return next;
      });
  }, []);

  const value = useMemo(() => ({ connected, subscribe, addChannels }), [connected, subscribe, addChannels]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeApi {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime hors de RealtimeProvider');
  return ctx;
}

export function useRealtimeListener(listener: Listener): void {
  const { subscribe } = useRealtime();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => subscribe((m) => ref.current(m)), [subscribe]);
}
