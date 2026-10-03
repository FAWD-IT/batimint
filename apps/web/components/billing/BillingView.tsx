'use client';

import type { InvoiceSummaryDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Button, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '@batimint/ui';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';
import { useNewParam } from '@/lib/use-new-param';
import { BillingNav } from './BillingNav';
import { InvoiceTable } from './InvoiceTable';
import { NewInvoiceDialog } from './NewInvoiceDialog';
import { ExportButtons } from '@/components/ExportButtons';

type View = 'open' | 'overdue' | 'draft' | 'paid' | 'all';
const VIEWS: View[] = ['open', 'overdue', 'draft', 'paid', 'all'];

interface ListResponse {
  items: InvoiceSummaryDto[];
  counts: { draft: number; open: number; overdue: number };
  receivable: number;
  overdueAmount: number;
}

/** Facturation (03 §10) : factures à encaisser, en retard, brouillons, payées ; encours. */
export function BillingView() {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  useNewParam(() => can('invoices.write') && setCreating(true));
  const query = useDebounced(q.trim(), 200);
  const view = (VIEWS as string[]).includes(search.get('vue') ?? '') ? (search.get('vue') as View) : 'open';
  const list = useApi<ListResponse>(
    ['invoices', 'list', view, query],
    can('invoices.read') ? `/invoices?view=${view}${query ? `&q=${encodeURIComponent(query)}` : ''}` : null,
  );
  if (!can('invoices.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const setView = (v: View) => {
    const next = new URLSearchParams(search.toString());
    if (v === 'open') next.delete('vue');
    else next.set('vue', v);
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  };
  const counts = list.data?.counts;
  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons list="invoices" />
            {can('invoices.write') ? (
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
                {t('new')}
              </Button>
            ) : null}
          </div>
        }
      />
      <BillingNav />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-1 p-5">
          <span className="text-[13px] text-muted">{t('receivable')}</span>
          <span className="text-[24px] font-bold tabular-nums">
            {list.data ? formatEuros(BigInt(list.data.receivable)) : '—'}
          </span>
          <span className="text-[13px] text-muted">{t('openCount', { n: counts?.open ?? 0 })}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-5">
          <span className="text-[13px] text-muted">{t('overdue')}</span>
          <span
            className={`text-[24px] font-bold tabular-nums ${list.data?.overdueAmount ? 'text-crit' : ''}`}
          >
            {list.data ? formatEuros(BigInt(list.data.overdueAmount)) : '—'}
          </span>
          <Link
            href="/facturation/encours"
            className="w-fit text-[13px] text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t('agedBalance')}
          </Link>
        </Card>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput
          label={t('search')}
          placeholder={t('search')}
          value={q}
          onChange={setQ}
          clearLabel={tc('close')}
          loading={list.isFetching && Boolean(query)}
          className="lg:max-w-sm"
        />
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <Segmented<View>
            label={tc('filter')}
            value={view}
            onChange={setView}
            options={VIEWS.map((v) => ({
              value: v,
              label:
                counts && (v === 'open' || v === 'overdue' || v === 'draft')
                  ? `${t(`views.${v}`)} (${counts[v]})`
                  : t(`views.${v}`),
            }))}
          />
        </div>
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
          icon={<FileText aria-hidden className="size-5" />}
          title={query ? tc('noResults', { q: query }) : t(`empty.${view}.title`)}
          description={t(`empty.${view}.description`)}
          action={
            can('invoices.write') && view !== 'paid' ? (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                {t('new')}
              </Button>
            ) : null
          }
        />
      ) : (
        <InvoiceTable items={items} />
      )}
      {creating ? <NewInvoiceDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
