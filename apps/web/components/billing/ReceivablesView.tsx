'use client';

import type { ReceivablesDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Table, Td, Th } from '@batimint/ui';
import { Scale } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { BillingNav } from './BillingNav';

const BUCKETS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;

/** Encours clients et balance âgée (03 §10). */
export function ReceivablesView() {
  const t = useTranslations('billing.receivables');
  const tb = useTranslations('billing');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const data = useApi<ReceivablesDto>(
    ['invoices', 'receivables'],
    can('invoices.read') ? '/receivables' : null,
  );
  if (!can('invoices.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const r = data.data;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={tb('title')} />
      <BillingNav />
      {data.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(data.error)}
          action={<Button onClick={() => void data.refetch()}>{tc('retry')}</Button>}
        />
      ) : !r ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <section
            aria-label={t('agedBalance')}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
          >
            <Card className="col-span-2 flex flex-col gap-1 p-4 sm:col-span-3 lg:col-span-1">
              <span className="text-[12px] text-muted">{t('total')}</span>
              <span className="text-[20px] font-bold tabular-nums">{formatEuros(BigInt(r.total))}</span>
            </Card>
            {BUCKETS.map((b) => (
              <Card key={b} className="flex flex-col gap-1 p-4">
                <span className="text-[12px] text-muted">{t(`buckets.${b}`)}</span>
                <span
                  className={`text-[16px] font-semibold tabular-nums ${b !== 'notDue' && r.buckets[b] > 0 ? 'text-crit' : ''}`}
                >
                  {formatEuros(BigInt(r.buckets[b]))}
                </span>
              </Card>
            ))}
          </section>
          {r.customers.length === 0 ? (
            <EmptyState
              icon={<Scale aria-hidden className="size-5" />}
              title={t('emptyTitle')}
              description={t('empty')}
            />
          ) : (
            <Table label={t('byCustomer')}>
              <thead>
                <tr>
                  <Th>{t('customer')}</Th>
                  <Th align="right" className="hidden sm:table-cell">
                    {t('invoices')}
                  </Th>
                  <Th align="right" className="hidden md:table-cell">
                    {t('oldest')}
                  </Th>
                  <Th align="right">{t('overdue')}</Th>
                  <Th align="right">{t('balance')}</Th>
                </tr>
              </thead>
              <tbody>
                {r.customers.map((c) => (
                  <tr key={c.customer.id} className="hover:bg-line-soft/40">
                    <Td>
                      <Link
                        href={`/clients/${c.customer.id}`}
                        className="flex min-h-11 items-center font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {c.customer.displayName}
                      </Link>
                    </Td>
                    <Td align="right" className="hidden tabular-nums sm:table-cell">
                      {c.invoices}
                    </Td>
                    <Td align="right" className="hidden md:table-cell">
                      {c.oldestDaysLate ? t('days', { n: c.oldestDaysLate }) : '—'}
                    </Td>
                    <Td
                      align="right"
                      className={`tabular-nums ${c.overdue ? 'font-semibold text-crit' : ''}`}
                    >
                      {c.overdue ? formatEuros(BigInt(c.overdue)) : '—'}
                    </Td>
                    <Td align="right" className="tabular-nums">
                      {formatEuros(BigInt(c.total))}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
