'use client';

import type { ProjectDto, SubcontractSummaryDto, WorksDeclarationDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  Notice,
  Skeleton,
  TextField,
} from '@batimint/ui';
import { Handshake, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { CONTRACT_STATUS_TONE, ComplianceChip, formatDay, ThirtyBisChip } from './shared';
import { SubcontractDialog } from './SubcontractDialog';
import { SubcontractDrawer } from './SubcontractDrawer';

/** Onglet « Sous-traitance » du cockpit : contrats par poste et déclaration de travaux (P9). */
export function SubcontractingTab({ project }: { project: ProjectDto }) {
  const t = useTranslations('subcontracting');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = useApi<{ items: SubcontractSummaryDto[] }>(
    ['subcontracts', 'list', 'project', project.id],
    `/subcontracts?projectId=${project.id}`,
  );
  const items = list.data?.items ?? [];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="sc-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="sc-title" className="text-[17px] font-semibold">
            {t('tab.title')}
          </h2>
          {can('subcontracting.write') ? (
            <Button
              size="sm"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => setCreating(true)}
            >
              {t('contract.new')}
            </Button>
          ) : null}
        </div>
        {list.error ? (
          <ErrorState
            title={tc('errorTitle')}
            description={errorMessage(list.error)}
            action={<Button onClick={() => void list.refetch()}>{tc('retry')}</Button>}
          />
        ) : list.isLoading ? (
          <Skeleton className="h-40" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Handshake aria-hidden className="size-5" />}
            title={t('tab.emptyTitle')}
            description={t('tab.empty')}
            action={
              can('subcontracting.write') ? (
                <Button onClick={() => setCreating(true)}>{t('contract.new')}</Button>
              ) : null
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((s) => (
              <li key={s.id}>
                <ContractCard contract={s} onOpen={() => setOpen(s.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <WorksDeclarationCard projectId={project.id} />
      {creating ? (
        <SubcontractDialog
          projectId={project.id}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            setOpen(s.id);
          }}
        />
      ) : null}
      {open ? <SubcontractDrawer id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export function ContractCard({
  contract: s,
  onOpen,
}: {
  contract: SubcontractSummaryDto;
  onOpen: () => void;
}) {
  const t = useTranslations('subcontracting.contract');
  const ratio = s.amount > 0 ? Math.min(100, Math.round((s.invoiced / s.amount) * 100)) : 0;
  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-3 rounded-[16px] p-4 text-left hover:bg-line-soft/30 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="flex min-w-0 flex-col">
            <span className="font-semibold">
              {s.supplier.name} · <span className="font-normal">{s.title}</span>
            </span>
            <span className="text-[13px] text-muted">
              {s.number}
              {s.budgetLine ? ` · ${s.budgetLine.label}` : ''}
              {s.startDate ? ` · ${formatDay(s.startDate)} → ${formatDay(s.endDate)}` : ''}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={CONTRACT_STATUS_TONE[s.status] ?? 'neutral'} dot>
              {t(`status.${s.status}`)}
            </Chip>
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <ThirtyBisChip check={s.lastCheck} />
          <ComplianceChip compliance={s.compliance} />
        </span>
        <span className="flex flex-col gap-1">
          <span className="flex justify-between text-[13px]">
            <span className="text-muted">{t('invoicedOf', { amount: formatEuros(BigInt(s.amount)) })}</span>
            <span className="font-medium tabular-nums">{formatEuros(BigInt(s.invoiced))}</span>
          </span>
          <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-line-soft">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${ratio}%` }} />
          </span>
        </span>
      </button>
    </Card>
  );
}

/** Déclaration de travaux (art. 30bis §7) : signal « probablement requise » et données pré-remplies. */
function WorksDeclarationCard({ projectId }: { projectId: string }) {
  const t = useTranslations('subcontracting.works');
  const can = useCan();
  const d = useApi<WorksDeclarationDto>(
    ['project', projectId, 'works-declaration'],
    `/projects/${projectId}/works-declaration`,
  );
  const [reference, setReference] = useState('');
  const [declaredOn, setDeclaredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const save = useApiMutation<void, WorksDeclarationDto>(
    () => ({
      path: `/projects/${projectId}/works-declaration`,
      method: 'POST',
      body: { reference: reference.trim(), declaredOn },
    }),
    { invalidate: [['project', projectId]], successMessage: t('saved') },
  );
  if (!d.data) return d.isLoading ? <Skeleton className="h-40" /> : null;
  const w = d.data;
  const data = w.data;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <CardTitle as="h2">{t('title')}</CardTitle>
        {w.declaredAt ? (
          <Chip tone="good" dot>
            {t('declared', { ref: w.reference ?? '', date: formatDay(w.declaredAt) })}
          </Chip>
        ) : w.required ? (
          <Chip tone="warn" dot>
            {t('required')}
          </Chip>
        ) : (
          <Chip tone="neutral">{t('notRequired')}</Chip>
        )}
      </div>
      {w.required && !w.declaredAt ? (
        <Notice tone="warn">
          {t('why', {
            reasons: w.reasons.map((r) => t(`reasons.${r}`)).join(t('and')),
          })}
        </Notice>
      ) : null}
      <dl className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
        <Fact label={t('site')} value={`${data.projectNumber} — ${data.projectName}`} />
        <Fact label={t('address')} value={data.address ?? '—'} />
        <Fact label={t('period')} value={`${formatDay(data.startDate)} → ${formatDay(data.endDate)}`} />
        <Fact
          label={t('amount')}
          value={formatEuros(BigInt(data.workplaceTotalAmount ?? data.contractAmount))}
        />
        <Fact
          label={t('principal')}
          value={`${data.principal.name}${data.principal.enterpriseNumber ? ` (${data.principal.enterpriseNumber})` : ''}`}
        />
        <Fact
          label={t('contractor')}
          value={`${data.contractor.name}${data.contractor.enterpriseNumber ? ` (${data.contractor.enterpriseNumber})` : ''}`}
        />
      </dl>
      {data.subcontractors.length ? (
        <div className="flex flex-col gap-1 text-[14px]">
          <span className="text-[12px] text-muted">{t('subcontractors')}</span>
          <ul className="flex flex-col gap-1">
            {data.subcontractors.map((s, k) => (
              <li key={k}>
                {s.name}
                {s.enterpriseNumber ? (
                  <span className="font-mono text-[13px]"> · {s.enterpriseNumber}</span>
                ) : null}
                <span className="text-muted">
                  {' '}
                  · {s.title} · {formatEuros(BigInt(s.amount))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {can('subcontracting.write') && !w.declaredAt && w.required ? (
        <form
          className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reference.trim().length >= 3) save.mutate();
          }}
        >
          <TextField
            label={t('reference')}
            value={reference}
            hint={t('referenceHint')}
            containerClassName="min-w-[220px] flex-1"
            onChange={(e) => setReference(e.target.value)}
          />
          <TextField
            label={t('declaredOn')}
            type="date"
            value={declaredOn}
            onChange={(e) => setDeclaredOn(e.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            loading={save.isPending}
            disabled={reference.trim().length < 3}
          >
            {t('save')}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
