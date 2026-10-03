'use client';

import type { DashboardDto } from '@batimint/contracts';
import { brusselsDate, formatEuros, formatPercent } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  CardTitle,
  Chip,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Segmented,
  SelectField,
  Skeleton,
  Table,
  Td,
  TextField,
  Th,
} from '@batimint/ui';
import { BarChart3, FileSpreadsheet, Landmark } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { ExportButtons } from '@/components/ExportButtons';
import { MoneyInput } from '@/components/MoneyInput';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export const euros = (c: number) => formatEuros(BigInt(c));
export const compactEuros = (c: number) =>
  `${new Intl.NumberFormat('fr-BE', { notation: 'compact', maximumFractionDigits: 1 }).format(c / 100)} €`;
const dayFr = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const monthFr = (m: string) =>
  new Intl.DateTimeFormat('fr-BE', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

/** Filtres de période partagés par le tableau de bord et les rapports (dans l'URL). */
export function useReportFilters() {
  const search = useSearchParams();
  const period =
    (['month', 'quarter', 'year', 'custom'] as const).find((p) => p === search.get('periode')) ?? 'month';
  return {
    period,
    from: search.get('du') ?? undefined,
    to: search.get('au') ?? undefined,
    teamId: search.get('equipe') ?? undefined,
    managerId: search.get('responsable') ?? undefined,
  };
}

export function filtersQuery(f: ReturnType<typeof useReportFilters>, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ period: f.period, ...extra });
  if (f.period === 'custom' && f.from && f.to) {
    q.set('from', f.from);
    q.set('to', f.to);
  }
  if (f.teamId) q.set('teamId', f.teamId);
  if (f.managerId) q.set('managerId', f.managerId);
  return q;
}

export function ReportFilters({
  options,
  showScope = true,
}: {
  options?: DashboardDto['options'];
  showScope?: boolean;
}) {
  const t = useTranslations('dashboard.filters');
  const router = useRouter();
  const search = useSearchParams();
  const f = useReportFilters();
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`?${q.toString()}`);
  };
  const today = brusselsDate(new Date());
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t('label')} className="flex flex-wrap items-end gap-3">
        <Segmented<PeriodKind>
          label={t('period')}
          value={f.period}
          onChange={(v) =>
            set({
              periode: v === 'month' ? null : v,
              ...(v === 'custom'
                ? { du: f.from ?? `${today.slice(0, 7)}-01`, au: f.to ?? today }
                : { du: null, au: null }),
            })
          }
          options={(['month', 'quarter', 'year', 'custom'] as const).map((p) => ({ value: p, label: t(p) }))}
        />
        {f.period === 'custom' ? (
          <>
            <TextField
              label={t('from')}
              type="date"
              value={f.from ?? ''}
              onChange={(e) => set({ du: e.target.value })}
              containerClassName="w-40"
            />
            <TextField
              label={t('to')}
              type="date"
              value={f.to ?? ''}
              onChange={(e) => set({ au: e.target.value })}
              containerClassName="w-40"
            />
          </>
        ) : null}
        {showScope && options ? (
          <>
            <SelectField
              label={t('team')}
              value={f.teamId ?? ''}
              onChange={(e) => set({ equipe: e.target.value || null })}
              options={[
                { value: '', label: t('allTeams') },
                ...options.teams.map((x) => ({ value: x.id, label: x.name })),
              ]}
              containerClassName="w-48"
            />
            <SelectField
              label={t('manager')}
              value={f.managerId ?? ''}
              onChange={(e) => set({ responsable: e.target.value || null })}
              options={[
                { value: '', label: t('allManagers') },
                ...options.managers.map((x) => ({ value: x.id, label: x.name })),
              ]}
              containerClassName="w-48"
            />
          </>
        ) : null}
      </div>
      {showScope && (f.teamId || f.managerId) ? (
        <p className="text-[13px] text-muted">{t('scopeHint')}</p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | null;
  tone?: 'crit';
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border border-line bg-surface px-4 py-3.5">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="text-[22px] font-semibold tracking-[-0.01em] tabular-nums">{value}</span>
      {sub ? (
        <span className={`text-[13px] ${tone === 'crit' ? 'text-crit' : 'text-muted'}`}>{sub}</span>
      ) : null}
    </div>
  );
}

/** Tableau de bord (02 P11) : chiffres recalculés depuis les données, filtrables. */
export function DashboardView() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const f = useReportFilters();
  const search = useSearchParams();
  const [balanceOpen, setBalanceOpen] = useState(false);
  const q = filtersQuery(f);
  const data = useApi<DashboardDto>(
    ['invoices', 'dashboard', q.toString()],
    can('reports.read') ? `/dashboard?${q}` : null,
  );

  if (!can('reports.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const d = data.data;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Link
            href={`/pilotage/rapports${search.toString() ? `?${search.toString()}` : ''}`}
            className={buttonClasses('secondary', 'md', 'gap-1.5')}
          >
            <FileSpreadsheet aria-hidden className="size-4" />
            {t('reports')}
          </Link>
        }
      />
      <ReportFilters options={d?.options} />
      {data.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(data.error)}
          action={<Button onClick={() => void data.refetch()}>{tc('retry')}</Button>}
        />
      ) : !d ? (
        <Skeleton className="h-96" />
      ) : (
        <div className={`flex flex-col gap-6 ${data.isFetching ? 'opacity-70' : ''}`}>
          <section
            className="grid grid-cols-2 gap-3 lg:grid-cols-3"
            aria-label={t('title')}
            data-testid="dashboard-kpis"
          >
            <Stat label={t('kpis.invoiced')} value={euros(d.kpis.invoiced)} />
            <Stat label={t('kpis.collected')} value={euros(d.kpis.collected)} />
            <Stat
              label={t('kpis.outstanding')}
              value={euros(d.kpis.outstanding)}
              sub={d.kpis.overdue ? t('kpis.overdue', { amount: euros(d.kpis.overdue) }) : null}
              tone="crit"
            />
            <Stat label={t('kpis.orderBook')} value={euros(d.kpis.orderBook)} />
            <Stat
              label={t('kpis.marginRate')}
              value={d.kpis.marginRate ? formatPercent(d.kpis.marginRate) : t('kpis.noRate')}
            />
            <Stat
              label={t('kpis.quotes')}
              value={d.kpis.quotes.rate ? formatPercent(d.kpis.quotes.rate) : t('kpis.noRate')}
              sub={t('kpis.quotesDetail', {
                signed: d.kpis.quotes.signed,
                decided: d.kpis.quotes.signed + d.kpis.quotes.refused + d.kpis.quotes.expired,
                open: d.kpis.quotes.open,
              })}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="flex flex-col gap-3 p-5">
              <CardTitle>{t('months.title')}</CardTitle>
              <ColumnChart
                label={t('months.title')}
                tableLabel={t('months.table')}
                firstColumnLabel={t('months.month')}
                series={[
                  { key: 'invoiced', label: t('months.invoiced'), color: 'var(--chart-1)' },
                  { key: 'collected', label: t('months.collected'), color: 'var(--chart-2)' },
                ]}
                data={d.months.map((m) => ({
                  key: m.month,
                  label: monthFr(m.month),
                  title: monthFr(m.month),
                  values: [m.invoiced, m.collected],
                }))}
                format={euros}
                formatAxis={compactEuros}
              />
            </Card>
            <Card className="flex flex-col gap-3 p-5" data-testid="dashboard-cash">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5">
                  <CardTitle>{t('cash.title')}</CardTitle>
                  <p className="text-[13px] text-muted">
                    {d.cash.openingBalance !== null
                      ? `${t('cash.subtitle')} · ${t('cash.balanceOn', { amount: euros(d.cash.openingBalance), date: dayFr(d.cash.openingBalanceOn!) })}`
                      : t('cash.subtitleNoBalance')}
                  </p>
                </div>
                {can('settings.update') ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Landmark aria-hidden className="size-4" />}
                    onClick={() => setBalanceOpen(true)}
                  >
                    {t('cash.setBalance')}
                  </Button>
                ) : null}
              </div>
              <ColumnChart
                label={t('cash.title')}
                tableLabel={t('cash.table')}
                firstColumnLabel={t('cash.week', { date: '' }).trim()}
                series={[{ key: 'balance', label: t('cash.balance'), color: 'var(--chart-1)' }]}
                data={d.cash.weeks.map((w) => ({
                  key: w.start,
                  label: `${w.start.slice(8, 10)}/${w.start.slice(5, 7)}`,
                  title: t('cash.week', { date: dayFr(w.start) }),
                  values: [w.balance],
                  extra: [
                    { label: t('cash.in'), value: euros(w.inflow) },
                    { label: t('cash.out'), value: euros(w.outflow) },
                  ],
                }))}
                format={euros}
                formatAxis={compactEuros}
              />
              <ul className="flex flex-col gap-1 text-[13px]">
                {d.cash.lowest ? (
                  <li className={d.cash.lowest.balance < 0 ? 'font-medium text-crit' : 'text-muted'}>
                    {t('cash.lowest', {
                      amount: euros(d.cash.lowest.balance),
                      date: dayFr(d.cash.lowest.date),
                    })}
                  </li>
                ) : null}
                {d.cash.overdue.inflow ? (
                  <li className="text-muted">
                    {t('cash.overdueIn', { amount: euros(d.cash.overdue.inflow) })}
                  </li>
                ) : null}
                <li className="text-muted">{t('cash.payroll', { amount: euros(d.cash.monthlyPayroll) })}</li>
              </ul>
              <Link
                href="/pilotage/rapports?rapport=tresorerie"
                className="self-start text-[14px] font-medium hover:underline"
              >
                {t('cash.details')}
              </Link>
            </Card>
          </div>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[17px] font-semibold">{t('projects.title')}</h2>
              {can('exports.read') ? (
                <ExportButtons
                  path="/reports/profitability/export"
                  params={Object.fromEntries(filtersQuery(f, { groupBy: 'project' }))}
                />
              ) : null}
            </div>
            {d.projects.length ? (
              <Table label={t('projects.title')}>
                <thead>
                  <tr>
                    <Th>{t('projects.project')}</Th>
                    <Th align="right">{t('projects.sold')}</Th>
                    <Th align="right" className="hidden md:table-cell">
                      {t('projects.projected')}
                    </Th>
                    <Th align="right">{t('projects.margin')}</Th>
                    <Th align="right" className="hidden sm:table-cell">
                      {t('projects.progress')}
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {d.projects.map((p) => (
                    <tr key={p.project.id}>
                      <Td>
                        <Link href={`/chantiers/${p.project.id}`} className="font-medium hover:underline">
                          {p.project.name}
                        </Link>
                        <span className="block text-[12px] text-muted">
                          {p.project.number} · {p.customer}
                        </span>
                        {p.drifting ? (
                          <Chip tone="crit" dot className="mt-1">
                            {t('projects.drifting')}
                          </Chip>
                        ) : null}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {euros(p.sold)}
                      </Td>
                      <Td align="right" className="hidden tabular-nums md:table-cell">
                        {euros(p.projectedCost)}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        <span className={p.margin < 0 ? 'text-crit' : ''}>{euros(p.margin)}</span>
                        <span className="block text-[12px] text-muted">
                          {p.marginRate ? formatPercent(p.marginRate) : '—'}
                        </span>
                      </Td>
                      <Td align="right" className="hidden tabular-nums sm:table-cell">
                        {formatPercent(p.progress, 0)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState icon={<BarChart3 aria-hidden className="size-5" />} title={t('projects.empty')} />
            )}
          </section>
        </div>
      )}
      {balanceOpen && d ? (
        <CashBalanceDialog current={d.cash.openingBalance} onClose={() => setBalanceOpen(false)} />
      ) : null}
    </div>
  );
}

function CashBalanceDialog({ current, onClose }: { current: number | null; onClose: () => void }) {
  const t = useTranslations('dashboard.cash');
  const tc = useTranslations('common');
  const [amount, setAmount] = useState(current ?? 0);
  const [on, setOn] = useState(brusselsDate(new Date()));
  const save = useApiMutation<void>(
    () => ({ path: '/dashboard/cash-balance', method: 'PUT', body: { amount, on } }),
    {
      invalidate: [['invoices']],
      successMessage: t('saved'),
      onSuccess: onClose,
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('balanceTitle')}
      description={t('balanceDescription')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput label={t('amount')} cents={amount} onChange={setAmount} />
        <TextField label={t('on')} type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </div>
    </Dialog>
  );
}
