'use client';

import type { InvoiceSummaryDto, ProgressStatementDto, ProjectDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Button, Card, CardTitle, Chip, EmptyState, Skeleton } from '@batimint/ui';
import { FileText, Plus, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { InvoiceTable } from './InvoiceTable';
import { NewInvoiceDialog } from './NewInvoiceDialog';
import { formatDay, pct, STATEMENT_TONES } from './status';

/** Onglet « Facturation » du cockpit : états d'avancement et factures du chantier (02 P7). */
export function BillingTab({ project }: { project: ProjectDto }) {
  const t = useTranslations('billing.tab');
  const ts = useTranslations('billing.statement');
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const statements = useApi<{ items: ProgressStatementDto[] }>(
    ['progress_statements', project.id],
    `/projects/${project.id}/progress-statements`,
  );
  const invoices = useApi<{ items: InvoiceSummaryDto[] }>(
    ['invoices', 'list', 'project', project.id],
    `/invoices?view=all&projectId=${project.id}`,
  );
  const pending = statements.data?.items.find((s) => ['draft', 'submitted', 'disputed'].includes(s.status));
  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle as="h2">{t('statements')}</CardTitle>
          {can('invoices.write') ? (
            pending ? (
              <Link
                href={`/chantiers/${project.id}/avancement/${pending.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-ink px-4 text-[14px] font-semibold text-ink-inverse focus-visible:outline-2 focus-visible:outline-accent"
              >
                {t('openPending', { n: pending.ordinal })}
              </Link>
            ) : (
              <Link
                href={`/chantiers/${project.id}/avancement/nouveau`}
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-ink px-4 text-[14px] font-semibold text-ink-inverse focus-visible:outline-2 focus-visible:outline-accent"
              >
                <TrendingUp aria-hidden className="size-4" />
                {t('billProgress')}
              </Link>
            )
          ) : null}
        </div>
        {statements.isLoading ? (
          <Skeleton className="h-20" />
        ) : statements.data?.items.length ? (
          <ul className="flex flex-col divide-y divide-line-soft">
            {statements.data.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <Link
                  href={`/chantiers/${project.id}/avancement/${s.id}`}
                  className="flex min-h-11 flex-col justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="font-medium hover:underline">
                    {ts('title', { n: s.ordinal })} · {pct(s.cumulativePercent)}
                  </span>
                  <span className="text-[12px] text-muted">
                    {formatDay(s.periodEnd)} · {formatEuros(BigInt(s.periodAmount))} HTVA
                    {s.invoice?.number ? ` · ${s.invoice.number}` : ''}
                  </span>
                </Link>
                <Chip tone={STATEMENT_TONES[s.status] ?? 'neutral'} dot>
                  {ts(`status.${s.status}`)}
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t('noStatement')}</p>
        )}
      </Card>

      <section aria-labelledby="project-invoices" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="project-invoices" className="text-[17px] font-semibold">
            {t('invoices')}
          </h2>
          {can('invoices.write') ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => setCreating(true)}
            >
              {t('newInvoice')}
            </Button>
          ) : null}
        </div>
        {invoices.isLoading ? (
          <Skeleton className="h-40" />
        ) : invoices.data?.items.length ? (
          <InvoiceTable items={invoices.data.items} showProject={false} />
        ) : (
          <EmptyState
            icon={<FileText aria-hidden className="size-5" />}
            title={t('emptyTitle')}
            description={t('empty')}
          />
        )}
      </section>
      {creating ? (
        <NewInvoiceDialog
          customerId={project.customer.id}
          projectId={project.id}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}
