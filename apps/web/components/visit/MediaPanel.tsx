'use client';

import type { AttachmentDto } from '@batimint/contracts';
import { Button, Card, CardTitle, ConfirmDialog, Skeleton, Spinner, useToast } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, FileText, ImagePlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApi, useApiMutation } from '@/lib/hooks';
import { compressImage, uploadRaw } from '@/lib/upload';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { VoiceRecorder } from './VoiceRecorder';

/**
 * Photos, notes vocales (transcrites par le worker) et documents d'une affaire ou d'une visite.
 * La liste se met à jour en temps réel quand la transcription arrive.
 */
export function MediaPanel({
  ownerType,
  ownerId,
  canWrite,
}: {
  ownerType: 'opportunity' | 'site_visit' | 'customer';
  ownerId: string;
  canWrite: boolean;
}) {
  const t = useTranslations('visit');
  const tc = useTranslations('common');
  const toast = useToast();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const key = ['attachments', ownerType, ownerId];
  const list = useApi<{ items: AttachmentDto[] }>(
    key,
    `/attachments?ownerType=${ownerType}&ownerId=${ownerId}`,
  );
  const [uploading, setUploading] = useState(0);
  const [deleting, setDeleting] = useState<AttachmentDto | null>(null);
  const [viewing, setViewing] = useState<AttachmentDto | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const remove = useApiMutation<string>((id) => ({ path: `/attachments/${id}`, method: 'DELETE' }), {
    invalidate: [key, ['opportunities']],
    onSuccess: () => setDeleting(null),
  });

  const send = async (blob: Blob, fileName: string, kind: AttachmentDto['kind']) => {
    setUploading((n) => n + 1);
    try {
      const params = new URLSearchParams({
        ownerType,
        ownerId,
        kind,
        id: uuidv7(),
        takenAt: new Date().toISOString(),
      });
      await uploadRaw(`/attachments?${params.toString()}`, blob, { fileName });
      void queryClient.invalidateQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      setUploading((n) => n - 1);
    }
  };

  const onPhotos = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const blob = await compressImage(f);
      await send(blob, f.name.replace(/\.(heic|heif|png|webp)$/i, blob === f ? '.$1' : '.jpg'), 'photo');
    }
  };

  const items = list.data?.items ?? [];
  const photos = items.filter((a) => a.kind === 'photo');
  const voices = items.filter((a) => a.kind === 'voice_note');
  const docs = items.filter((a) => a.kind === 'document');

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>{t('media')}</CardTitle>
        {uploading > 0 ? (
          <span className="flex items-center gap-2 text-[13px] text-muted" role="status">
            <Spinner />
            {t('uploading')}
          </span>
        ) : null}
      </div>

      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<Camera aria-hidden className="size-4" />}
            onClick={() => cameraInput.current?.click()}
          >
            {tc('takePhoto')}
          </Button>
          <Button
            variant="secondary"
            icon={<ImagePlus aria-hidden className="size-4" />}
            onClick={() => photoInput.current?.click()}
          >
            {t('addPhoto')}
          </Button>
          <Button
            variant="ghost"
            icon={<FileText aria-hidden className="size-4" />}
            onClick={() => docInput.current?.click()}
          >
            {t('addDocument')}
          </Button>
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void onPhotos(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            tabIndex={-1}
            aria-hidden
            data-testid="photo-input"
            onChange={(e) => {
              void onPhotos(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={docInput}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void send(f, f.name, 'document');
              e.target.value = '';
            }}
          />
        </div>
      ) : null}

      {list.isLoading ? (
        <Skeleton className="h-24" />
      ) : items.length === 0 ? (
        <p className="text-[14px] text-muted">{t('noMedia')}</p>
      ) : null}

      {photos.length ? (
        <section aria-label={t('photos')}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">
            {t('photos')} · {photos.length}
          </h3>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id} className="relative">
                <button
                  type="button"
                  onClick={() => setViewing(p)}
                  className="block aspect-square w-full overflow-hidden rounded-[10px] bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label={t('openPhoto', { name: p.fileName })}
                >
                  <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label={t('voice')} className="flex flex-col gap-3">
        <h3 className="text-[13px] font-semibold text-muted">{t('voice')}</h3>
        {canWrite ? <VoiceRecorder onRecorded={(blob, name) => void send(blob, name, 'voice_note')} /> : null}
        {voices.map((v) => (
          <div key={v.id} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-muted">{relative(v.takenAt ?? v.createdAt)}</span>
              {canWrite ? (
                <DeleteButton label={`${tc('delete')} ${v.fileName}`} onClick={() => setDeleting(v)} />
              ) : null}
            </div>
            <audio controls preload="none" src={v.url} className="w-full">
              <track kind="captions" />
            </audio>
            {v.transcriptStatus === 'pending' ? (
              <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
                <Spinner />
                {t('transcribing')}
              </p>
            ) : v.transcript ? (
              <blockquote className="border-l-2 border-accent pl-3 text-[14px] whitespace-pre-line">
                {v.transcript}
              </blockquote>
            ) : v.transcriptStatus === 'failed' ? (
              <p className="text-[13px] text-warn">{t('transcriptFailed')}</p>
            ) : null}
          </div>
        ))}
      </section>

      {docs.length ? (
        <section aria-label={t('documents')}>
          <h3 className="mb-2 text-[13px] font-semibold text-muted">{t('documents')}</h3>
          <ul className="flex flex-col gap-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <a href={d.url} target="_blank" rel="noreferrer" className="truncate text-[14px] underline">
                  {d.fileName}
                </a>
                {canWrite ? (
                  <DeleteButton label={`${tc('delete')} ${d.fileName}`} onClick={() => setDeleting(d)} />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {viewing ? (
        <dialog
          open
          aria-label={viewing.fileName}
          className="fixed inset-0 z-50 m-0 flex size-full max-h-none max-w-none flex-col bg-black/90 p-4 text-white"
          onKeyDown={(e) => e.key === 'Escape' && setViewing(null)}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-[14px]">{viewing.fileName}</span>
            <div className="flex gap-2">
              {canWrite ? (
                <Button
                  variant="ghost"
                  className="text-white hover:bg-white/10"
                  onClick={() => {
                    setDeleting(viewing);
                    setViewing(null);
                  }}
                >
                  {tc('delete')}
                </Button>
              ) : null}
              <Button variant="inverse" onClick={() => setViewing(null)} autoFocus>
                {tc('close')}
              </Button>
            </div>
          </div>
          <img
            src={viewing.url}
            alt={viewing.caption ?? viewing.fileName}
            className="m-auto max-h-[85vh] max-w-full object-contain"
          />
        </dialog>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        loading={remove.isPending}
        title={t('deleteTitle')}
        description={deleting?.fileName}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
      />
    </Card>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-crit focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Trash2 aria-hidden className="size-4" />
    </button>
  );
}
