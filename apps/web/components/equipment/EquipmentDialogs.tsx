'use client';

import type { EquipmentDto, MaintenanceDto, ProjectDto, ProjectSummaryDto } from '@batimint/contracts';
import { brusselsDate } from '@batimint/domain';
import {
  Button,
  Chip,
  Dialog,
  Segmented,
  SelectField,
  TextAreaField,
  TextField,
  type Tone,
} from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { useApi, useApiMutation } from '@/lib/hooks';

export const EQUIPMENT_INVALIDATE = [['equipment'], ['project'], ['timeline']];

export const dayFr = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

const STATUS_TONE: Record<'ok' | 'due_soon' | 'overdue', Tone> = {
  ok: 'neutral',
  due_soon: 'warn',
  overdue: 'crit',
};

export function MaintenanceChip({ m }: { m: MaintenanceDto | null }) {
  const t = useTranslations('equipment');
  if (!m) return <span className="text-[13px] text-muted">{t('noMaintenance')}</span>;
  const status = m.status ?? 'ok';
  return (
    <span className="flex flex-col items-start gap-1">
      <Chip tone={STATUS_TONE[status]} dot={status !== 'ok'}>
        {t(`status.${status}`, { date: dayFr(m.dueOn) })}
      </Chip>
      <span className="text-[12px] text-muted">{m.label}</span>
    </span>
  );
}

function Footer({
  onClose,
  onSave,
  saving,
  label,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  label: string;
}) {
  const tc = useTranslations('common');
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        {tc('cancel')}
      </Button>
      <Button loading={saving} onClick={onSave}>
        {label}
      </Button>
    </>
  );
}

export function EquipmentDialog({
  equipment,
  onClose,
  onSaved,
}: {
  equipment: EquipmentDto | null;
  onClose: () => void;
  onSaved?: (e: EquipmentDto) => void;
}) {
  const t = useTranslations('equipment.form');
  const tc = useTranslations('common');
  const [id] = useState(() => equipment?.id ?? uuidv7());
  const [form, setForm] = useState({
    name: equipment?.name ?? '',
    code: equipment?.code ?? '',
    category: equipment?.category ?? '',
    serialNumber: equipment?.serialNumber ?? '',
    dailyCost: equipment?.dailyCost ?? 0,
    purchasedOn: equipment?.purchasedOn ?? '',
    notes: equipment?.notes ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const error = form.name.trim().length < 2 ? t('errors.name') : null;
  const save = useApiMutation<void, EquipmentDto>(
    () => ({
      path: `/equipment/${id}`,
      method: 'PUT',
      body: {
        id,
        name: form.name.trim(),
        code: form.code.trim() || null,
        category: form.category.trim() || null,
        serialNumber: form.serialNumber.trim() || null,
        dailyCost: form.dailyCost,
        purchasedOn: form.purchasedOn || null,
        notes: form.notes.trim() || null,
      },
    }),
    { invalidate: [['equipment']], successMessage: t('saved'), onSuccess: (e) => (onSaved ?? onClose)(e) },
  );
  const submit = () => {
    setSubmitted(true);
    if (!error) save.mutate();
  };
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open
      onClose={onClose}
      title={equipment ? t('editTitle') : t('title')}
      closeLabel={tc('close')}
      footer={<Footer onClose={onClose} onSave={submit} saving={save.isPending} label={t('save')} />}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextField
          label={t('name')}
          placeholder={t('namePlaceholder')}
          value={form.name}
          onChange={set('name')}
          error={submitted ? error : null}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('category')}
            placeholder={t('categoryPlaceholder')}
            value={form.category}
            optionalLabel={tc('optional')}
            onChange={set('category')}
          />
          <MoneyInput
            label={t('dailyCost')}
            cents={form.dailyCost}
            hint={t('dailyCostHint')}
            onChange={(c) => setForm((f) => ({ ...f, dailyCost: c }))}
          />
          <TextField
            label={t('code')}
            value={form.code}
            optionalLabel={tc('optional')}
            onChange={set('code')}
          />
          <TextField
            label={t('serial')}
            value={form.serialNumber}
            optionalLabel={tc('optional')}
            onChange={set('serialNumber')}
          />
          <TextField
            label={t('purchasedOn')}
            type="date"
            value={form.purchasedOn}
            optionalLabel={tc('optional')}
            onChange={set('purchasedOn')}
          />
        </div>
        <TextAreaField
          label={t('notes')}
          rows={2}
          value={form.notes}
          optionalLabel={tc('optional')}
          onChange={set('notes')}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function AssignDialog({ equipment, onClose }: { equipment: EquipmentDto; onClose: () => void }) {
  const t = useTranslations('equipment.assign');
  const tc = useTranslations('common');
  const [id] = useState(() => uuidv7());
  const [projectId, setProjectId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [startDate, setStartDate] = useState(() => brusselsDate(new Date()));
  const [endDate, setEndDate] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const projects = useApi<{ items: ProjectSummaryDto[] }>(
    ['projects', 'list', 'active'],
    '/projects?view=active',
  );
  const project = useApi<ProjectDto>(['project', projectId], projectId ? `/projects/${projectId}` : null);
  const errors = {
    project: !projectId ? t('errors.project') : null,
    dates: endDate && endDate < startDate ? t('errors.dates') : null,
  };
  const save = useApiMutation<void, EquipmentDto>(
    () => ({
      path: `/equipment/${equipment.id}/assignments`,
      method: 'POST',
      body: { id, projectId, budgetLineId: budgetLineId || null, startDate, endDate: endDate || null },
    }),
    { invalidate: EQUIPMENT_INVALIDATE, successMessage: t('saved'), onSuccess: onClose },
  );
  const submit = () => {
    setSubmitted(true);
    if (!errors.project && !errors.dates) save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { name: equipment.name })}
      closeLabel={tc('close')}
      footer={<Footer onClose={onClose} onSave={submit} saving={save.isPending} label={t('save')} />}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <SelectField
          label={t('project')}
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setBudgetLineId('');
          }}
          options={[
            { value: '', label: t('chooseProject') },
            ...(projects.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.number} · ${p.name}` })),
          ]}
          error={submitted ? errors.project : null}
        />
        {projectId ? (
          <SelectField
            label={t('post')}
            value={budgetLineId}
            onChange={(e) => setBudgetLineId(e.target.value)}
            options={[
              { value: '', label: t('noPost') },
              ...(project.data?.budgetLines ?? []).map((b) => ({ value: b.id, label: b.label })),
            ]}
          />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('start')}
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <TextField
            label={t('end')}
            type="date"
            value={endDate}
            optionalLabel={tc('optional')}
            onChange={(e) => setEndDate(e.target.value)}
            error={submitted ? errors.dates : null}
          />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ReturnDialog({
  equipment,
  assignmentId,
  startDate,
  onClose,
}: {
  equipment: EquipmentDto;
  assignmentId: string;
  startDate: string;
  onClose: () => void;
}) {
  const t = useTranslations('equipment.returnDialog');
  const ta = useTranslations('equipment.assign');
  const tc = useTranslations('common');
  const today = brusselsDate(new Date());
  const [endDate, setEndDate] = useState(today < startDate ? startDate : today);
  const invalid = endDate < startDate;
  const save = useApiMutation<void, EquipmentDto>(
    () => ({ path: `/equipment-assignments/${assignmentId}/return`, method: 'POST', body: { endDate } }),
    { invalidate: EQUIPMENT_INVALIDATE, successMessage: t('saved'), onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { name: equipment.name })}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <Footer
          onClose={onClose}
          onSave={() => !invalid && save.mutate()}
          saving={save.isPending}
          label={t('save')}
        />
      }
    >
      <TextField
        label={t('end')}
        type="date"
        value={endDate}
        min={startDate}
        onChange={(e) => setEndDate(e.target.value)}
        error={invalid ? ta('errors.dates') : null}
      />
    </Dialog>
  );
}

export function MaintenanceDialog({ equipment, onClose }: { equipment: EquipmentDto; onClose: () => void }) {
  const t = useTranslations('equipment.plan');
  const tk = useTranslations('equipment.maintenance.kinds');
  const tc = useTranslations('common');
  const [id] = useState(() => uuidv7());
  const [kind, setKind] = useState<'maintenance' | 'inspection'>('maintenance');
  const [label, setLabel] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [interval, setIntervalText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    label: label.trim().length < 2 ? t('errors.label') : null,
    dueOn: !dueOn ? t('errors.dueOn') : null,
  };
  const months = /^\d+$/.test(interval.trim()) ? Number(interval.trim()) : null;
  const save = useApiMutation<void, EquipmentDto>(
    () => ({
      path: `/equipment/${equipment.id}/maintenance`,
      method: 'POST',
      body: { id, kind, label: label.trim(), dueOn, intervalMonths: months },
    }),
    { invalidate: [['equipment']], successMessage: t('saved'), onSuccess: onClose },
  );
  const submit = () => {
    setSubmitted(true);
    if (!errors.label && !errors.dueOn) save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      footer={<Footer onClose={onClose} onSave={submit} saving={save.isPending} label={t('save')} />}
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label={t('kind')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'maintenance', label: tk('maintenance') },
            { value: 'inspection', label: tk('inspection') },
          ]}
        />
        <TextField
          label={t('label')}
          placeholder={t('labelPlaceholder')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          error={submitted ? errors.label : null}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('dueOn')}
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            error={submitted ? errors.dueOn : null}
          />
          <TextField
            label={t('interval')}
            inputMode="numeric"
            value={interval}
            hint={t('intervalHint')}
            optionalLabel={tc('optional')}
            onChange={(e) => setIntervalText(e.target.value)}
          />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function MaintenanceDoneDialog({
  maintenance,
  onClose,
}: {
  maintenance: MaintenanceDto;
  onClose: () => void;
}) {
  const t = useTranslations('equipment.doneDialog');
  const tc = useTranslations('common');
  const [doneOn, setDoneOn] = useState(() => brusselsDate(new Date()));
  const [cost, setCost] = useState(0);
  const [notes, setNotes] = useState('');
  const save = useApiMutation<void, EquipmentDto>(
    () => ({
      path: `/maintenance/${maintenance.id}/done`,
      method: 'POST',
      body: { doneOn, cost: cost || null, notes: notes.trim() || null },
    }),
    { invalidate: [['equipment']], successMessage: t('saved'), onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { label: maintenance.label })}
      closeLabel={tc('close')}
      footer={
        <Footer onClose={onClose} onSave={() => save.mutate()} saving={save.isPending} label={t('save')} />
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('doneOn')}
            type="date"
            value={doneOn}
            onChange={(e) => setDoneOn(e.target.value)}
          />
          <MoneyInput label={t('cost')} cents={cost} onChange={setCost} />
        </div>
        <TextAreaField
          label={t('notes')}
          rows={2}
          value={notes}
          optionalLabel={tc('optional')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Dialog>
  );
}
