'use client';

import type {
  CashForecastDto,
  HoursReportDto,
  OrderBookReportDto,
  ProfitabilityReportDto,
  QuotesReportDto,
} from '@batimint/contracts';
import { formatPercent } from '@batimint/domain';
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
import { FileSpreadsheet } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExportButtons } from '@/components/ExportButtons';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { euros, filtersQuery, ReportFilters, useReportFilters } from './DashboardView';

type Tab = 'profitability' | 'hours' | 'quotes' | 'orderBook' | 'cash';
const PARAM: Record<Tab, string> = {
  profitability: 'rentabilite',
  hours: 'heures',
  quotes: 'devis',
  orderBook: 'carnet',
  cash: 'tresorerie',
};
const ENDPOINT: Record<Tab, string> = {
  profitability: 'profitability',
  hours: 'hours',
  quotes: 'quotes',
  orderBook: 'order-book',
  cash: 'cash-forecast',
};
const hours = (m: number) =>
  `${new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 }).format(m / 60)} h`;
const dayFr = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

/** Rapports (03 §12) : rentabilité, heures, devis, carnet de commandes, trésorerie ; exports. */
export function ReportsView() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const search = useSearchParams();
  const errorMessage = useErrorMessage();
  const f = useReportFilters();
  const tab =
    (Object.keys(PARAM) as Tab[]).find((k) => PARAM[k] === search.get('rapport')) ?? 'profitability';
  const groupBy =
    tab === 'hours'
      ? search.get('par') === 'chantier'
        ? 'project'
        : 'person'
      : (({ client: 'customer', type: 'trade' } as Record<string, string>)[search.get('par') ?? ''] ??
        'project');
  const q = filtersQuery(f, tab === 'profitability' || tab === 'hours' ? { groupBy } : {});
  const data = useApi<unknown>(
    ['invoices', 'report', tab, q.toString()],
    can('reports.read') ? `/reports/${ENDPOINT[tab]}?${q}` : null,
  );
  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    router.replace(`?${p.toString()}`);
  };
  if (!can('reports.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/pilotage" className="hover:underline">
            {t('back')}
          </Link>
        }
        title={t('title')}
        actions={
          can('exports.read') ? (
            <ExportButtons path={`/reports/${ENDPOINT[tab]}/export`} params={Object.fromEntries(q)} />
          ) : null
        }
      />
      <Segmented<Tab>
        label={t('tabs.label')}
        value={tab}
        onChange={(v) => set({ rapport: v === 'profitability' ? null : PARAM[v], par: null })}
        options={(Object.keys(PARAM) as Tab[]).map((k) => ({ value: k, label: t(`tabs.${k}`) }))}
      />
      {tab !== 'orderBook' && tab !== 'cash' ? <ReportFilters showScope={tab === 'profitability'} /> : null}
      {tab === 'profitability' || tab === 'hours' ? (
        <Segmented<string>
          label={t('groupBy')}
          value={groupBy}
          onChange={(v) =>
            set({
              par:
                (
                  {
                    customer: 'client',
                    trade: 'type',
                    project: tab === 'hours' ? 'chantier' : null,
                    person: null,
                  } as Record<string, string | null>
                )[v] ?? null,
            })
          }
          options={(tab === 'hours' ? ['person', 'project'] : ['project', 'customer', 'trade']).map((g) => ({
            value: g,
            label: t(`by.${g}`),
          }))}
        />
      ) : null}
      {data.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(data.error)}
          action={<Button onClick={() => void data.refetch()}>{tc('retry')}</Button>}
        />
      ) : !data.data ? (
        <Skeleton className="h-72" />
      ) : tab === 'profitability' ? (
        <Profitability r={data.data as ProfitabilityReportDto} />
      ) : tab === 'hours' ? (
        <Hours r={data.data as HoursReportDto} />
      ) : tab === 'quotes' ? (
        <Quotes r={data.data as QuotesReportDto} />
      ) : tab === 'orderBook' ? (
        <OrderBook r={data.data as OrderBookReportDto} />
      ) : (
        <Cash r={data.data as CashForecastDto} />
      )}
    </div>
  );
}

function Empty() {
  const t = useTranslations('reports');
  return <EmptyState icon={<FileSpreadsheet aria-hidden className="size-5" />} title={t('empty')} />;
}

function Profitability({ r }: { r: ProfitabilityReportDto }) {
  const t = useTranslations('reports');
  if (!r.rows.length) return <Empty />;
  const row = (x: ProfitabilityReportDto['totals'], total = false) => (
    <tr key={x.key} className={total ? 'font-semibold' : ''}>
      <Td>{total ? t('total') : x.label}</Td>
      {r.groupBy === 'project' ? null : (
        <Td align="right" className="hidden tabular-nums sm:table-cell">
          {x.count}
        </Td>
      )}
      <Td align="right" className="tabular-nums">
        {euros(x.sold)}
      </Td>
      <Td align="right" className="hidden tabular-nums md:table-cell">
        {euros(x.cost)}
      </Td>
      <Td align="right" className="tabular-nums">
        <span className={x.margin < 0 ? 'text-crit' : ''}>{euros(x.margin)}</span>
      </Td>
      <Td align="right" className="tabular-nums">
        {x.marginRate ? formatPercent(x.marginRate) : '—'}
      </Td>
    </tr>
  );
  return (
    <Table label={t('tabs.profitability')}>
      <thead>
        <tr>
          <Th>{t(`by.${r.groupBy}`)}</Th>
          {r.groupBy === 'project' ? null : (
            <Th align="right" className="hidden sm:table-cell">
              {t('cols.count')}
            </Th>
          )}
          <Th align="right">{t('cols.sold')}</Th>
          <Th align="right" className="hidden md:table-cell">
            {t('cols.cost')}
          </Th>
          <Th align="right">{t('cols.margin')}</Th>
          <Th align="right">{t('cols.marginRate')}</Th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((x) => row(x))}
        {row(r.totals, true)}
      </tbody>
    </Table>
  );
}

function Hours({ r }: { r: HoursReportDto }) {
  const t = useTranslations('reports');
  if (!r.rows.length) return <Empty />;
  return (
    <Table label={t('tabs.hours')}>
      <thead>
        <tr>
          <Th>{t(`by.${r.groupBy}`)}</Th>
          <Th align="right">{t('cols.actual')}</Th>
          <Th align="right">{t('cols.planned')}</Th>
          <Th align="right">{t('cols.variance')}</Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('cols.ratio')}
          </Th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((x) => (
          <tr key={x.key}>
            <Td>{x.label}</Td>
            <Td align="right" className="tabular-nums">
              {hours(x.actualMinutes)}
            </Td>
            <Td align="right" className="tabular-nums">
              {hours(x.plannedMinutes)}
            </Td>
            <Td align="right" className="tabular-nums">
              <span className={x.varianceMinutes > 0 && x.plannedMinutes ? 'text-warn' : ''}>
                {x.varianceMinutes > 0 ? '+' : ''}
                {hours(x.varianceMinutes)}
              </span>
            </Td>
            <Td align="right" className="hidden tabular-nums sm:table-cell">
              {x.ratio ? formatPercent(x.ratio, 0) : '—'}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Quotes({ r }: { r: QuotesReportDto }) {
  const t = useTranslations('reports');
  const c = r.conversion;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[14px] text-muted">
        {t('conversion', { signed: c.signed, sent: c.sent, rate: c.rate ? formatPercent(c.rate) : '—' })}
      </p>
      {r.rows.length ? (
        <Table label={t('tabs.quotes')}>
          <thead>
            <tr>
              <Th>{t('cols.title')}</Th>
              <Th className="hidden md:table-cell">{t('cols.customer')}</Th>
              <Th className="hidden sm:table-cell">{t('cols.sentAt')}</Th>
              <Th>{t('cols.status')}</Th>
              <Th align="right">{t('cols.amount')}</Th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.id}>
                <Td>
                  <Link href={`/devis/${x.id}`} className="font-medium hover:underline">
                    {x.title}
                  </Link>
                  {x.number ? <span className="block text-[12px] text-muted">{x.number}</span> : null}
                </Td>
                <Td className="hidden md:table-cell">{x.customer}</Td>
                <Td className="hidden sm:table-cell">{x.sentAt ? dayFr(x.sentAt) : '—'}</Td>
                <Td>
                  <Chip
                    tone={
                      x.status === 'signed'
                        ? 'good'
                        : x.status === 'refused' || x.status === 'expired'
                          ? 'crit'
                          : 'neutral'
                    }
                  >
                    {t(`quoteStatus.${x.status}` as 'quoteStatus.sent')}
                  </Chip>
                </Td>
                <Td align="right" className="tabular-nums">
                  {euros(x.amount)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <Empty />
      )}
    </div>
  );
}

function OrderBook({ r }: { r: OrderBookReportDto }) {
  const t = useTranslations('reports');
  if (!r.rows.length) return <Empty />;
  return (
    <Table label={t('tabs.orderBook')}>
      <thead>
        <tr>
          <Th>{t('by.project')}</Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('cols.contract')}
          </Th>
          <Th align="right" className="hidden md:table-cell">
            {t('cols.invoiced')}
          </Th>
          <Th align="right">{t('cols.remaining')}</Th>
          <Th className="hidden md:table-cell">{t('cols.endDate')}</Th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((x) => (
          <tr key={x.project.id}>
            <Td>
              <Link href={`/chantiers/${x.project.id}`} className="font-medium hover:underline">
                {x.project.name}
              </Link>
              <span className="block text-[12px] text-muted">
                {x.project.number} · {x.customer}
              </span>
            </Td>
            <Td align="right" className="hidden tabular-nums sm:table-cell">
              {euros(x.contract)}
            </Td>
            <Td align="right" className="hidden tabular-nums md:table-cell">
              {euros(x.invoiced)}
            </Td>
            <Td align="right" className="font-semibold tabular-nums">
              {euros(x.remaining)}
            </Td>
            <Td className="hidden md:table-cell">{x.endDate ? dayFr(x.endDate) : '—'}</Td>
          </tr>
        ))}
        <tr className="font-semibold">
          <Td>{t('total')}</Td>
          <Td className="hidden sm:table-cell" />
          <Td className="hidden md:table-cell" />
          <Td align="right" className="tabular-nums">
            {euros(r.total)}
          </Td>
          <Td className="hidden md:table-cell" />
        </tr>
      </tbody>
    </Table>
  );
}

function Cash({ r }: { r: CashForecastDto }) {
  const t = useTranslations('reports');
  if (!r.items.length) return <Empty />;
  return (
    <Table label={t('tabs.cash')}>
      <thead>
        <tr>
          <Th>{t('cols.date')}</Th>
          <Th className="hidden sm:table-cell">{t('cols.kind')}</Th>
          <Th>{t('cols.label')}</Th>
          <Th align="right">{t('cols.in')}</Th>
          <Th align="right">{t('cols.out')}</Th>
        </tr>
      </thead>
      <tbody>
        {r.items.map((x, i) => (
          <tr key={`${x.kind}-${x.label}-${i}`}>
            <Td className="whitespace-nowrap">
              {dayFr(x.expectedOn)}
              {x.overdue ? (
                <Chip tone="crit" className="ml-1.5">
                  {t('overdue')}
                </Chip>
              ) : null}
            </Td>
            <Td className="hidden sm:table-cell">{t(`cashKinds.${x.kind}`)}</Td>
            <Td>
              {x.link ? (
                <Link href={x.link} className="hover:underline">
                  {x.label}
                </Link>
              ) : (
                x.label
              )}
            </Td>
            <Td align="right" className="tabular-nums text-good">
              {x.direction === 'in' ? euros(x.amount) : ''}
            </Td>
            <Td align="right" className="tabular-nums">
              {x.direction === 'out' ? euros(x.amount) : ''}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
