'use client';

import type { CustomerDto } from '@batimint/contracts';
import {
  Avatar,
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
import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CustomerDialog } from '@/components/crm/CustomerDialog';
import { SearchInput } from '@/components/SearchInput';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';
import { useNewParam } from '@/lib/use-new-param';

type StatusFilter = 'all' | 'prospect' | 'customer';

export function CustomersView() {
  const t = useTranslations('customers');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  useNewParam(() => can('customers.write') && setCreating(true));
  const query = useDebounced(q.trim(), 180);
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (status !== 'all') params.set('status', status);
  const list = useApi<{ items: CustomerDto[]; total: number }>(
    ['customers', query, status],
    can('customers.read') ? `/customers?${params.toString()}` : null,
  );
  const canWrite = can('customers.write');

  if (!can('customers.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const items = list.data?.items ?? [];
  const isFiltered = Boolean(query) || status !== 'all';

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={list.data ? t('count', { count: list.data.total }) : undefined}
        actions={
          canWrite ? (
            <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
              {t('new')}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          label={t('search')}
          placeholder={t('search')}
          value={q}
          onChange={setQ}
          clearLabel={tc('close')}
          loading={list.isFetching && Boolean(query)}
          className="sm:max-w-md"
        />
        <Segmented<StatusFilter>
          label={tc('filter')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: tc('all') },
            { value: 'prospect', label: t('statusPlural.prospect') },
            { value: 'customer', label: t('statusPlural.customer') },
          ]}
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
        isFiltered ? (
          <EmptyState
            title={query ? tc('noResults', { q: query }) : t('emptyFiltered')}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setQ('');
                  setStatus('all');
                }}
              >
                {t('clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Users aria-hidden className="size-5" />}
            title={t('title')}
            description={t('empty')}
            action={canWrite ? <Button onClick={() => setCreating(true)}>{t('new')}</Button> : null}
          />
        )
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th>{tc('name')}</Th>
              <Th className="hidden sm:table-cell">{t('type')}</Th>
              <Th className="hidden md:table-cell">{t('contact')}</Th>
              <Th className="hidden lg:table-cell">{t('peppol')}</Th>
              <Th align="right">{tc('status')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="hover:bg-line-soft/40">
                <Td>
                  <Link
                    href={`/clients/${c.id}`}
                    className="flex min-h-11 items-center gap-3 rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <Avatar name={c.displayName} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium hover:underline">{c.displayName}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {[c.postalCode, c.city].filter(Boolean).join(' ') || '—'}
                      </span>
                    </span>
                  </Link>
                </Td>
                <Td className="hidden sm:table-cell">
                  <span className="inline-flex items-center gap-2">
                    {t(`kind.${c.kind}`)}
                    {c.kind === 'company' && c.vatLiable ? <Chip>{t('b2b')}</Chip> : null}
                  </span>
                </Td>
                <Td className="hidden md:table-cell">
                  <span className="block truncate text-[13px]">{c.email ?? '—'}</span>
                  <span className="block text-[13px] text-muted tabular-nums">{c.phone ?? ''}</span>
                </Td>
                <Td className="hidden lg:table-cell">
                  <PeppolChip customer={c} />
                </Td>
                <Td align="right">
                  <Chip tone={c.status === 'customer' ? 'good' : 'accent'} dot>
                    {t(`status.${c.status}`)}
                  </Chip>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating ? (
        <CustomerDialog onClose={() => setCreating(false)} onSaved={(c) => router.push(`/clients/${c.id}`)} />
      ) : null}
    </div>
  );
}

export function PeppolChip({ customer }: { customer: CustomerDto }) {
  const t = useTranslations('customers');
  if (customer.kind !== 'company') return <span className="text-[13px] text-muted">{t('b2c')}</span>;
  if (customer.peppolReachable === true) return <Chip tone="good">{t('peppolReachable')}</Chip>;
  if (customer.peppolReachable === false) return <Chip tone="warn">{t('peppolUnreachableShort')}</Chip>;
  return <span className="text-[13px] text-muted">{t('peppolUnknown')}</span>;
}
