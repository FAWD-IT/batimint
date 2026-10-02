'use client';

import type { DiscrepancyDto, ProjectDto, ProjectSummaryDto, SupplierInvoiceDto } from '@batimint/contracts';
import { formatEuros, formatQuantity } from '@batimint/domain';
import {
  Button,
  Card,
  Chip,
  Drawer,
  ErrorState,
  Notice,
  SelectField,
  Skeleton,
  Spinner,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Sparkles, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { formatDay, INVOICE_STATUS_TONES } from './status';

const ALLOCATABLE = new Set(['received', 'to_allocate', 'allocated']);

/** Détail d'une facture fournisseur : document, rapprochement, écarts, imputation et statut (02 P6). */
export function InvoiceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('purchasing.invoice');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const invoice = useApi<SupplierInvoiceDto>(['supplier_invoices', 'detail', id], `/supplier-invoices/${id}`);
  const i = invoice.data;
  return (
    <Drawer
      open
      onClose={onClose}
      title={i ? i.supplier.name : t('title')}
      description={
        i ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={INVOICE_STATUS_TONES[i.status] ?? 'neutral'} dot>
              {t(`status.${i.status}`)}
            </Chip>
            {i.number ? <span className="font-mono">{i.number}</span> : null}
            <span>{t(`source.${i.source}`)}</span>
          </span>
        ) : undefined
      }
      closeLabel={tc('close')}
      className="w-[min(100vw,760px)]"
    >
      {invoice.error ? (
        <ErrorState title={t('notFound')} description={errorMessage(invoice.error)} />
      ) : !i ? (
        <Skeleton className="h-96" />
      ) : (
        <InvoiceBody invoice={i} />
      )}
    </Drawer>
  );
}

function InvoiceBody({ invoice: i }: { invoice: SupplierInvoiceDto }) {
  const t = useTranslations('purchasing.invoice');
  const can = useCan();
  const queryClient = useQueryClient();
  const [splitting, setSplitting] = useState(false);
  const canAllocate = can('supplier_invoices.allocate') && ALLOCATABLE.has(i.status);
  const invalidate = [['supplier_invoices'], ['project'], ['purchase_orders']];
  const setDetail = (dto: SupplierInvoiceDto) =>
    queryClient.setQueryData(['supplier_invoices', 'detail', i.id], dto);

  const allocate = useApiMutation<{ projectId: string; budgetLineId: string | null }, SupplierInvoiceDto>(
    (a) => ({
      path: `/supplier-invoices/${i.id}/allocate`,
      body: { allocations: [{ ...a, amount: i.totalNet }] },
    }),
    { invalidate, successMessage: t('allocated'), onSuccess: setDetail },
  );
  const status = useApiMutation<{ to: string }, SupplierInvoiceDto>(
    (b) => ({ path: `/supplier-invoices/${i.id}/status`, body: b }),
    {
      invalidate,
      successMessage: (_r, v) => t(`statusChanged.${v.to}`),
      onSuccess: setDetail,
    },
  );

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-4">
        <Fact label={t('issueDate')} value={formatDay(i.issueDate)} />
        <Fact label={t('dueDate')} value={formatDay(i.dueDate)} />
        <Fact label={t('orderReference')} value={i.purchaseOrder?.number ?? i.orderReference ?? '—'} mono />
        <Fact label={t('supplierVat')} value={i.supplier.vatNumber ?? '—'} mono />
      </dl>

      <Card className="grid grid-cols-3 gap-3 p-4">
        <Amount label={t('net')} cents={i.totalNet} strong />
        <Amount label={t('vat')} cents={i.totalVat} />
        <Amount label={t('gross')} cents={i.totalGross} />
      </Card>

      {i.documentUrl ? (
        <a
          href={i.documentUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[8px] text-[14px] font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ExternalLink aria-hidden className="size-4" />
          {t('document')}
        </a>
      ) : null}

      {i.status === 'received' ? (
        <Notice tone="neutral">
          <span className="flex items-center gap-2">
            <Spinner className="size-4" label={t('reading')} />
            {t('reading')}
          </span>
        </Notice>
      ) : null}

      {i.matchMethod && i.matchMethod !== 'manual' && i.project ? (
        <Notice tone="good">
          {t(`match.${i.matchMethod}`, {
            project: `${i.project.number} · ${i.project.name}`,
            order: i.purchaseOrder?.number ?? '',
          })}
        </Notice>
      ) : null}

      {i.discrepancies.length ? <Discrepancies items={i.discrepancies} /> : null}

      {i.allocations.length ? (
        <section aria-labelledby={`alloc-${i.id}`} className="flex flex-col gap-2">
          <h3 id={`alloc-${i.id}`} className="text-[15px] font-semibold">
            {t('allocations')}
          </h3>
          <ul className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-line">
            {i.allocations.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-[14px]">
                <span className="min-w-0">
                  <Link
                    href={`/chantiers/${a.projectId}?onglet=achats`}
                    className="font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {a.projectLabel}
                  </Link>
                  <span className="block text-[13px] text-muted">{a.budgetLineLabel ?? t('noPost')}</span>
                </span>
                <span className="tabular-nums">{formatEuros(BigInt(a.amount))}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canAllocate &&
      i.status !== 'received' &&
      !splitting &&
      i.suggestions.length &&
      !i.allocations.length ? (
        <section aria-labelledby={`sugg-${i.id}`} className="flex flex-col gap-2">
          <h3 id={`sugg-${i.id}`} className="flex items-center gap-2 text-[15px] font-semibold">
            <Sparkles aria-hidden className="size-4 text-accent" />
            {t('suggestions')}
          </h3>
          <ol className="flex flex-col gap-2">
            {i.suggestions.map((s, index) => (
              <li
                key={`${s.projectId}-${s.budgetLineId ?? 'none'}`}
                className="flex flex-col gap-3 rounded-[12px] border border-line p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {s.projectLabel}
                    {s.budgetLineLabel ? <span className="text-muted"> · {s.budgetLineLabel}</span> : null}
                  </p>
                  <p className="text-[13px] text-muted">
                    {t('confidence', { n: Math.min(99, Math.floor(s.score * 100)) })} · {s.reason}
                  </p>
                </div>
                <Button
                  variant={index === 0 ? 'primary' : 'secondary'}
                  size="sm"
                  loading={allocate.isPending && allocate.variables?.projectId === s.projectId}
                  disabled={allocate.isPending}
                  onClick={() => allocate.mutate({ projectId: s.projectId, budgetLineId: s.budgetLineId })}
                  aria-label={t('allocateTo', { project: s.projectLabel })}
                >
                  {t('allocateHere')}
                </Button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {canAllocate && i.status !== 'received' && i.totalNet !== 0 ? (
        splitting ? (
          <SplitEditor invoice={i} onDone={() => setSplitting(false)} />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSplitting(true)}>
              {i.allocations.length ? t('reallocate') : t('split')}
            </Button>
          </div>
        )
      ) : null}

      <section aria-labelledby={`lines-${i.id}`} className="flex flex-col gap-2">
        <h3 id={`lines-${i.id}`} className="text-[15px] font-semibold">
          {t('lines')}
        </h3>
        <Table label={t('lines')}>
          <thead>
            <tr>
              <Th>{t('description')}</Th>
              <Th align="right" className="hidden sm:table-cell">
                {t('quantity')}
              </Th>
              <Th align="right" className="hidden sm:table-cell">
                {t('unitPrice')}
              </Th>
              <Th align="right">{t('net')}</Th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l, index) => (
              <tr key={index}>
                <Td>
                  <span className="block">{l.description}</span>
                  {l.supplierCode ? (
                    <span className="font-mono text-[12px] text-muted">{l.supplierCode}</span>
                  ) : null}
                  <span className="block text-[12px] text-muted sm:hidden">
                    {formatQuantity(l.quantity)} × {formatEuros(BigInt(l.unitPrice))}
                  </span>
                </Td>
                <Td align="right" className="hidden tabular-nums sm:table-cell">
                  {formatQuantity(l.quantity)}
                </Td>
                <Td align="right" className="hidden tabular-nums sm:table-cell">
                  {formatEuros(BigInt(l.unitPrice))}
                </Td>
                <Td align="right" className="tabular-nums">
                  {formatEuros(BigInt(l.net))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      {can('supplier_invoices.allocate') ? (
        <StatusActions
          status={i.status}
          pending={status.isPending ? (status.variables?.to ?? null) : null}
          onChange={(to) => status.mutate({ to })}
        />
      ) : null}
    </div>
  );
}

function StatusActions({
  status,
  pending,
  onChange,
}: {
  status: SupplierInvoiceDto['status'];
  pending: string | null;
  onChange: (to: string) => void;
}) {
  const t = useTranslations('purchasing.invoice.actions');
  const next: { to: string; variant: 'primary' | 'secondary' | 'danger' }[] =
    status === 'allocated'
      ? [{ to: 'validated', variant: 'primary' }]
      : status === 'validated'
        ? [
            { to: 'to_pay', variant: 'primary' },
            { to: 'blocked', variant: 'secondary' },
          ]
        : status === 'to_pay'
          ? [
              { to: 'paid', variant: 'primary' },
              { to: 'blocked', variant: 'secondary' },
            ]
          : status === 'blocked'
            ? [{ to: 'to_pay', variant: 'primary' }]
            : [];
  if (!next.length) return null;
  return (
    <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft pt-4">
      {next.map((n) => (
        <Button
          key={n.to}
          variant={n.variant}
          loading={pending === n.to}
          disabled={pending !== null}
          onClick={() => onChange(n.to)}
        >
          {status === 'blocked' && n.to === 'to_pay' ? t('unblock') : t(n.to)}
        </Button>
      ))}
    </div>
  );
}

function Discrepancies({ items }: { items: DiscrepancyDto[] }) {
  const t = useTranslations('purchasing.invoice.discrepancy');
  return (
    <Notice tone="warn" title={t('title')}>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
        {items.map((d, index) => (
          <li key={index}>
            {d.kind === 'price'
              ? t('price', {
                  description: d.description,
                  ordered: formatEuros(BigInt(d.ordered)),
                  invoiced: formatEuros(BigInt(d.invoiced)),
                  percent: d.percent.toLocaleString('fr-BE', { maximumFractionDigits: 1 }),
                })
              : d.kind === 'quantity'
                ? t('quantity', {
                    description: d.description,
                    ordered: formatQuantity(d.ordered),
                    invoiced: formatQuantity(d.invoiced),
                  })
                : d.kind === 'unordered'
                  ? t('unordered', { description: d.description, amount: formatEuros(BigInt(d.amount)) })
                  : t('total', {
                      ordered: formatEuros(BigInt(d.ordered)),
                      invoiced: formatEuros(BigInt(d.invoiced)),
                      percent: d.percent.toLocaleString('fr-BE', { maximumFractionDigits: 1 }),
                    })}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Ventilation sur un ou plusieurs chantiers et postes
// ---------------------------------------------------------------------------

interface Row {
  key: string;
  projectId: string;
  budgetLineId: string | null;
  amount: number;
}

function SplitEditor({ invoice: i, onDone }: { invoice: SupplierInvoiceDto; onDone: () => void }) {
  const t = useTranslations('purchasing.invoice.splitEditor');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const projects = useApi<{ items: ProjectSummaryDto[] }>(
    ['project', 'list', 'allocation'],
    '/projects?view=all&limit=200',
  );
  const [rows, setRows] = useState<Row[]>(() =>
    i.allocations.length
      ? i.allocations.map((a) => ({
          key: a.id,
          projectId: a.projectId,
          budgetLineId: a.budgetLineId,
          amount: a.amount,
        }))
      : [
          {
            key: uuidv7(),
            projectId: i.suggestions[0]?.projectId ?? i.project?.id ?? '',
            budgetLineId: i.suggestions[0]?.budgetLineId ?? null,
            amount: i.totalNet,
          },
        ],
  );
  const [error, setError] = useState<string | null>(null);
  const sum = rows.reduce((s, r) => s + r.amount, 0);
  const remaining = i.totalNet - sum;
  const save = useApiMutation<void, SupplierInvoiceDto>(
    () => ({
      path: `/supplier-invoices/${i.id}/allocate`,
      body: {
        allocations: rows.map((r) => ({
          projectId: r.projectId,
          budgetLineId: r.budgetLineId,
          amount: r.amount,
        })),
      },
    }),
    {
      invalidate: [['supplier_invoices'], ['project'], ['purchase_orders']],
      successMessage: t('saved'),
      onSuccess: (dto) => {
        queryClient.setQueryData(['supplier_invoices', 'detail', i.id], dto);
        onDone();
      },
    },
  );
  const update = (key: string, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const submit = () => {
    if (rows.some((r) => !r.projectId)) return setError(t('missingProject'));
    if (rows.some((r) => r.amount <= 0)) return setError(t('missingAmount'));
    if (remaining !== 0) return setError(t('mismatch', { remaining: formatEuros(BigInt(remaining)) }));
    setError(null);
    save.mutate();
  };
  const options = [
    { value: '', label: t('chooseProject') },
    ...(projects.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.number} · ${p.name}` })),
  ];

  return (
    <section
      aria-labelledby={`split-${i.id}`}
      className="flex flex-col gap-4 rounded-[12px] border border-line p-4"
    >
      <h3 id={`split-${i.id}`} className="text-[15px] font-semibold">
        {t('title')}
      </h3>
      {projects.isLoading ? <Skeleton className="h-24" /> : null}
      <ul className="flex flex-col gap-4">
        {rows.map((r, index) => (
          <li
            key={r.key}
            className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_9rem_auto] sm:items-end"
          >
            <SelectField
              label={t('project', { n: index + 1 })}
              value={r.projectId}
              options={options}
              onChange={(e) => update(r.key, { projectId: e.target.value, budgetLineId: null })}
            />
            <PostSelect
              projectId={r.projectId}
              value={r.budgetLineId}
              label={t('post', { n: index + 1 })}
              onChange={(budgetLineId) => update(r.key, { budgetLineId })}
            />
            <MoneyInput
              label={t('amount', { n: index + 1 })}
              cents={r.amount}
              onChange={(amount) => update(r.key, { amount })}
            />
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11"
              aria-label={t('remove', { n: index + 1 })}
              disabled={rows.length === 1}
              onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
              icon={<Trash2 aria-hidden className="size-4" />}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus aria-hidden className="size-4" />}
          onClick={() =>
            setRows((list) => [
              ...list,
              { key: uuidv7(), projectId: '', budgetLineId: null, amount: Math.max(0, remaining) },
            ])
          }
        >
          {t('addRow')}
        </Button>
        <p
          className={remaining === 0 ? 'text-[14px] text-good' : 'text-[14px] font-semibold text-warn'}
          aria-live="polite"
        >
          {remaining === 0 ? t('balanced') : t('remaining', { amount: formatEuros(BigInt(remaining)) })}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-crit">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {tc('cancel')}
        </Button>
        <Button onClick={submit} loading={save.isPending}>
          {t('save')}
        </Button>
      </div>
    </section>
  );
}

function PostSelect({
  projectId,
  value,
  label,
  onChange,
}: {
  projectId: string;
  value: string | null;
  label: string;
  onChange: (id: string | null) => void;
}) {
  const t = useTranslations('purchasing.invoice.splitEditor');
  const project = useApi<ProjectDto>(['project', projectId], projectId ? `/projects/${projectId}` : null);
  return (
    <SelectField
      label={label}
      value={value ?? ''}
      disabled={!projectId || project.isLoading}
      options={[
        { value: '', label: t('noPost') },
        ...(project.data?.budgetLines ?? []).map((b) => ({ value: b.id, label: b.label })),
      ]}
      onChange={(e) => onChange(e.target.value || null)}
    />
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-[13px]' : undefined}>{value}</dd>
    </div>
  );
}

function Amount({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] text-muted">{label}</span>
      <span className={strong ? 'text-[18px] font-semibold tabular-nums' : 'text-[15px] tabular-nums'}>
        {formatEuros(BigInt(cents))}
      </span>
    </div>
  );
}
