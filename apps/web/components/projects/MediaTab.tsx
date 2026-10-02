'use client';

import type { AttachmentDto } from '@batimint/contracts';
import { Button, Card, Chip, cn, EmptyState, Skeleton, Switch, useToast } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Eye, EyeOff, FileText, ImagePlus, Trash2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { compressImage, uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';

function useUpload(projectId: string) {
  const t = useTranslations('projects.media');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const upload = async (
    files: FileList | null,
    kind: 'photo' | 'document',
    options: { taskId?: string; visibleToClient?: boolean } = {},
  ) => {
    if (!files?.length) return;
    setBusy(true);
    let done = 0;
    try {
      for (const file of Array.from(files)) {
        const body = kind === 'photo' ? await compressImage(file) : file;
        const params = new URLSearchParams({
          ownerType: 'project',
          ownerId: projectId,
          kind,
          id: uuidv7(),
          takenAt: new Date(file.lastModified || Date.now()).toISOString(),
        });
        if (options.taskId) params.set('taskId', options.taskId);
        if (options.visibleToClient) params.set('visibleToClient', 'true');
        await uploadRaw(`/attachments?${params.toString()}`, body, {
          fileName: file.name,
          contentType: body.type || file.type,
        });
        done++;
      }
      toast.show({ title: t('uploaded', { n: done }), tone: 'good' });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['attachments', 'project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
    }
  };
  return { upload, busy };
}

/** Bouton « Ajouter des photos » (appareil photo sur mobile), réutilisé par le tiroir d'une tâche. */
export function PhotoUploadButton({
  projectId,
  taskId,
  visibleToClient,
  compact,
}: {
  projectId: string;
  taskId?: string;
  visibleToClient?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations('projects.media');
  const ref = useRef<HTMLInputElement>(null);
  const { upload, busy } = useUpload(projectId);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void upload(e.target.files, 'photo', { taskId, visibleToClient });
          e.target.value = '';
        }}
      />
      <Button
        size={compact ? 'sm' : 'md'}
        variant={compact ? 'ghost' : 'primary'}
        loading={busy}
        icon={<ImagePlus aria-hidden className="size-4" />}
        onClick={() => ref.current?.click()}
      >
        {t('addPhotos')}
      </Button>
    </>
  );
}

export function MediaTab({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.media');
  const can = useCan();
  const list = useApi<{ items: AttachmentDto[] }>(
    ['attachments', 'project', projectId],
    `/attachments?ownerType=project&ownerId=${projectId}`,
  );
  const docRef = useRef<HTMLInputElement>(null);
  const { upload, busy } = useUpload(projectId);
  const office = can('projects.write');
  const [shareNext, setShareNext] = useState(false);
  const items = list.data?.items ?? [];
  const photos = items.filter((a) => a.kind === 'photo');
  const documents = items.filter((a) => a.kind === 'document');
  const days = useMemo(() => {
    const out: { key: string; items: AttachmentDto[] }[] = [];
    for (const ph of photos) {
      const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(
        new Date(ph.takenAt ?? ph.createdAt),
      );
      const g = out.find((x) => x.key === k);
      if (g) g.items.push(ph);
      else out.push({ key: k, items: [ph] });
    }
    return out;
  }, [photos]);

  return (
    <div className="flex flex-col gap-4">
      {can('tasks.update') ? (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <PhotoUploadButton projectId={projectId} visibleToClient={office && shareNext} />
          <input
            ref={docRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void upload(e.target.files, 'document', { visibleToClient: office && shareNext });
              e.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            loading={busy}
            icon={<Upload aria-hidden className="size-4" />}
            onClick={() => docRef.current?.click()}
          >
            {t('addDocument')}
          </Button>
          {office ? (
            <div className="ml-auto">
              <Switch label={t('visibleNext')} checked={shareNext} onChange={setShareNext} />
            </div>
          ) : null}
        </Card>
      ) : null}
      {list.isLoading ? (
        <Skeleton className="h-60" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Camera aria-hidden className="size-5" />}
          title={t('title')}
          description={t('empty')}
        />
      ) : (
        <>
          {days.map((d) => (
            <section key={d.key} aria-label={formatDayLong(d.key)} className="flex flex-col gap-2">
              <h3 className="text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">
                {formatDayLong(d.key)}
              </h3>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {d.items.map((ph, i) => (
                  <MediaTile key={ph.id} a={ph} index={i} projectId={projectId} office={office} />
                ))}
              </ul>
            </section>
          ))}
          {documents.length ? (
            <section aria-labelledby="media-documents" className="flex flex-col gap-2">
              <h3
                id="media-documents"
                className="text-[12px] font-semibold tracking-[0.08em] text-muted uppercase"
              >
                {t('documents')}
              </h3>
              <Card className="p-0">
                <ul className="flex flex-col divide-y divide-line-soft">
                  {documents.map((doc) => (
                    <DocumentRow key={doc.id} a={doc} projectId={projectId} office={office} />
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function formatDayLong(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Brussels',
  });
}

function useAttachmentPatch(projectId: string) {
  return useApiMutation<{ id: string; visibleToClient: boolean }>(
    ({ id, visibleToClient }) => ({ path: `/attachments/${id}`, method: 'PATCH', body: { visibleToClient } }),
    { invalidate: [['attachments', 'project', projectId]] },
  );
}

function MediaTile({
  a,
  index,
  projectId,
  office,
}: {
  a: AttachmentDto;
  index: number;
  projectId: string;
  office: boolean;
}) {
  const t = useTranslations('projects.media');
  const patch = useAttachmentPatch(projectId);
  const remove = useApiMutation<void>(() => ({ path: `/attachments/${a.id}`, method: 'DELETE' }), {
    invalidate: [
      ['attachments', 'project', projectId],
      ['project', projectId],
    ],
    successMessage: t('deleted'),
  });
  const date = new Date(a.takenAt ?? a.createdAt).toLocaleDateString('fr-BE', {
    timeZone: 'Europe/Brussels',
  });
  return (
    <li className="group relative overflow-hidden rounded-[12px] border border-line bg-surface">
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        aria-label={t('open', { n: index + 1 })}
        className="block focus-visible:outline-2 focus-visible:outline-accent"
      >
        <img
          src={a.url}
          alt={a.caption ?? t('photoAlt', { date })}
          loading="lazy"
          className="aspect-[4/3] w-full object-cover"
        />
      </a>
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <Chip tone={a.visibleToClient ? 'accent' : 'neutral'}>
          {a.visibleToClient ? t('visible') : t('hidden')}
        </Chip>
        <div className="flex">
          {office ? (
            <button
              type="button"
              aria-label={a.visibleToClient ? t('toggleHidden') : t('toggleVisible')}
              title={a.visibleToClient ? t('toggleHidden') : t('toggleVisible')}
              aria-pressed={a.visibleToClient}
              onClick={() => patch.mutate({ id: a.id, visibleToClient: !a.visibleToClient })}
              className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-ink"
            >
              {a.visibleToClient ? (
                <EyeOff aria-hidden className="size-4" />
              ) : (
                <Eye aria-hidden className="size-4" />
              )}
            </button>
          ) : null}
          {office ? (
            <button
              type="button"
              aria-label={t('delete', { name: a.fileName })}
              title={t('delete', { name: a.fileName })}
              onClick={() => remove.mutate()}
              className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-crit"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function DocumentRow({ a, projectId, office }: { a: AttachmentDto; projectId: string; office: boolean }) {
  const t = useTranslations('projects.media');
  const patch = useAttachmentPatch(projectId);
  const remove = useApiMutation<void>(() => ({ path: `/attachments/${a.id}`, method: 'DELETE' }), {
    invalidate: [
      ['attachments', 'project', projectId],
      ['project', projectId],
    ],
    successMessage: t('deleted'),
  });
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <FileText aria-hidden className="size-4 shrink-0 text-muted" />
      <a
        href={a.url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate text-[14px] hover:underline"
      >
        {a.caption ?? a.fileName}
      </a>
      {office ? (
        <Switch
          label={t('visible')}
          checked={a.visibleToClient}
          onChange={(v) => patch.mutate({ id: a.id, visibleToClient: v })}
        />
      ) : (
        <Chip tone={a.visibleToClient ? 'accent' : 'neutral'}>
          {a.visibleToClient ? t('visible') : t('hidden')}
        </Chip>
      )}
      {office ? (
        <button
          type="button"
          aria-label={t('delete', { name: a.fileName })}
          onClick={() => remove.mutate()}
          className={cn(
            'flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-crit',
          )}
        >
          <Trash2 aria-hidden className="size-4" />
        </button>
      ) : null}
    </li>
  );
}
