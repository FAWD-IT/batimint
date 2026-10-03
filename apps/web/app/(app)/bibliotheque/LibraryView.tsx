'use client';

import type { ItemDto } from '@batimint/contracts';
import { formatEuros, formatPercent, marginRate } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  Skeleton,
  Switch,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { BookOpen, Layers, Plus, Upload } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SearchInput } from '@/components/SearchInput';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';
import { ItemDrawer } from './ItemDrawer';
import { StarterLibraries } from './StarterLibraries';

type KindFilter = 'all' | 'material' | 'labour' | 'assembly' | 'other';
const KIND_QUERY: Record<KindFilter, string | null> = {
  all: null,
  material: 'material',
  labour: 'labour',
  assembly: 'assembly',
  other: 'subcontracting,equipment,lump_sum',
};
const PAGE = 100;

export function LibraryView() {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [archived, setArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<{ id: string | null; kind: 'material' | 'assembly' } | null>(null);
  const query = useDebounced(q.trim(), 150);
  const params = new URLSearchParams({ limit: String(limit) });
  if (query) params.set('q', query);
  if (KIND_QUERY[kind]) params.set('kind', KIND_QUERY[kind]!);
  if (archived) params.set('archived', 'true');
  const list = useApi<{ items: ItemDto[]; total: number }>(
    ['items', query, kind, archived, limit],
    can('library.read') ? `/items?${params.toString()}` : null,
  );
  const canWrite = can('library.write');
  const showPrices = can('pricing.read');

  if (!can('library.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const items = list.data?.items ?? [];
  const isFiltered = Boolean(query) || kind !== 'all' || archived;
  const libraryEmpty = !isFiltered && list.data?.total === 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={list.data && !libraryEmpty ? t('results', { count: list.data.total }) : undefined}
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Link href="/bibliotheque/import" className={buttonClasses('ghost')}>
                <Upload aria-hidden className="size-4" />
                {t('import')}
              </Link>
              <Button
                variant="secondary"
                icon={<Layers aria-hidden className="size-4" />}
                onClick={() => setEditing({ id: null, kind: 'assembly' })}
              >
                {t('newAssembly')}
              </Button>
              <Button
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => setEditing({ id: null, kind: 'material' })}
              >
                {t('new')}
              </Button>
            </div>
          ) : null
        }
      />

      {libraryEmpty ? (
        <>
          <EmptyState
            icon={<BookOpen aria-hidden className="size-5" />}
            title={t('emptyTitle')}
            description={t('empty')}
            action={
              canWrite ? (
                <Link href="/bibliotheque/import" className={buttonClasses('secondary')}>
                  {t('import')}
                </Link>
              ) : null
            }
          />
          {canWrite ? <StarterLibraries /> : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SearchInput
              label={t('search')}
              placeholder={t('search')}
              value={q}
              onChange={(v) => {
                setQ(v);
                setLimit(PAGE);
              }}
              clearLabel={tc('close')}
              loading={list.isFetching && Boolean(query)}
              className="lg:max-w-md"
              autoFocus
            />
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <Segmented<KindFilter>
                label={tc('filter')}
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setLimit(PAGE);
                }}
                options={[
                  { value: 'all', label: tc('all') },
                  { value: 'material', label: t('kindPlural.material') },
                  { value: 'labour', label: t('kindPlural.labour') },
                  { value: 'assembly', label: t('kindPlural.assembly') },
                  { value: 'other', label: t('kindPlural.other') },
                ]}
              />
            </div>
            <div className="lg:ml-auto">
              <Switch label={t('showArchived')} checked={archived} onChange={setArchived} />
            </div>
          </div>

          {list.error ? (
            <ErrorState
              title={tc('errorTitle')}
              description={errorMessage(list.error)}
              action={<Button onClick={() => void list.refetch()}>{tc('retry')}</Button>}
            />
          ) : list.isLoading ? (
            <Skeleton className="h-96" />
          ) : items.length === 0 ? (
            <EmptyState
              title={query ? tc('noResults', { q: query }) : t('emptyFiltered')}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ('');
                    setKind('all');
                    setArchived(false);
                  }}
                >
                  {t('clearFilters')}
                </Button>
              }
            />
          ) : (
            <>
              <Table label={t('title')}>
                <thead>
                  <tr>
                    <Th className="hidden sm:table-cell">{t('code')}</Th>
                    <Th>{t('name')}</Th>
                    <Th className="hidden md:table-cell">{t('unit')}</Th>
                    {showPrices ? (
                      <>
                        <Th align="right" className="hidden md:table-cell">
                          {t('purchasePrice')}
                        </Th>
                        <Th align="right">{t('salePrice')}</Th>
                        <Th align="right" className="hidden lg:table-cell">
                          {t('margin')}
                        </Th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const sale = i.effectiveSalePrice ?? null;
                    const rate =
                      sale !== null && i.purchasePrice !== undefined
                        ? marginRate(BigInt(sale), BigInt(i.purchasePrice))
                        : null;
                    return (
                      <tr key={i.id} className="hover:bg-line-soft/40">
                        <Td className="hidden font-mono text-[13px] text-muted sm:table-cell">{i.code}</Td>
                        <Td>
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({ id: i.id, kind: i.kind === 'assembly' ? 'assembly' : 'material' })
                            }
                            className="flex min-h-11 flex-col items-start rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            <span className="flex items-center gap-2 font-medium hover:underline">
                              {i.name}
                              {i.kind === 'assembly' ? <Chip tone="accent">{t('kind.assembly')}</Chip> : null}
                              {i.archived ? <Chip>{t('archivedChip')}</Chip> : null}
                            </span>
                            <span className="text-[12px] text-muted">
                              <span className="sm:hidden">{i.code} · </span>
                              {[t(`kind.${i.kind}`), i.category].filter(Boolean).join(' · ')}
                            </span>
                          </button>
                        </Td>
                        <Td className="hidden md:table-cell">{i.unit}</Td>
                        {showPrices ? (
                          <>
                            <Td align="right" className="hidden md:table-cell">
                              {i.purchasePrice !== undefined ? formatEuros(BigInt(i.purchasePrice)) : '—'}
                            </Td>
                            <Td align="right">
                              <span className="font-medium">
                                {sale !== null ? formatEuros(BigInt(sale)) : '—'}
                              </span>
                              {i.salePrice !== null && i.salePrice !== undefined ? (
                                <span className="block text-[11px] text-muted">{t('forced')}</span>
                              ) : null}
                            </Td>
                            <Td align="right" className="hidden lg:table-cell">
                              {rate ? (
                                <span className={rate.isNegative() ? 'text-crit' : undefined}>
                                  {formatPercent(rate)}
                                </span>
                              ) : (
                                '—'
                              )}
                            </Td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {list.data && !query && list.data.total > items.length ? (
                <Button
                  variant="secondary"
                  className="self-center"
                  onClick={() => setLimit((l) => l + PAGE)}
                  loading={list.isFetching}
                >
                  {tc('loadMore')} ({items.length} / {list.data.total})
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      {editing ? (
        <ItemDrawer
          id={editing.id}
          newKind={editing.kind}
          onClose={() => setEditing(null)}
          onCreated={(item) =>
            setEditing({ id: item.id, kind: item.kind === 'assembly' ? 'assembly' : 'material' })
          }
        />
      ) : null}
    </div>
  );
}
