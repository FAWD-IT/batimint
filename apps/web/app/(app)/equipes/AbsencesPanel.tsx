'use client';

import type { EmployeeDto } from '@batimint/contracts';
import { Button, Chip, Dialog, EmptyState, SelectField, Skeleton, TextField } from '@batimint/ui';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';

interface Absence {
  id: string;
  employeeId: string;
  kind: 'leave' | 'sick' | 'training' | 'public_holiday' | 'other';
  startsOn: string;
  endsOn: string;
  halfDay: 'am' | 'pm' | null;
  note: string | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function AbsencesPanel({ employees, canManage }: { employees: EmployeeDto[]; canManage: boolean }) {
  const t = useTranslations('people');
  const tc = useTranslations('common');
  const format = useFormatter();
  const today = new Date();
  const from = isoDay(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
  const to = isoDay(new Date(Date.UTC(today.getFullYear(), today.getMonth() + 3, 0)));
  const { data, isLoading } = useApi<{ items: Absence[] }>(
    ['absences', from, to],
    `/absences?from=${from}&to=${to}`,
  );
  const [open, setOpen] = useState(false);
  const remove = useApiMutation<string>((id) => ({ path: `/absences/${id}`, method: 'DELETE' }), {
    invalidate: [['absences']],
    successMessage: t('absenceDeleted'),
  });
  const byId = new Map(employees.map((e) => [e.id, e]));
  if (isLoading) return <Skeleton className="h-48" />;
  const items = data?.items ?? [];
  const range = (a: Absence) =>
    a.startsOn === a.endsOn
      ? format.dateTime(new Date(`${a.startsOn}T12:00:00Z`), { dateStyle: 'medium' })
      : format.dateTimeRange(new Date(`${a.startsOn}T12:00:00Z`), new Date(`${a.endsOn}T12:00:00Z`), {
          dateStyle: 'medium',
        });
  return (
    <div className="flex flex-col gap-4">
      {canManage && employees.length > 0 ? (
        <Button
          className="self-start"
          variant="secondary"
          icon={<Plus aria-hidden className="size-4" />}
          onClick={() => setOpen(true)}
        >
          {t('addAbsence')}
        </Button>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon={<CalendarOff aria-hidden className="size-5" />}
          title={t('absences')}
          description={t('absencesEmpty')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => {
            const e = byId.get(a.employeeId);
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-surface px-4 py-3"
              >
                <Chip tone={a.kind === 'sick' ? 'warn' : 'neutral'}>{t(`kinds.${a.kind}`)}</Chip>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{e ? `${e.firstName} ${e.lastName}` : '—'}</div>
                  <div className="text-[13px] text-muted">
                    {range(a)}
                    {a.halfDay ? ` · ${t(a.halfDay)}` : ''}
                    {a.note ? ` · ${a.note}` : ''}
                  </div>
                </div>
                {canManage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${tc('delete')} — ${t(`kinds.${a.kind}`)}`}
                    onClick={() => remove.mutate(a.id)}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {open ? <AbsenceDialog employees={employees} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function AbsenceDialog({ employees, onClose }: { employees: EmployeeDto[]; onClose: () => void }) {
  const t = useTranslations('people');
  const tc = useTranslations('common');
  const today = isoDay(new Date());
  const [v, setV] = useState({
    employeeId: employees[0]?.id ?? '',
    kind: 'leave',
    startsOn: today,
    endsOn: today,
    halfDay: '',
    note: '',
  });
  const save = useApiMutation<typeof v>(
    (x) => ({
      path: `/employees/${x.employeeId}/absences`,
      body: {
        kind: x.kind,
        startsOn: x.startsOn,
        endsOn: x.endsOn,
        halfDay: x.halfDay || null,
        note: x.note || null,
      },
    }),
    { invalidate: [['absences']], successMessage: t('absenceSaved'), onSuccess: onClose },
  );
  const invalid = v.endsOn < v.startsOn;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!invalid) save.mutate(v);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('addAbsence')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button type="submit" form="absence-form" loading={save.isPending} disabled={invalid}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="absence-form" onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('employees')}
          value={v.employeeId}
          onChange={(e) => setV({ ...v, employeeId: e.target.value })}
          options={employees.map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName}` }))}
        />
        <SelectField
          label={t('absenceKind')}
          value={v.kind}
          onChange={(e) => setV({ ...v, kind: e.target.value })}
          options={(['leave', 'sick', 'training', 'public_holiday', 'other'] as const).map((k) => ({
            value: k,
            label: t(`kinds.${k}`),
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('from')}
            type="date"
            value={v.startsOn}
            onChange={(e) =>
              setV({
                ...v,
                startsOn: e.target.value,
                endsOn: e.target.value > v.endsOn ? e.target.value : v.endsOn,
              })
            }
          />
          <TextField
            label={t('to')}
            type="date"
            value={v.endsOn}
            min={v.startsOn}
            onChange={(e) => setV({ ...v, endsOn: e.target.value })}
            error={invalid ? 'La fin doit suivre le début.' : null}
          />
        </div>
        <SelectField
          label={t('halfDay')}
          value={v.halfDay}
          onChange={(e) => setV({ ...v, halfDay: e.target.value })}
          options={[
            { value: '', label: t('fullDay') },
            { value: 'am', label: t('am') },
            { value: 'pm', label: t('pm') },
          ]}
        />
        <TextField
          label={t('note')}
          optionalLabel={tc('optional')}
          value={v.note}
          onChange={(e) => setV({ ...v, note: e.target.value })}
        />
      </form>
    </Dialog>
  );
}
