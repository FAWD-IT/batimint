'use client';

import type { AttachmentDto, ProjectDto, TaskDto } from '@batimint/contracts';
import { formatQuantity, percentInt } from '@batimint/domain';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  cn,
  Dialog,
  Drawer,
  EmptyState,
  Gauge,
  Segmented,
  SelectField,
  Skeleton,
  TextAreaField,
  TextField,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Circle, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { formatDay } from './status';
import { PhotoUploadButton } from './MediaTab';

const PROGRESS_STEPS = [0, 25, 50, 75, 100] as const;

/** Paliers proposés, plus la valeur réelle si elle tombe entre deux (pointage, import…). */
function progressOptions(current: number): number[] {
  return [...new Set<number>([...PROGRESS_STEPS, current])].sort((a, b) => a - b);
}

type TaskPatch = Partial<{
  status: TaskDto['status'];
  progressPercent: number;
  title: string;
  description: string | null;
  assigneeEmployeeId: string | null;
  dueDate: string | null;
  checklist: TaskDto['checklist'];
}>;

function useTaskUpdate(projectId: string) {
  const queryClient = useQueryClient();
  return useApiMutation<{ id: string; patch: TaskPatch }, TaskDto>(
    ({ id, patch }) => ({ path: `/projects/${projectId}/tasks/${id}`, method: 'PATCH', body: patch }),
    {
      onSuccess: (task) => {
        queryClient.setQueryData<{ items: TaskDto[] }>(['tasks', projectId], (old) =>
          old ? { items: old.items.map((x) => (x.id === task.id ? task : x)) } : old,
        );
        void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      },
    },
  );
}

export function TasksTab({ project }: { project: ProjectDto }) {
  const t = useTranslations('projects.tasks');
  const can = useCan();
  const tasks = useApi<{ items: TaskDto[] }>(['tasks', project.id], `/projects/${project.id}/tasks`);
  const update = useTaskUpdate(project.id);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null | undefined>(undefined);
  if (tasks.isLoading) return <Skeleton className="h-72" />;
  const items = tasks.data?.items ?? [];
  const groups = [
    ...project.budgetLines.map((l) => ({ id: l.id as string | null, label: l.label, line: l })),
    ...(items.some((x) => !x.budgetLineId) ? [{ id: null, label: t('noPost'), line: null }] : []),
  ];
  const current = items.find((x) => x.id === open) ?? null;
  if (items.length === 0 && !can('projects.write'))
    return <EmptyState icon={<ListChecks aria-hidden className="size-5" />} title={t('emptyAll')} />;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => {
        const list = items.filter((x) => x.budgetLineId === g.id);
        const pct = g.line ? percentInt(g.line.progress) : null;
        return (
          <Card
            key={g.id ?? 'none'}
            className="flex flex-col gap-3 p-4 md:p-5"
            role="group"
            aria-label={g.label}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{g.label}</h3>
              {pct !== null ? (
                <div className="flex w-48 items-center gap-2">
                  <Gauge
                    value={pct / 100}
                    tone={g.line?.drift ? 'warn' : 'ink'}
                    height={6}
                    label={`${g.label} ${pct} %`}
                  />
                  <span className="w-12 shrink-0 text-right text-[13px] tabular-nums">{pct} %</span>
                </div>
              ) : null}
              {can('projects.write') ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Plus aria-hidden className="size-4" />}
                  aria-label={t('addTo', { post: g.label })}
                  onClick={() => setAdding(g.id)}
                >
                  <span className="hidden sm:inline">{t('add')}</span>
                </Button>
              ) : null}
            </div>
            {list.length === 0 ? (
              <p className="text-[14px] text-muted">{t('empty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {list.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onToggle={() =>
                      update.mutate({
                        id: task.id,
                        patch: { status: task.status === 'done' ? 'todo' : 'done' },
                      })
                    }
                    onProgress={(p) => update.mutate({ id: task.id, patch: { progressPercent: p } })}
                    onOpen={() => setOpen(task.id)}
                    disabled={!can('tasks.update')}
                  />
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {current ? <TaskDrawer project={project} task={current} onClose={() => setOpen(null)} /> : null}
      {adding !== undefined ? (
        <NewTaskDialog project={project} budgetLineId={adding} onClose={() => setAdding(undefined)} />
      ) : null}
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onProgress,
  onOpen,
  disabled,
}: {
  task: TaskDto;
  onToggle: () => void;
  onProgress: (p: number) => void;
  onOpen: () => void;
  disabled: boolean;
}) {
  const t = useTranslations('projects.tasks');
  const done = task.status === 'done';
  const pct = percentInt(task.progress);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? t('markTodo', { title: task.title }) : t('markDone', { title: task.title })}
        disabled={disabled}
        onClick={onToggle}
        className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
      >
        {done ? (
          <CheckCircle2 aria-hidden className="size-6 text-good" />
        ) : (
          <Circle aria-hidden className="size-6" />
        )}
      </button>
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('open', { title: task.title })}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className={cn('truncate text-[15px]', done && 'text-muted line-through')}>{task.title}</span>
        <span className="flex flex-wrap gap-x-2 text-[12px] text-muted">
          {task.quantity && task.unit ? (
            <span>{t('quantity', { quantity: formatQuantity(task.quantity), unit: task.unit })}</span>
          ) : null}
          {task.assignee ? <span>{task.assignee.name}</span> : null}
          {task.dueDate ? <span>{formatDay(task.dueDate)}</span> : null}
          {task.checklist.length ? (
            <span>
              {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
            </span>
          ) : null}
          {task.photoCount ? (
            <span className="inline-flex items-center gap-1">
              <Camera aria-hidden className="size-3" />
              {t('photoCount', { n: task.photoCount })}
            </span>
          ) : null}
        </span>
      </button>
      {!done ? (
        <select
          aria-label={t('progressOf', { title: task.title })}
          value={pct}
          disabled={disabled}
          onChange={(e) => onProgress(Number(e.target.value))}
          className="h-9 rounded-[8px] border border-line bg-surface px-2 text-[13px] tabular-nums"
        >
          {progressOptions(pct).map((s) => (
            <option key={s} value={s}>
              {s} %
            </option>
          ))}
        </select>
      ) : (
        <Chip tone="good">{t('status.done')}</Chip>
      )}
    </li>
  );
}

function NewTaskDialog({
  project,
  budgetLineId,
  onClose,
}: {
  project: ProjectDto;
  budgetLineId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('projects.tasks');
  const tc = useTranslations('common');
  const [title, setTitle] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [id] = useState(() => uuidv7());
  const create = useApiMutation<void, TaskDto>(
    () => ({ path: `/projects/${project.id}/tasks`, body: { id, budgetLineId, title: title.trim() } }),
    {
      invalidate: [
        ['tasks', project.id],
        ['project', project.id],
      ],
      successMessage: t('saved'),
      onSuccess: onClose,
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 2) return setInvalid(true);
    create.mutate();
  };
  const post = project.budgetLines.find((l) => l.id === budgetLineId)?.label ?? t('noPost');
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('addTo', { post })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="new-task" loading={create.isPending}>
            {tc('add')}
          </Button>
        </>
      }
    >
      <form id="new-task" noValidate onSubmit={submit}>
        <TextField
          label={t('titleLabel')}
          value={title}
          autoFocus
          error={invalid ? t('titleLabel') : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            setInvalid(false);
          }}
        />
      </form>
    </Dialog>
  );
}

function TaskDrawer({ project, task, onClose }: { project: ProjectDto; task: TaskDto; onClose: () => void }) {
  const t = useTranslations('projects.tasks');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const update = useTaskUpdate(project.id);
  const people = useApi<{ employees: { id: string; name: string }[] }>(
    ['projects', 'people'],
    '/projects/people',
  );
  const photos = useApi<{ items: AttachmentDto[] }>(
    ['attachments', 'project', project.id, 'task', task.id],
    `/attachments?ownerType=project&ownerId=${project.id}&taskId=${task.id}&kind=photo`,
  );
  const remove = useApiMutation<void>(
    () => ({ path: `/projects/${project.id}/tasks/${task.id}`, method: 'DELETE' }),
    {
      invalidate: [
        ['tasks', project.id],
        ['project', project.id],
      ],
      successMessage: t('deleted'),
      onSuccess: onClose,
    },
  );
  const office = can('projects.write');
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? '',
    assigneeEmployeeId: task.assignee?.id ?? '',
    dueDate: task.dueDate ?? '',
  });
  const [newItem, setNewItem] = useState('');
  const patch = (p: TaskPatch) => update.mutate({ id: task.id, patch: p });
  const pct = percentInt(task.progress);
  const dirty =
    form.title !== task.title ||
    form.description !== (task.description ?? '') ||
    form.assigneeEmployeeId !== (task.assignee?.id ?? '') ||
    form.dueDate !== (task.dueDate ?? '');
  return (
    <Drawer
      open
      onClose={onClose}
      title={task.title}
      description={task.fromQuote ? t('fromContract') : undefined}
      closeLabel={tc('close')}
      footer={
        office ? (
          <>
            {!task.fromQuote ? (
              <Button
                variant="ghost"
                icon={<Trash2 aria-hidden className="size-4" />}
                loading={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {t('delete')}
              </Button>
            ) : null}
            <Button
              disabled={!dirty}
              loading={update.isPending}
              onClick={() =>
                patch({
                  title: form.title.trim(),
                  description: form.description,
                  assigneeEmployeeId: form.assigneeEmployeeId || null,
                  dueDate: form.dueDate || null,
                })
              }
            >
              {tc('save')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        {update.error ? <p className="text-[13px] text-crit">{errorMessage(update.error)}</p> : null}
        <Segmented<TaskDto['status']>
          label={tc('status')}
          value={task.status}
          onChange={(status) => can('tasks.update') && patch({ status })}
          options={(['todo', 'in_progress', 'done'] as const).map((s) => ({
            value: s,
            label: t(`status.${s}`),
          }))}
        />
        {task.status !== 'done' ? (
          <SelectField
            label={t('progressOf', { title: task.title })}
            value={String(
              PROGRESS_STEPS.reduce((b, s) => (Math.abs(s - pct) < Math.abs(b - pct) ? s : b), 0),
            )}
            disabled={!can('tasks.update')}
            onChange={(e) => patch({ progressPercent: Number(e.target.value) })}
            options={PROGRESS_STEPS.map((s) => ({ value: String(s), label: `${s} %` }))}
          />
        ) : null}
        {office ? (
          <>
            <TextField
              label={t('titleLabel')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t('assignee')}
                value={form.assigneeEmployeeId}
                onChange={(e) => setForm({ ...form, assigneeEmployeeId: e.target.value })}
                options={[
                  { value: '', label: t('unassigned') },
                  ...(people.data?.employees ?? []).map((e) => ({ value: e.id, label: e.name })),
                ]}
              />
              <TextField
                label={t('dueDate')}
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <TextAreaField
              label={t('description')}
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </>
        ) : (
          <dl className="grid gap-2 text-[14px]">
            <div>
              <dt className="text-muted">{t('assignee')}</dt>
              <dd>{task.assignee?.name ?? t('unassigned')}</dd>
            </div>
            {task.description ? (
              <div>
                <dt className="text-muted">{t('description')}</dt>
                <dd className="whitespace-pre-wrap">{task.description}</dd>
              </div>
            ) : null}
          </dl>
        )}
        <section className="flex flex-col gap-2" aria-labelledby={`checklist-${task.id}`}>
          <h3 id={`checklist-${task.id}`} className="text-[14px] font-semibold">
            {t('checklist')}
          </h3>
          <ul className="flex flex-col">
            {task.checklist.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2">
                <Checkbox
                  label={c.label}
                  checked={c.done}
                  disabled={!can('tasks.update')}
                  className="flex-1"
                  onChange={(e) =>
                    patch({
                      checklist: task.checklist.map((x) =>
                        x.id === c.id ? { ...x, done: e.target.checked } : x,
                      ),
                    })
                  }
                />
                {can('tasks.update') ? (
                  <button
                    type="button"
                    aria-label={t('checklistRemove', { label: c.label || t('checklistItem', { n: i + 1 }) })}
                    onClick={() => patch({ checklist: task.checklist.filter((x) => x.id !== c.id) })}
                    className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-crit"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {can('tasks.update') ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newItem.trim()) return;
                patch({
                  checklist: [
                    ...task.checklist,
                    { id: uuidv7().slice(-12), label: newItem.trim(), done: false },
                  ],
                });
                setNewItem('');
              }}
            >
              <TextField
                label={t('checklistAdd')}
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                containerClassName="flex-1"
              />
              <Button type="submit" variant="secondary" className="self-end" disabled={!newItem.trim()}>
                {tc('add')}
              </Button>
            </form>
          ) : null}
        </section>
        <section className="flex flex-col gap-2" aria-labelledby={`photos-${task.id}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 id={`photos-${task.id}`} className="text-[14px] font-semibold">
              {t('photos')}
            </h3>
            {can('tasks.update') ? (
              <PhotoUploadButton projectId={project.id} taskId={task.id} compact />
            ) : null}
          </div>
          {(photos.data?.items ?? []).length ? (
            <ul className="grid grid-cols-3 gap-2">
              {photos.data!.items.map((ph) => (
                <li key={ph.id}>
                  <a
                    href={ph.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-[10px]"
                  >
                    <img
                      src={ph.url}
                      alt={ph.caption ?? ph.fileName}
                      className="aspect-square w-full object-cover"
                    />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}
