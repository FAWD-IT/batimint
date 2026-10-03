'use client';

import type { SubcontractDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  Chip,
  ConfirmDialog,
  Drawer,
  ErrorState,
  Notice,
  Skeleton,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Send } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { CONTRACT_STATUS_TONE, ComplianceChip, formatDateTime, formatDay, ThirtyBisChip } from './shared';

/** Contrat de sous-traitance : objet, échéancier, facturé, retenues, 30bis, factures, actions. */
export function SubcontractDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('subcontracting.contract');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const s = useApi<SubcontractDto>(['subcontracts', 'detail', id], `/subcontracts/${id}`);
  return (
    <Drawer
      open
      onClose={onClose}
      title={s.data ? `${s.data.number} · ${s.data.supplier.name}` : t('drawerTitle')}
      description={
        s.data ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={CONTRACT_STATUS_TONE[s.data.status] ?? 'neutral'} dot>
              {t(`status.${s.data.status}`)}
            </Chip>
            <span>
              {s.data.project.number} — {s.data.project.name}
            </span>
          </span>
        ) : undefined
      }
      closeLabel={tc('close')}
      className="w-[min(100vw,640px)]"
    >
      {s.error ? (
        <ErrorState title={t('notFound')} description={errorMessage(s.error)} />
      ) : !s.data ? (
        <Skeleton className="h-96" />
      ) : (
        <Body contract={s.data} />
      )}
    </Drawer>
  );
}

function Body({ contract: s }: { contract: SubcontractDto }) {
  const t = useTranslations('subcontracting.contract');
  const ti = useTranslations('purchasing.invoice.status');
  const tc = useTranslations('common');
  const can = useCan();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<'completed' | 'cancelled' | null>(null);
  const setDetail = (dto: SubcontractDto) => queryClient.setQueryData(['subcontracts', 'detail', s.id], dto);
  const invalidate = [['subcontracts'], ['subcontractors'], ['project']];
  const status = useApiMutation<{ to: string }, SubcontractDto>(
    (b) => ({ path: `/subcontracts/${s.id}/status`, method: 'POST', body: b }),
    {
      invalidate,
      successMessage: (r) => t(`statusChanged.${r.status}`),
      onSuccess: (dto) => {
        setDetail(dto);
        setConfirm(null);
      },
    },
  );
  const invite = useApiMutation<void, { email: string }>(
    () => ({
      path: `/subcontractors/${s.supplier.id}/invite`,
      method: 'POST',
      body: { subcontractId: s.id },
    }),
    { invalidate: [['subcontractors']], successMessage: (r) => t('invited', { email: r.email }) },
  );
  const remaining = s.amount - s.invoiced;
  const debt = s.creationCheck && (s.creationCheck.hasSocialDebt || s.creationCheck.hasTaxDebt);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-[16px] font-semibold">{s.title}</h3>
        {s.budgetLine ? (
          <p className="text-[14px] text-muted">{t('postLabel', { post: s.budgetLine.label })}</p>
        ) : null}
        {s.scope ? <p className="text-[14px] whitespace-pre-line">{s.scope}</p> : null}
        <p className="text-[14px] text-muted">
          {s.startDate || s.endDate
            ? t('period', { start: formatDay(s.startDate), end: formatDay(s.endDate) })
            : t('noDates')}
        </p>
      </div>

      <Card className="grid grid-cols-3 gap-3 p-4">
        <Amount label={t('amount')} cents={s.amount} strong />
        <Amount label={t('invoiced')} cents={s.invoiced} />
        <Amount label={t('remaining')} cents={remaining > 0 ? remaining : 0} />
      </Card>

      <section aria-labelledby="sc-30bis" className="flex flex-col gap-2">
        <h3 id="sc-30bis" className="text-[15px] font-semibold">
          {t('thirtyBis')}
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <ThirtyBisChip check={s.lastCheck} />
          {s.lastCheck ? (
            <span className="text-muted">
              {t('checkedAt', { at: formatDateTime(s.lastCheck.checkedAt) })}
            </span>
          ) : null}
          {s.lastCheck?.proofUrl ? (
            <a
              href={s.lastCheck.proofUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('proof')}
            </a>
          ) : null}
        </div>
        {debt ? <Notice tone="warn">{t('debtNotice')}</Notice> : null}
        {s.withheld > 0 ? (
          <p className="text-[14px]">{t('withheld', { amount: formatEuros(BigInt(s.withheld)) })}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <ComplianceChip compliance={s.compliance} />
          <Link
            href={`/sous-traitance/${s.supplier.id}`}
            className="inline-flex min-h-11 items-center font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t('openSubcontractor')}
          </Link>
        </div>
      </section>

      <section aria-labelledby="sc-installments" className="flex flex-col gap-2">
        <h3 id="sc-installments" className="text-[15px] font-semibold">
          {t('installments')}
        </h3>
        <Table label={t('installments')}>
          <thead>
            <tr>
              <Th>{t('installment')}</Th>
              <Th className="hidden sm:table-cell">{t('dueOn')}</Th>
              <Th align="right">{t('amount')}</Th>
            </tr>
          </thead>
          <tbody>
            {s.installments.map((i, k) => (
              <tr key={k}>
                <Td>
                  {i.label} <span className="text-muted">· {i.percent.replace('.', ',')} %</span>
                </Td>
                <Td className="hidden sm:table-cell">{formatDay(i.dueOn)}</Td>
                <Td align="right" className="tabular-nums">
                  {formatEuros(BigInt(i.amount))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section aria-labelledby="sc-invoices" className="flex flex-col gap-2">
        <h3 id="sc-invoices" className="text-[15px] font-semibold">
          {t('invoices')}
        </h3>
        {s.invoices.length === 0 ? (
          <p className="text-[14px] text-muted">{t('noInvoices')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-line">
            {s.invoices.map((i) => (
              <li key={i.id}>
                <Link
                  href={`/achats/factures?vue=all&facture=${i.id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[14px] hover:bg-line-soft/40 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{i.number ?? t('noNumber')}</span>
                    <Chip tone="neutral">{ti(i.status)}</Chip>
                  </span>
                  <span className="tabular-nums">
                    {formatEuros(BigInt(i.totalNet))}
                    {i.withholding ? (
                      <span className="block text-[12px] text-muted">
                        {t('invoiceWithheld', { amount: formatEuros(BigInt(i.withholding)) })}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft pt-4">
        <a href={s.pdfUrl} target="_blank" rel="noreferrer" className={buttonClasses('secondary')}>
          <ExternalLink aria-hidden className="size-4" />
          {t('pdf')}
        </a>
        {can('subcontracting.write') ? (
          <>
            <Button
              variant="secondary"
              icon={<Send aria-hidden className="size-4" />}
              loading={invite.isPending}
              onClick={() => invite.mutate()}
            >
              {t('invite')}
            </Button>
            {s.status === 'active' ? (
              <>
                {s.invoices.length === 0 ? (
                  <Button variant="secondary" onClick={() => setConfirm('cancelled')}>
                    {t('cancel')}
                  </Button>
                ) : null}
                <Button onClick={() => setConfirm('completed')}>{t('complete')}</Button>
              </>
            ) : s.status === 'completed' ? (
              <Button
                variant="secondary"
                loading={status.isPending}
                onClick={() => status.mutate({ to: 'active' })}
              >
                {t('reopen')}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && status.mutate({ to: confirm })}
        title={confirm === 'cancelled' ? t('cancelTitle') : t('completeTitle')}
        description={confirm === 'cancelled' ? t('cancelDescription') : t('completeDescription')}
        confirmLabel={confirm === 'cancelled' ? t('cancel') : t('complete')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive={confirm === 'cancelled'}
        loading={status.isPending}
      />
    </div>
  );
}

function Amount({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={strong ? 'text-[18px] font-semibold tabular-nums' : 'text-[15px] tabular-nums'}>
        {formatEuros(BigInt(cents))}
      </span>
    </div>
  );
}
