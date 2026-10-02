'use client';

import type { ProjectDto } from '@batimint/contracts';
import { formatEuros, percentInt } from '@batimint/domain';
import { Button, Chip, cn, Dialog, Notice, SelectField, Table, Td, TextField, Th } from '@batimint/ui';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

const eur = (v: number | undefined) => (v === undefined ? '—' : formatEuros(BigInt(v)));

/** Budget par poste (04 « Calcul budgétaire ») : vendu, budgété, engagé, projeté, facturé. */
export function BudgetTab({ project }: { project: ProjectDto }) {
  const t = useTranslations('projects.budget');
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const f = project.financials;
  if (!f) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold">{t('title')}</h2>
        {can('projects.write') ? (
          <Button
            variant="secondary"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => setAdding(true)}
          >
            {t('addCost')}
          </Button>
        ) : null}
      </div>
      <Table label={t('title')}>
        <thead>
          <tr>
            <Th>{t('post')}</Th>
            <Th align="right">{t('sale')}</Th>
            <Th align="right">{t('budgeted')}</Th>
            <Th align="right">{t('committed')}</Th>
            <Th align="right" className="hidden md:table-cell">
              {t('projected')}
            </Th>
            <Th align="right" className="hidden md:table-cell">
              {t('invoiced')}
            </Th>
            <Th align="right">{t('progress')}</Th>
          </tr>
        </thead>
        <tbody>
          {project.budgetLines.map((l) => {
            const cats = Object.entries(l.committedByCategory ?? {}).filter(([, v]) => v);
            return (
              <tr key={l.id} className={cn(l.drift && 'bg-warn/5')}>
                <Td>
                  <span className="font-medium">{l.label}</span>
                  {l.fromChangeOrder ? (
                    <Chip tone="neutral" className="ml-2">
                      {t('fromChangeOrder')}
                    </Chip>
                  ) : null}
                </Td>
                <Td align="right" className="tabular-nums">
                  {eur(l.saleAmount)}
                </Td>
                <Td align="right" className="tabular-nums">
                  {eur(l.budgetedCost)}
                </Td>
                <Td
                  align="right"
                  className={cn('tabular-nums', l.drift && 'font-semibold text-[var(--warn-ink)]')}
                >
                  <span
                    title={
                      cats.map(([k, v]) => `${t(`categories.${k}`)} : ${eur(v)}`).join('\n') || undefined
                    }
                  >
                    {eur(l.committed)}
                  </span>
                  {l.consumption ? (
                    <span className="block text-[11px] font-normal text-muted">
                      {t('consumption')} {percentInt(l.consumption)} %
                    </span>
                  ) : null}
                </Td>
                <Td align="right" className="hidden tabular-nums md:table-cell">
                  {eur(l.projectedCost)}
                </Td>
                <Td align="right" className="hidden tabular-nums md:table-cell">
                  {eur(l.invoiced)}
                </Td>
                <Td align="right" className="tabular-nums">
                  {percentInt(l.progress)} %
                </Td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-line font-semibold">
            <Td>{t('total')}</Td>
            <Td align="right" className="tabular-nums">
              {eur(f.contractAmount)}
            </Td>
            <Td align="right" className="tabular-nums">
              {eur(f.budgetedCost)}
            </Td>
            <Td align="right" className="tabular-nums">
              {eur(f.committed)}
            </Td>
            <Td align="right" className="hidden tabular-nums md:table-cell">
              {eur(f.projectedCost)}
            </Td>
            <Td align="right" className="hidden tabular-nums md:table-cell">
              {eur(f.invoiced)}
            </Td>
            <Td align="right" className="tabular-nums">
              {percentInt(project.progress)} %
            </Td>
          </tr>
        </tbody>
      </Table>
      {adding ? <CostDialog project={project} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function CostDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const t = useTranslations('projects.budget');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(0);
  const [post, setPost] = useState(project.budgetLines[0]?.id ?? '');
  const [id] = useState(() => uuidv7());
  const save = useApiMutation<void>(
    () => ({
      path: `/projects/${project.id}/costs`,
      body: { id, label: label.trim(), amount, budgetLineId: post || null },
    }),
    {
      invalidate: [['project', project.id]],
      successMessage: t('costSaved'),
      onSuccess: onClose,
      silentError: true,
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (label.trim().length >= 2 && amount !== 0) save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('costTitle')}
      description={t('costHint')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form="add-cost"
            loading={save.isPending}
            disabled={label.trim().length < 2 || amount === 0}
          >
            {tc('save')}
          </Button>
        </>
      }
    >
      <form id="add-cost" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <TextField
          label={t('costLabel')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
        />
        <MoneyInput label={t('costAmount')} cents={amount} onChange={setAmount} />
        <SelectField
          label={t('costPost')}
          value={post}
          onChange={(e) => setPost(e.target.value)}
          options={[
            ...project.budgetLines.map((l) => ({ value: l.id, label: l.label })),
            { value: '', label: t('costNoPost') },
          ]}
        />
      </form>
    </Dialog>
  );
}
