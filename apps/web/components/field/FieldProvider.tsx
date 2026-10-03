'use client';

/**
 * État partagé de la vue terrain : réseau, file d'attente hors ligne, synchronisation
 * automatique (retour du réseau, retour au premier plan, toutes les 30 s) et service worker.
 */
import type { FieldAction } from '@batimint/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  enqueueAction,
  enqueuePhoto,
  listActions,
  listPhotos,
  onQueueChange,
  type QueuedAction,
  type QueuedPhoto,
  removeActions,
  removePhoto,
} from '@/lib/field/queue';
import { type SyncResult, syncQueue } from '@/lib/field/sync';

interface FieldApi {
  online: boolean;
  syncing: boolean;
  actions: QueuedAction[];
  photos: Omit<QueuedPhoto, 'blob'>[];
  /** Actions et photos en attente d'envoi (hors erreurs définitives). */
  pendingCount: number;
  failed: (QueuedAction | Omit<QueuedPhoto, 'blob'>)[];
  lastSyncAt: Date | null;
  enqueue(action: FieldAction): Promise<SyncResult | null>;
  addPhoto(photo: Omit<QueuedPhoto, 'createdAt' | 'error'>): Promise<void>;
  sync(): Promise<SyncResult | null>;
  dismissFailed(id: string): Promise<void>;
}

const FieldContext = createContext<FieldApi | null>(null);

const SYNC_EVERY_MS = 30_000;

export function FieldProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [actions, setActions] = useState<QueuedAction[]>([]);
  const [photos, setPhotos] = useState<Omit<QueuedPhoto, 'blob'>[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const onlineRef = useRef(true);

  const refresh = useCallback(async () => {
    const [a, p] = await Promise.all([listActions(), listPhotos()]);
    setActions(a);
    setPhotos(p.map(({ blob: _blob, ...rest }) => rest));
  }, []);

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!onlineRef.current) return null;
    const [a, p] = await Promise.all([listActions(), listPhotos()]);
    if (!a.some((x) => !x.error) && !p.some((x) => !x.error)) return null;
    setSyncing(true);
    try {
      const r = await syncQueue();
      if (r.sent > 0 || r.failed > 0) {
        setLastSyncAt(new Date());
        await queryClient.invalidateQueries({ queryKey: ['field'] });
        await queryClient.invalidateQueries({ queryKey: ['timesheet'] });
      }
      return r;
    } finally {
      setSyncing(false);
    }
  }, [queryClient]);

  useEffect(() => {
    onlineRef.current = navigator.onLine;
    setOnline(navigator.onLine);
    void refresh();
    const off = onQueueChange(() => void refresh());
    const goOnline = () => {
      onlineRef.current = true;
      setOnline(true);
      void sync();
    };
    const goOffline = () => {
      onlineRef.current = false;
      setOnline(false);
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => void sync(), SYNC_EVERY_MS);
    void sync();
    return () => {
      off();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(timer);
    };
  }, [refresh, sync]);

  // Service worker : l'app terrain se rouvre sans réseau (production uniquement).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/terrain/sw.js', { scope: '/terrain' }).catch(() => undefined);
  }, []);

  const enqueue = useCallback(
    async (action: FieldAction) => {
      await enqueueAction(action);
      return sync();
    },
    [sync],
  );

  const addPhoto = useCallback(
    async (photo: Omit<QueuedPhoto, 'createdAt' | 'error'>) => {
      await enqueuePhoto(photo);
      void sync();
    },
    [sync],
  );

  const dismissFailed = useCallback(async (id: string) => {
    await removeActions([id]);
    await removePhoto(id);
  }, []);

  const value = useMemo<FieldApi>(() => {
    const failed = [...actions.filter((a) => a.error), ...photos.filter((p) => p.error)];
    return {
      online,
      syncing,
      actions,
      photos,
      pendingCount: actions.filter((a) => !a.error).length + photos.filter((p) => !p.error).length,
      failed,
      lastSyncAt,
      enqueue,
      addPhoto,
      sync,
      dismissFailed,
    };
  }, [online, syncing, actions, photos, lastSyncAt, enqueue, addPhoto, sync, dismissFailed]);

  return <FieldContext.Provider value={value}>{children}</FieldContext.Provider>;
}

export function useField(): FieldApi {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('useField hors de FieldProvider');
  return ctx;
}

/** Position du téléphone (8 s maximum) : un pointage ne doit jamais attendre le GPS. */
export function currentPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: Math.min(100_000, p.coords.accuracy),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 60_000 },
    );
  });
}
