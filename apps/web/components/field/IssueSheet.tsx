'use client';

import type { FieldTodayDto } from '@batimint/contracts';
import { Button, Dialog, SelectField, Switch, TextAreaField, TextField, useToast } from '@batimint/ui';
import { Camera, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { currentPosition, useField } from './FieldProvider';

/**
 * Signaler un problème (02 P4.4) : un titre, éventuellement une description, la tâche
 * concernée et des photos. Part tout de suite ou dès que le réseau revient ; le bureau est
 * alerté et peut en faire un avenant en un clic.
 */
export function IssueSheet({
  open,
  onClose,
  projectId,
  tasks,
  queuePhotos,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  tasks: FieldTodayDto['tasks'];
  queuePhotos: (
    files: File[],
    to: { ownerType: 'issue'; ownerId: string; projectId: string; taskId: string | null },
  ) => Promise<void>;
}) {
  const t = useTranslations('field.issue');
  const tc = useTranslations('common');
  const f = useField();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setUrgent(false);
    setTaskId('');
    setFiles([]);
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3) {
      setError(t('titleRequired'));
      return;
    }
    setPending(true);
    try {
      const id = uuidv7();
      const pos = await currentPosition();
      // Les photos attendent dans la file que le signalement soit arrivé (même passe de synchro).
      await queuePhotos(files, { ownerType: 'issue', ownerId: id, projectId, taskId: taskId || null });
      await f.enqueue({
        type: 'issue',
        id,
        data: {
          id,
          projectId,
          taskId: taskId || null,
          title: title.trim(),
          description: description.trim() || null,
          urgent,
          at: new Date().toISOString(),
          latitude: pos?.latitude ?? null,
          longitude: pos?.longitude ?? null,
        },
      });
      toast.show({ title: f.online ? t('sent') : t('savedOffline'), tone: 'good' });
      reset();
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('title')}
      description={t('subtitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="field-issue" loading={pending} size="lg">
            {t('submit')}
          </Button>
        </>
      }
    >
      <form id="field-issue" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <TextField
          label={t('what')}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          placeholder={t('whatPlaceholder')}
          error={error ?? undefined}
          maxLength={200}
          required
        />
        <TextAreaField
          label={t('details')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={2000}
        />
        {tasks.length ? (
          <SelectField
            label={t('task')}
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            options={[
              { value: '', label: t('noTask') },
              ...tasks.map((task) => ({ value: task.id, label: task.title })),
            ]}
          />
        ) : null}
        <Switch checked={urgent} onChange={setUrgent} label={t('urgent')} description={t('urgentHint')} />
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="issue-photo-input"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              setFiles((prev) => [...prev, ...list].slice(0, 6));
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            icon={<Camera aria-hidden className="size-5" />}
            onClick={() => input.current?.click()}
          >
            {t('addPhoto')}
          </Button>
          {previews.length ? (
            <ul className="grid grid-cols-3 gap-2" aria-label={t('photos', { n: previews.length })}>
              {previews.map((src, i) => (
                <li key={src} className="relative">
                  <img src={src} alt="" className="aspect-square w-full rounded-[10px] object-cover" />
                  <button
                    type="button"
                    aria-label={t('removePhoto', { n: i + 1 })}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-full bg-black/60 text-white"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
