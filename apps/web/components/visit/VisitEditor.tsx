'use client';

import { Button, Card, CardTitle, Checkbox, Chip, TextAreaField, TextField } from '@batimint/ui';
import { Check, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SaveBar } from '@/components/SaveBar';
import { useApiMutation } from '@/lib/hooks';
import { useFormState } from '@/lib/use-form-state';

export interface Visit {
  id: string;
  opportunityId: string;
  scheduledAt: string | null;
  visitedAt: string | null;
  visitorEmployeeId: string | null;
  trade: string | null;
  measurements: { label: string; value: string; unit: string }[];
  checklist: { label: string; done: boolean }[];
  notes: string | null;
}

const UNITS = ['m', 'm²', 'm³', 'cm', 'mm', 'pc', 'l', '°'];
const TEMPLATES = ['bathroom', 'roof', 'electrical', 'general'] as const;

/** Convertit une date ISO en valeur d'un champ datetime-local (heure locale). */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Visite technique, pensée pour le téléphone (P2.2) : gros boutons, mesures en ligne,
 * points à vérifier par modèle de métier, notes. Les photos et notes vocales sont à côté.
 */
export function VisitEditor({ visit, canWrite }: { visit: Visit; canWrite: boolean }) {
  const t = useTranslations('visit');
  const tc = useTranslations('common');
  const source = {
    scheduledAt: toLocalInput(visit.scheduledAt),
    measurements: visit.measurements,
    checklist: visit.checklist,
    notes: visit.notes ?? '',
  };
  const form = useFormState(source);
  const v = form.values ?? source;
  const [newCheck, setNewCheck] = useState('');

  const save = useApiMutation<Record<string, unknown>>(
    (body) => ({ path: `/visits/${visit.id}`, method: 'PUT', body }),
    { invalidate: [['opportunities']], successMessage: t('saved') },
  );

  const body = (extra: Record<string, unknown> = {}) => ({
    scheduledAt: v.scheduledAt ? new Date(v.scheduledAt).toISOString() : null,
    measurements: v.measurements.filter((m) => m.label.trim()),
    checklist: v.checklist.filter((c) => c.label.trim()),
    notes: v.notes,
    ...extra,
  });

  const setMeasurement = (i: number, patch: Partial<Visit['measurements'][number]>) =>
    form.set('measurements')(v.measurements.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const applyTemplate = (key: (typeof TEMPLATES)[number]) => {
    const labels = t.raw(`templateItems.${key}`) as string[];
    const existing = new Set(v.checklist.map((c) => c.label));
    form.set('checklist')([
      ...v.checklist,
      ...labels.filter((l) => !existing.has(l)).map((label) => ({ label, done: false })),
    ]);
    const measures = t.raw(`templateMeasures.${key}`) as { label: string; unit: string }[];
    const existingM = new Set(v.measurements.map((m) => m.label));
    form.set('measurements')([
      ...v.measurements,
      ...measures.filter((m) => !existingM.has(m.label)).map((m) => ({ ...m, value: '' })),
    ]);
  };

  const done = v.checklist.filter((c) => c.done).length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('title')}</CardTitle>
          {visit.visitedAt ? (
            <Chip tone="good" dot>
              {t('done')}
            </Chip>
          ) : visit.scheduledAt ? (
            <Chip tone="warn" dot>
              {t('planned')}
            </Chip>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label={t('scheduledAt')}
            type="datetime-local"
            value={v.scheduledAt}
            onChange={(e) => form.set('scheduledAt')(e.target.value)}
            disabled={!canWrite}
            containerClassName="w-full sm:w-64"
          />
          {canWrite && !visit.visitedAt ? (
            <Button
              variant="accent"
              icon={<Check aria-hidden className="size-4" />}
              loading={save.isPending}
              onClick={() => save.mutate(body({ visitedAt: new Date().toISOString() }))}
            >
              {t('markDone')}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h3">{t('checklist')}</CardTitle>
          {v.checklist.length ? (
            <span className="text-[13px] text-muted tabular-nums">
              {done}/{v.checklist.length}
            </span>
          ) : null}
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{t('template')}</span>
            {TEMPLATES.map((k) => (
              <Button key={k} size="sm" variant="secondary" onClick={() => applyTemplate(k)}>
                {t(`templates.${k}`)}
              </Button>
            ))}
          </div>
        ) : null}
        {v.checklist.length === 0 ? <p className="text-[14px] text-muted">{t('noChecklist')}</p> : null}
        <ul className="flex flex-col">
          {v.checklist.map((c, i) => (
            <li
              key={`${c.label}-${i}`}
              className="flex items-center justify-between gap-2 border-b border-line-soft last:border-b-0"
            >
              <Checkbox
                label={c.label}
                checked={c.done}
                disabled={!canWrite}
                onChange={(e) =>
                  form.set('checklist')(
                    v.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)),
                  )
                }
                className="flex-1"
              />
              {canWrite ? (
                <RemoveButton
                  label={`${tc('delete')} ${c.label}`}
                  onClick={() => form.set('checklist')(v.checklist.filter((_, j) => j !== i))}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {canWrite ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCheck.trim()) return;
              form.set('checklist')([...v.checklist, { label: newCheck.trim(), done: false }]);
              setNewCheck('');
            }}
          >
            <TextField
              label={t('addCheck')}
              value={newCheck}
              onChange={(e) => setNewCheck(e.target.value)}
              containerClassName="flex-1 [&>label]:sr-only"
              placeholder={t('addCheck')}
              maxLength={160}
            />
            <Button
              type="submit"
              variant="secondary"
              aria-label={t('addCheck')}
              icon={<Plus aria-hidden className="size-4" />}
            >
              <span className="hidden sm:inline">{tc('add')}</span>
            </Button>
          </form>
        ) : null}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle as="h3">{t('measurements')}</CardTitle>
        {v.measurements.length === 0 ? <p className="text-[14px] text-muted">{t('noMeasurements')}</p> : null}
        <ul className="flex flex-col gap-2">
          {v.measurements.map((m, i) => (
            <li
              key={i}
              className="grid grid-cols-[1fr_80px_auto] items-center gap-2 border-b border-line-soft pb-2 last:border-b-0 sm:grid-cols-[1fr_88px_72px_auto] sm:border-b-0 sm:pb-0"
            >
              <input
                aria-label={`${t('label')} ${i + 1}`}
                value={m.label}
                onChange={(e) => setMeasurement(i, { label: e.target.value })}
                disabled={!canWrite}
                placeholder={t('label')}
                maxLength={80}
                className="col-span-3 h-11 min-w-0 rounded-[10px] border border-line bg-surface px-3 text-[15px] focus-visible:outline-2 focus-visible:outline-accent sm:col-span-1"
              />
              <input
                aria-label={`${t('value')} ${m.label || i + 1}`}
                value={m.value}
                onChange={(e) => setMeasurement(i, { value: e.target.value.replace(/[^\d.,]/g, '') })}
                disabled={!canWrite}
                inputMode="decimal"
                placeholder="0"
                maxLength={20}
                className="h-11 min-w-0 rounded-[10px] border border-line bg-surface px-3 text-right text-[15px] tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
              />
              <select
                aria-label={`${t('unit')} ${m.label || i + 1}`}
                value={m.unit}
                onChange={(e) => setMeasurement(i, { unit: e.target.value })}
                disabled={!canWrite}
                className="h-11 min-w-0 rounded-[10px] border border-line bg-surface px-2 text-[15px] focus-visible:outline-2 focus-visible:outline-accent"
              >
                {[...new Set([m.unit, ...UNITS])].filter(Boolean).map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              {canWrite ? (
                <RemoveButton
                  label={`${tc('delete')} ${m.label || i + 1}`}
                  onClick={() => form.set('measurements')(v.measurements.filter((_, j) => j !== i))}
                />
              ) : (
                <span />
              )}
            </li>
          ))}
        </ul>
        {canWrite ? (
          <Button
            variant="secondary"
            className="self-start"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() =>
              form.set('measurements')([...v.measurements, { label: '', value: '', unit: 'm²' }])
            }
          >
            {t('addMeasurement')}
          </Button>
        ) : null}
      </Card>

      <Card>
        <TextAreaField
          label={t('notes')}
          value={v.notes}
          onChange={(e) => form.set('notes')(e.target.value)}
          placeholder={t('notesPlaceholder')}
          disabled={!canWrite}
          className="min-h-32"
        />
      </Card>

      <SaveBar
        dirty={form.dirty}
        saving={save.isPending}
        onSave={() => save.mutate(body())}
        onDiscard={form.reset}
      />
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-line-soft hover:text-crit focus-visible:outline-2 focus-visible:outline-accent"
    >
      <X aria-hidden className="size-4" />
    </button>
  );
}
