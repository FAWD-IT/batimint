'use client';

import type { AccountingMappingDto, AccountingOverviewDto, AccountingSyncDto } from '@batimint/contracts';
import { brusselsDate, formatEuros } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Segmented,
  SelectField,
  Skeleton,
  Table,
  Td,
  TextField,
  Th,
  type Tone,
} from '@batimint/ui';
import { Calculator, ChevronDown, Download, Link2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Fragment, useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type StatusFilter = 'all' | 'error' | 'waiting' | 'synced';
const STATUS_TONE: Record<AccountingSyncDto['status'], Tone> = {
  synced: 'good',
  error: 'crit',
  waiting: 'warn',
  pending: 'neutral',
};
const euros = (c: number) => formatEuros(BigInt(c));
const dayFr = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

/** Comptabilité (02 P12) : connexion, statut par document, reprise, exports, paramétrage. */
export function AccountingView() {
  const t = useTranslations('accounting');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const search = useSearchParams();
  const errorMessage = useErrorMessage();
  const filter = (['error', 'waiting', 'synced'] as const).find((s) => s === search.get('statut')) ?? 'all';
  const readable = can('accounting.read');
  // Le temps réel met la liste à jour ; un rafraîchissement lent couvre une connexion perdue.
  const overview = useApi<AccountingOverviewDto>(
    ['accounting', 'overview'],
    readable ? '/accounting' : null,
    {
      refetchInterval: 15_000,
    },
  );
  const docs = useApi<{ items: AccountingSyncDto[] }>(
    ['accounting', 'documents', filter],
    readable ? `/accounting/documents${filter === 'all' ? '' : `?status=${filter}`}` : null,
    { refetchInterval: 15_000 },
  );
  const invalidate = [['accounting']];
  const connect = useApiMutation<void, AccountingOverviewDto>(
    () => ({ path: '/accounting/connect', method: 'POST' }),
    {
      invalidate,
      successMessage: t('connection.connectedToast'),
    },
  );
  const retryAll = useApiMutation<void, { queued: number }>(
    () => ({ path: '/accounting/retry', method: 'POST' }),
    {
      invalidate,
      successMessage: (r) => t('retried', { n: r.queued }),
    },
  );

  if (!readable) return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const o = overview.data;
  const err = overview.error ?? docs.error;
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader title={t('title')} description={t('description')} />
      {err ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(err)}
          action={
            <Button
              onClick={() => {
                void overview.refetch();
                void docs.refetch();
              }}
            >
              {tc('retry')}
            </Button>
          }
        />
      ) : !o ? (
        <Skeleton className="h-72" />
      ) : (
        <>
          <Card
            className="flex flex-wrap items-center justify-between gap-4 p-5"
            data-testid="accounting-connection"
          >
            <div className="flex flex-col gap-1">
              <CardTitle>{t('connection.title')}</CardTitle>
              {o.connection.status === 'active' ? (
                <p className="flex flex-wrap items-center gap-2 text-[14px]">
                  <Chip tone="good" dot>
                    {t('connection.connected', { software: o.connection.software ?? 'Chift' })}
                  </Chip>
                  {o.connection.connectedAt ? (
                    <span className="text-muted">
                      {t('connection.since', { date: dayFr(o.connection.connectedAt) })}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="max-w-2xl text-[14px] text-muted">
                  {o.connection.status === 'error'
                    ? `${t('connection.error')} : ${o.connection.lastError ?? ''}`
                    : t('connection.notConnectedText')}
                </p>
              )}
            </div>
            {o.connection.status !== 'active' ? (
              can('integrations.manage') ? (
                <Button
                  icon={<Link2 aria-hidden className="size-4" />}
                  loading={connect.isPending}
                  onClick={() => connect.mutate()}
                >
                  {t('connection.connect')}
                </Button>
              ) : (
                <p className="text-[13px] text-muted">{t('connection.askAdmin')}</p>
              )
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label={t('filters.label')}>
                {(['synced', 'waiting', 'error'] as const).map((s) => (
                  <li key={s}>
                    <Chip tone={o.counts[s] && s !== 'synced' ? STATUS_TONE[s] : 'neutral'}>
                      {t(`counts.${s}`)} : {o.counts[s]}
                    </Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented<StatusFilter>
                label={t('filters.label')}
                value={filter}
                onChange={(v) => router.replace(v === 'all' ? '/comptabilite' : `/comptabilite?statut=${v}`)}
                options={(['all', 'error', 'waiting', 'synced'] as const).map((s) => ({
                  value: s,
                  label: t(`filters.${s}`),
                  count: s === 'all' || s === 'synced' ? undefined : o.counts[s] || undefined,
                }))}
              />
              {o.counts.error + o.counts.waiting > 0 && o.connection.status === 'active' ? (
                <Button
                  variant="secondary"
                  icon={<RefreshCw aria-hidden className="size-4" />}
                  loading={retryAll.isPending}
                  onClick={() => retryAll.mutate()}
                >
                  {t('retryAll')}
                </Button>
              ) : null}
            </div>
            {docs.isLoading ? (
              <Skeleton className="h-48" />
            ) : (docs.data?.items ?? []).length === 0 ? (
              <EmptyState
                icon={<Calculator aria-hidden className="size-5" />}
                title={filter === 'all' ? t('empty') : t('emptyFiltered')}
              />
            ) : (
              <DocumentsTable items={docs.data!.items} />
            )}
          </section>

          {can('exports.read') ? <Exports /> : null}
          {can('accounting.manage') ? <Mapping overview={o} /> : null}
        </>
      )}
    </div>
  );
}

const PAGE = 25;
const RANK: Record<AccountingSyncDto['status'], number> = { error: 0, waiting: 1, pending: 2, synced: 3 };

function DocumentsTable({ items: all }: { items: AccountingSyncDto[] }) {
  const t = useTranslations('accounting');
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  // Les documents à traiter d'abord, puis les plus récents.
  const sorted = [...all].sort((a, b) => RANK[a.status] - RANK[b.status] || b.date.localeCompare(a.date));
  const items = sorted.slice(0, shown);
  const retry = useApiMutation<string, { queued: number }>(
    (id) => ({ path: `/accounting/documents/${id}/retry`, method: 'POST' }),
    {
      invalidate: [['accounting']],
      successMessage: (r) => t('retried', { n: r.queued }),
    },
  );
  return (
    <div className="flex flex-col gap-3">
      <Table label={t('title')}>
        <thead>
          <tr>
            <Th>{t('cols.date')}</Th>
            <Th>{t('cols.number')}</Th>
            <Th className="hidden md:table-cell">{t('cols.partner')}</Th>
            <Th align="right" className="hidden sm:table-cell">
              {t('cols.amount')}
            </Th>
            <Th>{t('cols.status')}</Th>
            <Th align="right">{/* actions */}</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <Fragment key={d.id}>
              <tr className="align-top">
                <Td className="whitespace-nowrap text-[13px]">
                  {dayFr(d.date)}
                  <span className="block text-muted">{t(`types.${d.documentType}`)}</span>
                </Td>
                <Td>
                  <Link href={d.link} className="font-medium hover:underline">
                    {d.number}
                  </Link>
                  <span className="block text-[12px] text-muted md:hidden">{d.partner}</span>
                </Td>
                <Td className="hidden md:table-cell">{d.partner}</Td>
                <Td align="right" className="hidden tabular-nums sm:table-cell">
                  {euros(d.amount)}
                </Td>
                <Td>
                  <Chip tone={STATUS_TONE[d.status]} dot>
                    {t(`status.${d.status}`)}
                  </Chip>
                  {d.lastError ? (
                    <p role="note" className="mt-1 max-w-md text-[13px] text-crit">
                      {d.lastError}
                    </p>
                  ) : null}
                </Td>
                <Td align="right">
                  <span className="flex justify-end gap-1.5">
                    {d.status === 'error' || d.status === 'waiting' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={retry.isPending && retry.variables === d.id}
                        onClick={() => retry.mutate(d.id)}
                        aria-label={`${t('retry')} ${d.number}`}
                      >
                        {t('retry')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-expanded={open === d.id}
                      aria-label={t('entry.show', { number: d.number })}
                      onClick={() => setOpen((x) => (x === d.id ? null : d.id))}
                      icon={
                        <ChevronDown
                          aria-hidden
                          className={`size-4 transition-transform ${open === d.id ? 'rotate-180' : ''}`}
                        />
                      }
                    />
                  </span>
                </Td>
              </tr>
              {open === d.id ? (
                <tr>
                  <td colSpan={6} className="bg-line-soft/40 px-4 py-3">
                    {d.lines.length ? (
                      <div className="flex flex-col gap-2 text-[13px]">
                        <p className="text-muted">
                          {[
                            d.journal ? t('entry.journal', { journal: d.journal }) : null,
                            t('entry.attempts', { n: d.attempts }),
                            d.externalId ? t('entry.external', { id: d.externalId }) : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        <table className="w-full max-w-3xl tabular-nums">
                          <thead>
                            <tr className="text-left text-muted">
                              <th className="py-1 pr-3 font-medium">{t('entry.account')}</th>
                              <th className="py-1 pr-3 font-medium">{t('entry.label')}</th>
                              <th className="py-1 pr-3 font-medium">{t('entry.vat')}</th>
                              <th className="py-1 pr-3 font-medium">{t('entry.grid')}</th>
                              <th className="py-1 pr-3 text-right font-medium">{t('entry.debit')}</th>
                              <th className="py-1 text-right font-medium">{t('entry.credit')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {d.lines.map((l, i) => (
                              <tr key={i} className="border-t border-line-soft">
                                <td className="py-1 pr-3 font-mono">{l.account}</td>
                                <td className="py-1 pr-3">{l.label}</td>
                                <td className="py-1 pr-3">{l.vatCode ?? ''}</td>
                                <td className="py-1 pr-3">{l.vatGrid ?? ''}</td>
                                <td className="py-1 pr-3 text-right">{l.debit ? euros(l.debit) : ''}</td>
                                <td className="py-1 text-right">{l.credit ? euros(l.credit) : ''}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-[13px] text-muted">{t('entry.none')}</p>
                    )}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </Table>
      {sorted.length > shown ? (
        <Button variant="secondary" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
          {t('more', { n: sorted.length - shown })}
        </Button>
      ) : null}
    </div>
  );
}

function Exports() {
  const t = useTranslations('accounting.exports');
  const today = brusselsDate(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const href = (kind: string, format?: string) =>
    `/api/v1/accounting/exports/${kind}?${new URLSearchParams({ from, to, ...(format ? { format } : {}) })}`;
  const invalid = !from || !to || to < from;
  return (
    <Card className="flex flex-col gap-4 p-5" data-testid="accounting-exports">
      <div className="flex flex-col gap-1">
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-[14px] text-muted">{t('description')}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <TextField
          label={t('from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          containerClassName="w-44"
        />
        <TextField
          label={t('to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          containerClassName="w-44"
        />
      </div>
      <div
        className={`flex flex-wrap gap-2 ${invalid ? 'pointer-events-none opacity-50' : ''}`}
        aria-disabled={invalid}
      >
        {(['sales', 'purchases', 'payments'] as const).map((k) =>
          (['csv', 'xlsx'] as const).map((f) => (
            <a
              key={`${k}-${f}`}
              href={href(k, f)}
              download
              className={buttonClasses('secondary', 'sm', 'gap-1.5')}
            >
              <Download aria-hidden className="size-4" />
              {t(k)} · {f === 'csv' ? 'CSV' : 'Excel'}
            </a>
          )),
        )}
        <a href={href('sales-ubl')} download className={buttonClasses('secondary', 'sm', 'gap-1.5')}>
          <Download aria-hidden className="size-4" />
          {t('salesUbl')}
        </a>
        <a
          href={href('purchases-documents')}
          download
          className={buttonClasses('secondary', 'sm', 'gap-1.5')}
        >
          <Download aria-hidden className="size-4" />
          {t('purchasesDocuments')}
        </a>
      </div>
    </Card>
  );
}

function Mapping({ overview }: { overview: AccountingOverviewDto }) {
  const t = useTranslations('accounting.mapping');
  const [m, setM] = useState<AccountingMappingDto>(overview.mapping);
  const save = useApiMutation<void, AccountingOverviewDto>(
    () => ({ path: '/accounting/mapping', method: 'PUT', body: m }),
    {
      invalidate: [['accounting']],
      successMessage: t('saved'),
    },
  );
  const ledger = overview.ledger;
  const opts = (list: { value: string; label: string }[], current: string) =>
    list.some((o) => o.value === current) || !current ? list : [{ value: current, label: current }, ...list];
  const accounts = ledger.accounts.map((a) => ({ value: a.number, label: `${a.number} · ${a.label}` }));
  const journals = ledger.journals.map((j) => ({ value: j.code, label: `${j.code} · ${j.label}` }));
  const vat = (scope: string) =>
    ledger.vatCodes
      .filter((v) => v.scope === scope)
      .map((v) => ({ value: v.code, label: `${v.code} · ${v.label}` }));
  const field = (
    label: string,
    value: string,
    list: { value: string; label: string }[],
    onChange: (v: string) => void,
  ) =>
    list.length ? (
      <SelectField
        key={label}
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={opts(list, value)}
      />
    ) : (
      <TextField key={label} label={label} value={value} onChange={(e) => onChange(e.target.value)} />
    );
  const accountKeys = Object.keys(m.accounts) as (keyof AccountingMappingDto['accounts'])[];
  const journalKeys: [keyof AccountingMappingDto['journals'], string][] = [
    ['sales', 'salesJournal'],
    ['creditNotes', 'creditNotes'],
    ['purchases', 'purchasesJournal'],
    ['bank', 'bankJournal'],
  ];
  return (
    <Card className="p-5" data-testid="accounting-mapping">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent">
          <span className="flex flex-col gap-1">
            <CardTitle>{t('title')}</CardTitle>
            <span className="text-[14px] text-muted">{t('description')}</span>
          </span>
          <ChevronDown
            aria-hidden
            className="mt-1 size-5 shrink-0 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          {!ledger.accounts.length ? <Notice tone="warn">{t('notConnected')}</Notice> : null}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[15px] font-semibold">{t('accounts')}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {accountKeys.map((k) =>
                field(t(`fields.${k}`), m.accounts[k], accounts, (v) =>
                  setM((x) => ({ ...x, accounts: { ...x.accounts, [k]: v } })),
                ),
              )}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[15px] font-semibold">{t('journals')}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {journalKeys.map(([k, label]) =>
                field(t(`fields.${label}`), m.journals[k], journals, (v) =>
                  setM((x) => ({ ...x, journals: { ...x.journals, [k]: v } })),
                ),
              )}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[15px] font-semibold">{t('salesVat')}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(m.salesVatCodes) as (keyof AccountingMappingDto['salesVatCodes'])[]).map((k) =>
                field(t(`fields.${k}`), m.salesVatCodes[k], vat('sale'), (v) =>
                  setM((x) => ({ ...x, salesVatCodes: { ...x.salesVatCodes, [k]: v } })),
                ),
              )}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-[15px] font-semibold">{t('purchaseVat')}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(m.purchaseVatCodes) as (keyof AccountingMappingDto['purchaseVatCodes'])[]).map(
                (k) =>
                  field(t(`purchaseFields.${k}`), m.purchaseVatCodes[k], vat('purchase'), (v) =>
                    setM((x) => ({ ...x, purchaseVatCodes: { ...x.purchaseVatCodes, [k]: v } })),
                  ),
              )}
            </div>
          </fieldset>
          <Button className="self-start" loading={save.isPending} onClick={() => save.mutate()}>
            {t('save')}
          </Button>
        </div>
      </details>
    </Card>
  );
}
