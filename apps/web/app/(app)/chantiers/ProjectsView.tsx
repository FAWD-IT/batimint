'use client';

import type { ProjectSummaryDto } from '@batimint/contracts';
import { dec, formatEuros, formatPercent, percentInt } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Chip,
  EmptyState,
  ErrorState,
  Gauge,
  PageHeader,
  Segmented,
  Skeleton,
  StatusDot,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { formatDay, HEALTH_TONES, PROJECT_STATUS_TONES } from '@/components/projects/status';
import { SearchInput } from '@/components/SearchInput';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';

type View = 'active' | 'preparation' | 'finished' | 'all';

/** Liste des chantiers : avancement, contrat et marge estimée recalculés depuis les données. */
export function ProjectsView() {
  const t = useTranslations('projects');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [view, setView] = useState<View>('active');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 200);
  const params = new URLSearchParams({ view });
  if (query) params.set('q', query);
  const list = useApi<{ items: ProjectSummaryDto[] }>(
    ['projects', 'list', view, query],
    can('projects.read') ? `/projects?${params.toString()}` : null,
  );
  if (!can('projects.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = list.data?.items ?? [];
  const finance = can('projects.finance.read');
  const prices = can('pricing.read');

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={t('title')} />
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
            options={(['active', 'preparation', 'finished', 'all'] as const).map((v) => ({
              value: v,
              label: t(`views.${v}`),
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
          icon={<Building2 aria-hidden className="size-5" />}
          title={query ? tc('noResults', { q: query }) : t('emptyTitle')}
          description={view === 'all' && !query ? t('empty') : t('emptyView')}
          action={
            can('quotes.read') && view === 'all' && !query ? (
              <Link href="/devis" className={buttonClasses('secondary')}>
                {t('goQuotes')}
              </Link>
            ) : null
          }
        />
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th>{t('columns.project')}</Th>
              <Th className="hidden md:table-cell">{t('columns.city')}</Th>
              <Th className="w-40">{t('columns.progress')}</Th>
              {prices ? (
                <Th align="right" className="hidden lg:table-cell">
                  {t('columns.contract')}
                </Th>
              ) : null}
              {finance ? (
                <Th align="right" className="hidden sm:table-cell">
                  {t('columns.margin')}
                </Th>
              ) : null}
              <Th className="hidden lg:table-cell">{t('columns.end')}</Th>
              <Th align="right">{tc('status')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const pct = percentInt(p.progress);
              const slip =
                p.estimatedMargin && p.plannedMargin
                  ? dec(p.plannedMargin).minus(p.estimatedMargin).greaterThan('0.005')
                  : false;
              return (
                <tr key={p.id} className="hover:bg-line-soft/40">
                  <Td>
                    <Link
                      href={`/chantiers/${p.id}`}
                      className="flex min-h-11 items-center gap-2.5 rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      <StatusDot tone={HEALTH_TONES[p.health]} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium hover:underline">{p.name}</span>
                        <span className="truncate text-[12px] text-muted">
                          {p.number} · {p.customer.displayName}
                          <span className="md:hidden">{p.site ? ` · ${p.site.city}` : ''}</span>
                        </span>
                      </span>
                      <span className="sr-only">{t(`health.${p.health}`)}</span>
                    </Link>
                  </Td>
                  <Td className="hidden md:table-cell">{p.site?.city ?? '—'}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Gauge
                        value={pct / 100}
                        tone={p.status === 'suspended' ? 'warn' : 'ink'}
                        label={`${t('columns.progress')} ${pct} %`}
                        height={6}
                      />
                      <span className="w-10 shrink-0 text-right text-[13px] tabular-nums">{pct} %</span>
                    </div>
                  </Td>
                  {prices ? (
                    <Td align="right" className="hidden tabular-nums lg:table-cell">
                      {p.contractAmount !== undefined ? formatEuros(BigInt(p.contractAmount)) : '—'}
                    </Td>
                  ) : null}
                  {finance ? (
                    <Td align="right" className="hidden tabular-nums sm:table-cell">
                      {p.estimatedMargin ? (
                        <span className={slip ? 'font-semibold text-warn' : undefined}>
                          {formatPercent(dec(p.estimatedMargin))}
                        </span>
                      ) : (
                        '—'
                      )}
                      {p.plannedMargin ? (
                        <span className="block text-[11px] text-muted">
                          {t('margin.planned', { rate: formatPercent(dec(p.plannedMargin)) })}
                        </span>
                      ) : null}
                    </Td>
                  ) : null}
                  <Td className="hidden lg:table-cell">{formatDay(p.endDate)}</Td>
                  <Td align="right">
                    <Chip tone={PROJECT_STATUS_TONES[p.status]} dot>
                      {t(`status.${p.status}`)}
                    </Chip>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
