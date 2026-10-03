'use client';

import type { PurchaseOrderSummaryDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  Skeleton,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { OrderDrawer } from './OrderDrawer';
import { PurchasingNav } from './PurchasingNav';
import { ORDER_STATUS_TONES } from './status';
import { ExportButtons } from '@/components/ExportButtons';

type Filter = 'open' | 'received' | 'all';
const FILTERS: Filter[] = ['open', 'received', 'all'];

/** Tous les bons de commande, tous chantiers confondus. */
export function OrdersView() {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const filter = (FILTERS as string[]).includes(search.get('vue') ?? '')
    ? (search.get('vue') as Filter)
    : 'open';
  const openId = search.get('bc');
  const list = useApi<{ items: PurchaseOrderSummaryDto[] }>(
    ['purchase_orders', 'list', filter],
    can('purchases.read') ? `/purchase-orders${filter === 'all' ? '' : `?status=${filter}`}` : null,
  );
  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };
  if (!can('purchases.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={t('title')} actions={<ExportButtons list="purchase-orders" />} />
      <PurchasingNav />
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <Segmented<Filter>
          label={tc('filter')}
          value={filter}
          onChange={(v) => setParams({ vue: v === 'open' ? null : v })}
          options={FILTERS.map((f) => ({ value: f, label: t(`orders.filters.${f}`) }))}
        />
      </div>
      {list.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{tc('retry')}</Button>}
        />
      ) : list.isLoading ? (
        <Skeleton className="h-72" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList aria-hidden className="size-5" />}
          title={t('orders.emptyTitle')}
          description={t('orders.empty')}
          action={
            <Link
              href="/chantiers"
              className="inline-flex min-h-11 items-center rounded-[10px] border border-line px-4 text-[14px] font-medium hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t('orders.toProjects')}
            </Link>
          }
        />
      ) : (
        <OrdersTable items={items} onOpen={(id) => setParams({ bc: id })} relative={relative} showProject />
      )}
      {openId ? <OrderDrawer orderId={openId} onClose={() => setParams({ bc: null })} /> : null}
    </div>
  );
}

export function OrdersTable({
  items,
  onOpen,
  relative,
  showProject,
}: {
  items: PurchaseOrderSummaryDto[];
  onOpen: (id: string) => void;
  relative: (iso: string) => string;
  showProject?: boolean;
}) {
  const t = useTranslations('purchasing');
  const tc = useTranslations('common');
  return (
    <Table label={t('orders.title')}>
      <thead>
        <tr>
          <Th>{t('orders.order')}</Th>
          {showProject ? <Th className="hidden md:table-cell">{t('columns.project')}</Th> : null}
          <Th align="right" className="hidden sm:table-cell">
            {t('orders.invoiced')}
          </Th>
          <Th align="right">{t('columns.net')}</Th>
          <Th align="right">{tc('status')}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((o) => (
          <tr key={o.id} className="hover:bg-line-soft/40">
            <Td>
              <button
                type="button"
                onClick={() => onOpen(o.id)}
                className="flex min-h-11 flex-col justify-center rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="font-medium hover:underline">
                  {o.supplier.name}
                  {o.number ? (
                    <span className="ml-2 font-mono text-[13px] text-muted">{o.number}</span>
                  ) : null}
                </span>
                <span className="text-[12px] text-muted">
                  {t('orders.lineCount', { n: o.lineCount })} ·{' '}
                  {o.sentAt
                    ? t('orders.sentAgo', { date: relative(o.sentAt) })
                    : t('orders.createdAgo', { date: relative(o.createdAt) })}
                  {showProject ? (
                    <span className="md:hidden"> · {o.project?.number ?? o.stockLocation?.name ?? ''}</span>
                  ) : null}
                </span>
              </button>
            </Td>
            {showProject ? (
              <Td className="hidden text-[14px] md:table-cell">
                {o.project ? (
                  <Link
                    href={`/chantiers/${o.project.id}?onglet=achats`}
                    className="hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {o.project.number} · {o.project.name}
                  </Link>
                ) : (
                  <Link
                    href="/stock"
                    className="hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {t('order.stockDestination', { name: o.stockLocation?.name ?? '' })}
                  </Link>
                )}
              </Td>
            ) : null}
            <Td align="right" className="hidden tabular-nums sm:table-cell">
              {o.invoiced ? formatEuros(BigInt(o.invoiced)) : '—'}
            </Td>
            <Td align="right" className="tabular-nums">
              {formatEuros(BigInt(o.totalNet))}
            </Td>
            <Td align="right">
              <Chip tone={ORDER_STATUS_TONES[o.status] ?? 'neutral'} dot>
                {t(`order.status.${o.status}`)}
              </Chip>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
