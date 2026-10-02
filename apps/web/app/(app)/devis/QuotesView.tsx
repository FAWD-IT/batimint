'use client';

import type { QuoteSummaryDto } from '@batimint/contracts';
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
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { NewQuoteDialog } from '@/components/quotes/NewQuoteDialog';
import { QUOTE_STATUS_TONES } from '@/components/quotes/status';
import { SearchInput } from '@/components/SearchInput';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { useNewParam } from '@/lib/use-new-param';

type Filter = 'all' | 'draft' | 'sent' | 'signed' | 'lost' | 'templates';
const FILTER_STATUS: Record<Filter, string | null> = {
  all: null,
  draft: 'draft',
  sent: 'sent,viewed',
  signed: 'signed',
  lost: 'refused,expired',
  templates: null,
};

export function QuotesView() {
  const t = useTranslations('quotes');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  useNewParam(() => can('quotes.write') && setCreating(true));
  const query = useDebounced(q.trim(), 200);
  const params = new URLSearchParams();
  if (FILTER_STATUS[filter]) params.set('status', FILTER_STATUS[filter]!);
  if (filter === 'templates') params.set('templates', 'true');
  if (query) params.set('q', query);
  const list = useApi<{ items: QuoteSummaryDto[] }>(
    ['quotes', 'list', filter, query],
    can('quotes.read') ? `/quotes?${params.toString()}` : null,
  );

  if (!can('quotes.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = list.data?.items ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        actions={
          can('quotes.write') ? (
            <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
              {t('new.title')}
            </Button>
          ) : null
        }
      />
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
          <Segmented<Filter>
            label={tc('filter')}
            value={filter}
            onChange={setFilter}
            options={(['all', 'draft', 'sent', 'signed', 'lost', 'templates'] as const).map((f) => ({
              value: f,
              label: t(`filters.${f}`),
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
          title={
            filter === 'templates'
              ? t('emptyTemplates')
              : query
                ? tc('noResults', { q: query })
                : t('emptyTitle')
          }
          description={filter === 'templates' ? t('emptyTemplatesHint') : t('empty')}
          action={
            can('quotes.write') && filter !== 'templates' ? (
              <Button onClick={() => setCreating(true)}>{t('new.title')}</Button>
            ) : null
          }
        />
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th className="hidden sm:table-cell">{t('number')}</Th>
              <Th>{t('titleColumn')}</Th>
              <Th className="hidden md:table-cell">{t('customer')}</Th>
              <Th align="right">{t('totalGross')}</Th>
              <Th align="right">{tc('status')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className="hover:bg-line-soft/40">
                <Td className="hidden font-mono text-[13px] text-muted sm:table-cell">{x.number ?? '—'}</Td>
                <Td>
                  <Link
                    href={`/devis/${x.id}`}
                    className="flex min-h-11 flex-col justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="font-medium hover:underline">{x.title}</span>
                    <span className="text-[12px] text-muted">
                      <span className="sm:hidden">{x.number} · </span>
                      {x.viewedAt && x.status === 'viewed'
                        ? t('viewedAgo', { date: relative(x.viewedAt) })
                        : t('updatedAgo', { date: relative(x.updatedAt) })}
                      {x.version > 1 ? ` · ${t('versionN', { n: x.version })}` : ''}
                    </span>
                  </Link>
                </Td>
                <Td className="hidden md:table-cell">{x.customerName ?? '—'}</Td>
                <Td align="right">{formatEuros(BigInt(x.totalGross))}</Td>
                <Td align="right">
                  <Chip tone={QUOTE_STATUS_TONES[x.status]} dot>
                    {x.isTemplate ? t('template') : t(`status.${x.status}`)}
                  </Chip>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating ? <NewQuoteDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
