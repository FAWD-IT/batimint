'use client';

import type { FieldTodayDto } from '@batimint/contracts';
import { cn, Spinner, useToast } from '@batimint/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { api, ApiError } from '@/lib/api';
import { cachedToday, cacheToday } from '@/lib/field/queue';
import { compressImage } from '@/lib/upload';
import { currentPosition, useField } from './FieldProvider';

/** Couleurs d'avatars de l'équipe (maquette terrain). */
export const TEAM_COLORS = ['#7D93FF', '#F0A045', '#3DBE73', '#E57FB0', '#5FC8D6', '#C9A0FF'];

export { formatClockTime as clockTime, formatMinutes as duration } from '@batimint/domain';

/**
 * Journée de terrain : réseau d'abord, dernière version connue (IndexedDB) si le réseau manque.
 * Le drapeau `fromCache` permet d'afficher « données de 7 h 40 ».
 */
export function useFieldToday(projectId: string | null) {
  return useQuery({
    queryKey: ['field', 'today', projectId],
    queryFn: async ({ signal }): Promise<FieldTodayDto & { fromCache?: string }> => {
      const key = `today:${projectId ?? 'auto'}`;
      try {
        const d = await api<FieldTodayDto>(`/field/today${projectId ? `?projectId=${projectId}` : ''}`, {
          signal,
        });
        await cacheToday(key, { ...d, cachedAt: new Date().toISOString() } as FieldTodayDto);
        return d;
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          const cached = (await cachedToday(key)) as (FieldTodayDto & { cachedAt?: string }) | null;
          if (cached) return { ...cached, fromCache: cached.cachedAt ?? new Date().toISOString() };
        }
        throw err;
      }
    },
    retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
  });
}

/** Pastille d'état réseau et de file (« À jour », « Hors ligne · 2 en attente »). */
export function SyncPill() {
  const t = useTranslations('field.sync');
  const f = useField();
  const tone = !f.online ? 'warn' : f.failed.length ? 'crit' : f.pendingCount ? 'accent' : 'good';
  const label = f.syncing
    ? t('sending')
    : !f.online
      ? f.pendingCount
        ? t('offlinePending', { n: f.pendingCount })
        : t('offline')
      : f.pendingCount
        ? t('pending', { n: f.pendingCount })
        : f.failed.length
          ? t('failed', { n: f.failed.length })
          : t('upToDate');
  return (
    <button
      type="button"
      onClick={() => void f.sync()}
      aria-live="polite"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      {f.syncing ? (
        <Spinner className="size-3" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            tone === 'good' && 'bg-good',
            tone === 'warn' && 'bg-warn',
            tone === 'crit' && 'bg-crit',
            tone === 'accent' && 'bg-accent',
          )}
        />
      )}
      {label}
    </button>
  );
}

/**
 * Prise de photo : appareil photo du téléphone, compression, position, mise en file. La photo
 * part tout de suite si le réseau est là, sinon dès qu'il revient.
 */
export function usePhotoCapture() {
  const t = useTranslations('field.photo');
  const f = useField();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<{
    ownerType: 'project' | 'issue';
    ownerId: string;
    projectId: string;
    taskId: string | null;
  }>(null);

  const open = (to: {
    ownerType: 'project' | 'issue';
    ownerId: string;
    projectId: string;
    taskId?: string | null;
  }) => {
    target.current = { ...to, taskId: to.taskId ?? null };
    input.current?.click();
  };

  const queueFiles = async (
    files: File[],
    to: { ownerType: 'project' | 'issue'; ownerId: string; projectId: string; taskId: string | null },
  ) => {
    const pos = files.length ? await currentPosition() : null;
    for (const file of files) {
      const blob = await compressImage(file);
      await f.addPhoto({
        id: uuidv7(),
        ...to,
        blob,
        fileName: file.name || 'photo.jpg',
        takenAt: new Date(file.lastModified || Date.now()).toISOString(),
        latitude: pos?.latitude ?? null,
        longitude: pos?.longitude ?? null,
      });
    }
  };

  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid="field-photo-input"
      onChange={async (e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!files.length || !target.current) return;
        await queueFiles(files, target.current);
        toast.show({
          title: f.online ? t('queued', { n: files.length }) : t('queuedOffline', { n: files.length }),
          tone: 'good',
        });
      }}
    />
  );
  return { open, element, queueFiles };
}
