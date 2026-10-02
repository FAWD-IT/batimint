'use client';

import type { PlanningDto, PlanningSlotDto } from '@batimint/contracts';
import { type Half, isValidRange } from '@batimint/domain';
import { Button, Dialog, SelectField, TextAreaField, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';

export interface SlotDraft {
  projectId: string;
  resource: string; // « t:<id> » ou « e:<id> »
  taskId: string;
  startDay: string;
  startHalf: Half;
  endDay: string;
  endHalf: Half;
  note: string;
}

export function draftOf(slot: PlanningSlotDto): SlotDraft {
  return {
    projectId: slot.projectId,
    resource: slot.teamId ? `t:${slot.teamId}` : `e:${slot.employeeId}`,
    taskId: slot.taskId ?? '',
    startDay: slot.startDay,
    startHalf: slot.startHalf,
    endDay: slot.endDay,
    endHalf: slot.endHalf,
    note: slot.note ?? '',
  };
}

/**
 * Affectation au clavier (alternative au glisser-déposer) : chantier, équipe ou personne, tâche,
 * début et fin à la demi-journée, note. Les conflits sont signalés après l'enregistrement.
 */
export function SlotDialog({
  data,
  initial,
  editing,
  onClose,
  onSave,
  onDelete,
  pending,
}: {
  data: PlanningDto;
  initial: SlotDraft;
  editing: PlanningSlotDto | null;
  onClose: () => void;
  onSave: (draft: SlotDraft) => void;
  onDelete?: () => void;
  pending: boolean;
}) {
  const t = useTranslations('planning.dialog');
  const tc = useTranslations('common');
  const [d, setD] = useState<SlotDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<SlotDraft>) => setD((x) => ({ ...x, ...patch }));
  const tasks = [
    ...(editing?.taskId && editing.taskTitle && editing.projectId === d.projectId
      ? [{ id: editing.taskId, title: editing.taskTitle }]
      : []),
    ...data.unplannedTasks.filter((x) => x.projectId === d.projectId),
  ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!d.projectId || !d.resource) return setError(t('required'));
    if (!d.startDay || !d.endDay || !isValidRange(d)) return setError(t('range'));
    onSave(d);
  };

  const halves = [
    { value: 'am', label: t('am') },
    { value: 'pm', label: t('pm') },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? t('editTitle') : t('newTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          {editing && onDelete ? (
            <Button variant="ghost" onClick={onDelete} className="mr-auto text-crit">
              {t('delete')}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="slot-form" loading={pending}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="slot-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <SelectField
          label={t('project')}
          value={d.projectId}
          onChange={(e) => set({ projectId: e.target.value, taskId: '' })}
          options={[
            { value: '', label: t('choose') },
            ...data.projects.map((p) => ({ value: p.id, label: `${p.shortLabel} — ${p.name}` })),
          ]}
        />
        <SelectField
          label={t('resource')}
          value={d.resource}
          onChange={(e) => set({ resource: e.target.value })}
          options={[
            { value: '', label: t('choose') },
            ...data.teams.map((x) => ({ value: `t:${x.id}`, label: t('team', { name: x.name }) })),
            ...data.employees.map((x) => ({ value: `e:${x.id}`, label: x.name })),
          ]}
        />
        <SelectField
          label={t('task')}
          value={d.taskId}
          onChange={(e) => set({ taskId: e.target.value })}
          options={[
            { value: '', label: t('noTask') },
            ...tasks.map((x) => ({ value: x.id, label: x.title })),
          ]}
        />
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <TextField
            label={t('start')}
            type="date"
            value={d.startDay}
            onChange={(e) =>
              set({
                startDay: e.target.value,
                ...(e.target.value > d.endDay ? { endDay: e.target.value } : {}),
              })
            }
          />
          <SelectField
            label={t('startHalf')}
            value={d.startHalf}
            onChange={(e) => set({ startHalf: e.target.value as Half })}
            options={halves}
          />
          <TextField
            label={t('end')}
            type="date"
            value={d.endDay}
            onChange={(e) => set({ endDay: e.target.value })}
          />
          <SelectField
            label={t('endHalf')}
            value={d.endHalf}
            onChange={(e) => set({ endHalf: e.target.value as Half })}
            options={halves}
          />
        </div>
        <TextAreaField
          label={t('note')}
          value={d.note}
          onChange={(e) => set({ note: e.target.value })}
          rows={2}
          maxLength={500}
        />
        {error ? (
          <p role="alert" className="text-[13px] text-crit">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
