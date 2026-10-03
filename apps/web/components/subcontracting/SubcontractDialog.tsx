'use client';

import type {
  ProjectDto,
  ProjectSummaryDto,
  SubcontractDto,
  SubcontractorSummaryDto,
} from '@batimint/contracts';
import { formatEuros, percentOf } from '@batimint/domain';
import { Button, Dialog, Notice, SelectField, TextAreaField, TextField } from '@batimint/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { useApi, useApiMutation } from '@/lib/hooks';

interface Installment {
  key: string;
  label: string;
  percent: string;
  dueOn: string;
}

/**
 * Conclure un contrat de sous-traitance sur un poste (P9.1) : la consultation 30bis est faite à
 * l'enregistrement et son résultat s'affiche aussitôt.
 */
export function SubcontractDialog({
  projectId: fixedProject,
  supplierId: fixedSupplier,
  onClose,
  onCreated,
}: {
  projectId?: string;
  supplierId?: string;
  onClose: () => void;
  onCreated: (s: SubcontractDto) => void;
}) {
  const t = useTranslations('subcontracting.contract');
  const tc = useTranslations('common');
  const [id] = useState(() => uuidv7());
  const [projectId, setProjectId] = useState(fixedProject ?? '');
  const [form, setForm] = useState({
    supplierId: fixedSupplier ?? '',
    budgetLineId: '',
    title: '',
    scope: '',
    amount: 0,
    startDate: '',
    endDate: '',
  });
  const [installments, setInstallments] = useState<Installment[]>([
    { key: uuidv7(), label: t('defaultInstallments.start'), percent: '30', dueOn: '' },
    { key: uuidv7(), label: t('defaultInstallments.end'), percent: '70', dueOn: '' },
  ]);
  const [submitted, setSubmitted] = useState(false);

  const subcontractors = useApi<{ items: SubcontractorSummaryDto[] }>(
    ['subcontractors', 'list'],
    '/subcontractors',
  );
  const suppliers = useApi<{ items: { id: string; name: string; isSubcontractor: boolean }[] }>(
    ['suppliers', 'list', ''],
    '/suppliers',
  );
  const projects = useApi<{ items: ProjectSummaryDto[] }>(
    ['projects', 'list', 'active'],
    fixedProject ? null : '/projects?view=active',
  );
  const project = useApi<ProjectDto>(['project', projectId], projectId ? `/projects/${projectId}` : null);

  const options = useMemo(() => {
    const subs = subcontractors.data?.items ?? [];
    const ids = new Set(subs.map((s) => s.id));
    const others = (suppliers.data?.items ?? []).filter((s) => !ids.has(s.id));
    return { subs, others };
  }, [subcontractors.data, suppliers.data]);

  const totalPercent = installments.reduce((s, i) => s + (Number(i.percent.replace(',', '.')) || 0), 0);
  const errors = {
    projectId: !projectId ? t('errors.project') : null,
    supplierId: !form.supplierId ? t('errors.supplier') : null,
    title: !form.title.trim() ? t('errors.title') : null,
    amount: form.amount <= 0 ? t('errors.amount') : null,
    dates: form.startDate && form.endDate && form.endDate < form.startDate ? t('errors.dates') : null,
    installments:
      Math.abs(totalPercent - 100) > 0.0001 ? t('errors.installments', { n: totalPercent }) : null,
  };
  const valid = Object.values(errors).every((e) => !e);

  const create = useApiMutation<void, SubcontractDto>(
    () => ({
      path: '/subcontracts',
      method: 'POST',
      body: {
        id,
        projectId,
        supplierId: form.supplierId,
        budgetLineId: form.budgetLineId || null,
        title: form.title.trim(),
        scope: form.scope.trim() || null,
        amount: form.amount,
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        installments: installments.map((i) => ({
          label: i.label,
          percent: i.percent.replace(',', '.'),
          dueOn: i.dueOn || null,
        })),
      },
    }),
    {
      invalidate: [['subcontracts'], ['subcontractors'], ['project']],
      successMessage: (s) => t('created', { number: s.number }),
      onSuccess: (s) => onCreated(s),
    },
  );

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('newTitle')}
      description={t('newDescription')}
      closeLabel={tc('close')}
      className="w-[min(94vw,640px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            loading={create.isPending}
            onClick={() => {
              setSubmitted(true);
              if (valid) create.mutate();
            }}
          >
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (valid) create.mutate();
        }}
      >
        {!fixedProject ? (
          <SelectField
            label={t('project')}
            value={projectId}
            error={err('projectId')}
            onChange={(e) => {
              setProjectId(e.target.value);
              setForm((f) => ({ ...f, budgetLineId: '' }));
            }}
            options={[
              { value: '', label: t('chooseProject') },
              ...(projects.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.number} — ${p.name}` })),
            ]}
          />
        ) : null}
        <SelectField
          label={t('subcontractor')}
          value={form.supplierId}
          error={err('supplierId')}
          disabled={Boolean(fixedSupplier)}
          onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
          hint={t('subcontractorHint')}
          options={[
            { value: '', label: t('chooseSubcontractor') },
            ...options.subs.map((s) => ({ value: s.id, label: s.name })),
            ...options.others.map((s) => ({ value: s.id, label: `${s.name} (${t('otherSupplier')})` })),
          ]}
        />
        <SelectField
          label={t('post')}
          value={form.budgetLineId}
          disabled={!project.data}
          onChange={(e) => setForm((f) => ({ ...f, budgetLineId: e.target.value }))}
          options={[
            { value: '', label: t('noPost') },
            ...(project.data?.budgetLines ?? []).map((b) => ({ value: b.id, label: b.label })),
          ]}
        />
        <TextField
          label={t('title')}
          value={form.title}
          error={err('title')}
          placeholder={t('titlePlaceholder')}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <TextAreaField
          label={t('scope')}
          value={form.scope}
          rows={3}
          optionalLabel={tc('optional')}
          onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <MoneyInput
            label={t('amount')}
            cents={form.amount}
            onChange={(c) => setForm((f) => ({ ...f, amount: c }))}
            hint={err('amount') ?? undefined}
          />
          <TextField
            label={t('startDate')}
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
          />
          <TextField
            label={t('endDate')}
            type="date"
            value={form.endDate}
            error={err('dates')}
            onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
          />
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-[13px] font-semibold">{t('installments')}</legend>
          {installments.map((i, k) => (
            <div
              key={i.key}
              className="grid grid-cols-[1fr_88px_auto] items-end gap-2 sm:grid-cols-[1fr_88px_150px_auto]"
            >
              <TextField
                label={t('installmentLabel', { n: k + 1 })}
                value={i.label}
                onChange={(e) =>
                  setInstallments((list) =>
                    list.map((x) => (x.key === i.key ? { ...x, label: e.target.value } : x)),
                  )
                }
              />
              <TextField
                label={t('percent')}
                inputMode="decimal"
                value={i.percent}
                onChange={(e) =>
                  setInstallments((list) =>
                    list.map((x) => (x.key === i.key ? { ...x, percent: e.target.value } : x)),
                  )
                }
              />
              <TextField
                label={t('dueOn')}
                type="date"
                containerClassName="hidden sm:flex"
                value={i.dueOn}
                onChange={(e) =>
                  setInstallments((list) =>
                    list.map((x) => (x.key === i.key ? { ...x, dueOn: e.target.value } : x)),
                  )
                }
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('removeInstallment', { n: k + 1 })}
                disabled={installments.length === 1}
                icon={<Trash2 aria-hidden className="size-4" />}
                onClick={() => setInstallments((list) => list.filter((x) => x.key !== i.key))}
              />
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus aria-hidden className="size-4" />}
              disabled={installments.length >= 12}
              onClick={() =>
                setInstallments((list) => [...list, { key: uuidv7(), label: '', percent: '', dueOn: '' }])
              }
            >
              {t('addInstallment')}
            </Button>
            <span className={`text-[13px] tabular-nums ${errors.installments ? 'text-crit' : 'text-muted'}`}>
              {t('installmentsTotal', {
                n: totalPercent,
                amount: formatEuros(
                  installments.reduce((s, i) => {
                    try {
                      return s + percentOf(BigInt(form.amount), i.percent.replace(',', '.') || '0');
                    } catch {
                      return s;
                    }
                  }, 0n),
                ),
              })}
            </span>
          </div>
          {submitted && errors.installments ? (
            <p role="alert" className="text-[13px] text-crit">
              {errors.installments}
            </p>
          ) : null}
        </fieldset>
        <Notice tone="accent" title={t('thirtyBisTitle')}>
          {t('thirtyBisNotice')}
        </Notice>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
