'use client';

import type { InvoiceDto } from '@batimint/contracts';
import {
  computeDocumentTotals,
  formatEuros,
  formatQuantity,
  formatStructuredCommunication,
  VAT_REGIME_LIST,
  type VatRegime,
} from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  Chip,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Notice,
  PageHeader,
  SelectField,
  Skeleton,
  Switch,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  CreditCard,
  FileDown,
  FileMinus,
  Mail,
  Plus,
  Send,
  Stamp,
  Trash2,
  Undo2,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { fromDecimal, toDecimal } from '@/components/quotes/quote-state';
import { ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { formatDay, INVOICE_TONES } from './status';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date());

export function InvoiceDetail({ id }: { id: string }) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const invoice = useApi<InvoiceDto>(['invoices', 'detail', id], `/invoices/${id}`);
  if (invoice.error)
    return (
      <ErrorState
        title={
          invoice.error instanceof ApiError && invoice.error.status === 404 ? t('notFound') : tc('errorTitle')
        }
        description={errorMessage(invoice.error)}
        action={
          <Link href="/facturation" className="text-accent underline">
            {t('backToList')}
          </Link>
        }
      />
    );
  if (!invoice.data)
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  const i = invoice.data;
  const editable = i.status === 'draft' && i.type !== 'progress' && i.type !== 'credit_note';
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/facturation" className="hover:underline">
            {t('title')}
          </Link>
        }
        title={
          i.number ? `${t(`type.${i.type}`)} ${i.number}` : t('draftTitle', { type: t(`type.${i.type}`) })
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={i.overdue ? 'crit' : (INVOICE_TONES[i.status] ?? 'neutral')} dot>
              {i.overdue ? t('lateChip', { n: i.daysLate }) : t(`status.${i.status}`)}
            </Chip>
            <span>{i.customer.displayName}</span>
            {i.project ? (
              <Link
                href={`/chantiers/${i.project.id}?onglet=facturation`}
                className="underline-offset-4 hover:underline"
              >
                {i.project.number} · {i.project.name}
              </Link>
            ) : null}
          </span>
        }
      />
      {i.status === 'draft' ? <DraftPanel invoice={i} editable={editable} /> : <IssuedPanel invoice={i} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brouillon : édition et émission
// ---------------------------------------------------------------------------

interface EditLine {
  key: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: number;
  vatRegime: VatRegime;
  budgetLineId: string | null;
}

function DraftPanel({ invoice: i, editable }: { invoice: InvoiceDto; editable: boolean }) {
  const t = useTranslations('billing.editor');
  const tb = useTranslations('billing');
  const tv = useTranslations('quotes.vat.long');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(i.title);
  const [intro, setIntro] = useState(i.intro ?? '');
  const [notes, setNotes] = useState(i.notes ?? '');
  const [terms, setTerms] = useState(String(i.paymentTermsDays));
  const [periodStart, setPeriodStart] = useState(i.servicePeriodStart ?? '');
  const [periodEnd, setPeriodEnd] = useState(i.servicePeriodEnd ?? '');
  const [lines, setLines] = useState<EditLine[]>(() =>
    i.lines.map((l) => ({
      key: l.id,
      description: l.description,
      unit: l.unit,
      quantity: fromDecimal(l.quantity.replace(/^-/, '')),
      unitPrice: l.unitPrice,
      vatRegime: l.vatRegime as VatRegime,
      budgetLineId: l.budgetLineId,
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const totals = useMemo(
    () =>
      computeDocumentTotals(
        lines.map((l) => ({
          quantity: toDecimal(l.quantity) ?? '0',
          unitPrice: BigInt(l.unitPrice),
          vatRegime: l.vatRegime,
        })),
      ),
    [lines],
  );
  const set =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };
  const update = (key: string, patch: Partial<EditLine>) => {
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const setDetail = (dto: InvoiceDto) => queryClient.setQueryData(['invoices', 'detail', dto.id], dto);
  const save = useApiMutation<{ then?: 'issue' }, InvoiceDto>(
    () => ({
      path: `/invoices/${i.id}`,
      method: 'PUT',
      body: {
        id: i.id,
        type: i.type,
        customerId: i.customer.id,
        projectId: i.project?.id ?? null,
        title: title.trim(),
        intro: intro.trim() || null,
        notes: notes.trim() || null,
        paymentTermsDays: Number(terms),
        servicePeriodStart: periodStart || null,
        servicePeriodEnd: periodEnd || null,
        lines: lines.map((l) => ({
          description: l.description.trim(),
          unit: l.unit.trim() || 'u',
          quantity: toDecimal(l.quantity)!,
          unitPrice: l.unitPrice,
          vatRegime: l.vatRegime,
          budgetLineId: l.budgetLineId,
        })),
      },
    }),
    {
      invalidate: [['invoices']],
      successMessage: (_r, v) => (v.then ? '' : t('saved')),
      onSuccess: (dto, v) => {
        setDetail(dto);
        setDirty(false);
        if (v.then === 'issue') setConfirmIssue(true);
      },
    },
  );
  const issue = useApiMutation<void, InvoiceDto>(
    () => ({ path: `/invoices/${i.id}/issue`, method: 'POST' }),
    {
      invalidate: [['invoices'], ['project']],
      successMessage: (dto) => t('issued', { number: dto.number ?? '' }),
      onSuccess: (dto) => {
        setDetail(dto);
        setConfirmIssue(false);
      },
    },
  );
  const remove = useApiMutation<void>(() => ({ path: `/invoices/${i.id}`, method: 'DELETE' }), {
    invalidate: [['invoices'], ['progress_statements']],
    successMessage: t('deleted'),
    onSuccess: () => router.push('/facturation?vue=draft'),
  });
  const fail = (message: string) => {
    setError(message);
    return false;
  };
  const validate = (): boolean => {
    if (title.trim().length < 1) return fail(t('errors.title'));
    if (!lines.length) return fail(t('errors.noLines'));
    if (lines.some((l) => !l.description.trim())) return fail(t('errors.description'));
    if (lines.some((l) => !toDecimal(l.quantity))) return fail(t('errors.quantity'));
    const days = Number(terms);
    if (!Number.isInteger(days) || days < 0 || days > 120) return fail(t('errors.terms'));
    setError(null);
    return true;
  };
  const onIssue = () => {
    if (editable && !validate()) return;
    if (editable && dirty) save.mutate({ then: 'issue' });
    else setConfirmIssue(true);
  };

  return (
    <div className="flex flex-col gap-6">
      {i.issueBlockers.length ? (
        <Notice tone="warn" title={t('blockers')}>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {i.issueBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {!editable ? (
        <Notice tone="neutral">
          {i.type === 'credit_note'
            ? t('generatedCredit', { number: i.creditedInvoice?.number ?? '' })
            : t('generatedProgress', { n: i.progressStatement?.ordinal ?? 0 })}
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-4 p-5">
        <TextField
          label={t('title')}
          value={title}
          disabled={!editable}
          onChange={(e) => set(setTitle)(e.target.value)}
        />
        {editable ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label={t('terms')}
              inputMode="numeric"
              value={terms}
              onChange={(e) => set(setTerms)(e.target.value)}
              trailing={<span className="pr-2 text-[14px] text-muted">{t('days')}</span>}
            />
            <TextField
              label={t('periodStart')}
              type="date"
              value={periodStart}
              onChange={(e) => set(setPeriodStart)(e.target.value)}
            />
            <TextField
              label={t('periodEnd')}
              type="date"
              value={periodEnd}
              onChange={(e) => set(setPeriodEnd)(e.target.value)}
            />
          </div>
        ) : null}
        {editable ? (
          <TextAreaField
            label={t('intro')}
            rows={2}
            value={intro}
            onChange={(e) => set(setIntro)(e.target.value)}
          />
        ) : null}
      </Card>

      <section aria-labelledby="inv-lines" className="flex flex-col gap-3">
        <h2 id="inv-lines" className="text-[17px] font-semibold">
          {t('lines')}
        </h2>
        {editable ? (
          <ul className="flex flex-col gap-3">
            {lines.map((l, index) => (
              <li
                key={l.key}
                className="grid gap-3 rounded-[12px] border border-line bg-surface p-3 sm:grid-cols-12"
              >
                <TextField
                  label={t('line.description', { n: index + 1 })}
                  containerClassName="sm:col-span-12"
                  value={l.description}
                  onChange={(e) => update(l.key, { description: e.target.value })}
                />
                <TextField
                  label={t('line.quantity')}
                  containerClassName="sm:col-span-2"
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => update(l.key, { quantity: e.target.value })}
                />
                <TextField
                  label={t('line.unit')}
                  containerClassName="sm:col-span-2"
                  value={l.unit}
                  onChange={(e) => update(l.key, { unit: e.target.value })}
                />
                <MoneyInput
                  label={t('line.unitPrice')}
                  className="sm:col-span-3"
                  cents={l.unitPrice}
                  onChange={(unitPrice) => update(l.key, { unitPrice })}
                />
                <SelectField
                  label={t('line.vat')}
                  containerClassName="sm:col-span-3"
                  value={l.vatRegime}
                  options={VAT_REGIME_LIST.map((r) => ({ value: r, label: tv(r) }))}
                  onChange={(e) => update(l.key, { vatRegime: e.target.value as VatRegime })}
                />
                <div className="flex items-end justify-end sm:col-span-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11"
                    disabled={lines.length === 1}
                    aria-label={t('line.remove', { n: index + 1 })}
                    icon={<Trash2 aria-hidden className="size-4" />}
                    onClick={() => {
                      setLines((list) => list.filter((x) => x.key !== l.key));
                      setDirty(true);
                    }}
                  />
                </div>
              </li>
            ))}
            <li>
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => {
                  setLines((list) => [
                    ...list,
                    {
                      key: uuidv7(),
                      description: '',
                      unit: 'u',
                      quantity: '1',
                      unitPrice: 0,
                      vatRegime: (list.at(-1)?.vatRegime ?? 'standard_21') as VatRegime,
                      budgetLineId: null,
                    },
                  ]);
                  setDirty(true);
                }}
              >
                {t('addLine')}
              </Button>
            </li>
          </ul>
        ) : (
          <LinesTable invoice={i} />
        )}
      </section>

      {editable ? (
        <TextAreaField
          label={t('notes')}
          rows={2}
          value={notes}
          onChange={(e) => set(setNotes)(e.target.value)}
        />
      ) : null}

      <Totals
        net={Number(totals.totalNet)}
        breakdown={totals.vatBreakdown.map((v) => ({
          category: v.category,
          ratePercent: v.ratePercent,
          taxableAmount: Number(v.taxableAmount),
          taxAmount: Number(v.taxAmount),
        }))}
        gross={Number(totals.totalGross)}
        credit={i.type === 'credit_note'}
      />

      {error ? (
        <p role="alert" className="text-[14px] text-crit">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {can('invoices.write') ? (
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            {t('delete')}
          </Button>
        ) : null}
        {editable && can('invoices.write') ? (
          <Button
            variant="secondary"
            loading={save.isPending && !save.variables?.then}
            disabled={!dirty}
            onClick={() => validate() && save.mutate({})}
          >
            {tc('save')}
          </Button>
        ) : null}
        {can('invoices.issue') ? (
          <Button
            icon={<Stamp aria-hidden className="size-4" />}
            disabled={i.issueBlockers.length > 0}
            loading={save.isPending && save.variables?.then === 'issue'}
            onClick={onIssue}
          >
            {t('issue')}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmIssue}
        onClose={() => setConfirmIssue(false)}
        onConfirm={() => issue.mutate()}
        title={t('issueTitle', { type: tb(`type.${i.type}`).toLowerCase() })}
        description={t('issueDescription', { gross: formatEuros(totals.totalGross) })}
        confirmLabel={t('issueConfirm')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        loading={issue.isPending}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={t('deleteTitle')}
        description={i.type === 'progress' ? t('deleteProgress') : t('deleteDescription')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}

function LinesTable({ invoice: i }: { invoice: InvoiceDto }) {
  const t = useTranslations('billing.editor');
  const tv = useTranslations('quotes.vat.short');
  return (
    <Table label={t('lines')}>
      <thead>
        <tr>
          <Th>{t('line.descriptionColumn')}</Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('line.quantity')}
          </Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('line.unitPrice')}
          </Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('line.vat')}
          </Th>
          <Th align="right">{t('line.net')}</Th>
        </tr>
      </thead>
      <tbody>
        {i.lines.map((l) => (
          <tr key={l.id}>
            <Td>
              <span className={l.kind === 'deduction' ? 'text-muted' : undefined}>{l.description}</span>
              <span className="block text-[12px] text-muted sm:hidden">
                {formatQuantity(l.quantity)} {l.unit} × {formatEuros(BigInt(l.unitPrice))} · {tv(l.vatRegime)}
              </span>
            </Td>
            <Td align="right" className="hidden tabular-nums sm:table-cell">
              {formatQuantity(l.quantity)} {l.unit}
            </Td>
            <Td align="right" className="hidden tabular-nums sm:table-cell">
              {formatEuros(BigInt(l.unitPrice))}
            </Td>
            <Td align="right" className="hidden sm:table-cell">
              {tv(l.vatRegime)}
            </Td>
            <Td align="right" className="tabular-nums">
              {formatEuros(BigInt(l.netAmount))}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Totals({
  net,
  breakdown,
  gross,
  credit,
  retention,
  balance,
}: {
  net: number;
  breakdown: { category: string; ratePercent: string; taxableAmount: number; taxAmount: number }[];
  gross: number;
  credit?: boolean;
  retention?: { percent: string; amount: number } | null;
  balance?: number;
}) {
  const t = useTranslations('billing.totals');
  const row = (label: string, value: string, strong = false, testId?: string) => (
    <div key={label} className="flex justify-between gap-6 py-1">
      <dt className={strong ? 'font-semibold' : 'text-muted'}>{label}</dt>
      <dd className={strong ? 'text-[17px] font-bold tabular-nums' : 'tabular-nums'} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
  return (
    <dl className="ml-auto flex w-full max-w-sm flex-col text-[14px]">
      {row(t('net'), formatEuros(BigInt(net)))}
      {breakdown.map((v) =>
        row(
          v.category === 'AE'
            ? t('reverseCharge', { base: formatEuros(BigInt(v.taxableAmount)) })
            : t('vat', { rate: v.ratePercent, base: formatEuros(BigInt(v.taxableAmount)) }),
          formatEuros(BigInt(v.taxAmount)),
        ),
      )}
      {row(credit ? t('creditGross') : t('gross'), formatEuros(BigInt(gross)), true, 'invoice-gross')}
      {retention && retention.amount > 0
        ? row(t('retention', { percent: retention.percent }), `− ${formatEuros(BigInt(retention.amount))}`)
        : null}
      {balance !== undefined
        ? row(t('balance'), formatEuros(BigInt(balance)), true, 'invoice-balance')
        : null}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Facture émise : documents, envoi, paiements, relances, notes de crédit
// ---------------------------------------------------------------------------

function IssuedPanel({ invoice: i }: { invoice: InvoiceDto }) {
  const t = useTranslations('billing.issued');
  const tb = useTranslations('billing');
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const [undo, setUndo] = useState<string | null>(null);
  const credit = i.type === 'credit_note';
  const setDetail = (dto: InvoiceDto) => queryClient.setQueryData(['invoices', 'detail', dto.id], dto);
  const link = useApiMutation<void, { url: string; amount: number }>(
    () => ({ path: `/invoices/${i.id}/payment-link`, method: 'POST' }),
    {
      onSuccess: async (r) => {
        try {
          await navigator.clipboard.writeText(r.url);
          toast.show({ title: t('linkCopied'), description: r.url, tone: 'good' });
        } catch {
          toast.show({ title: t('linkReady'), description: r.url, tone: 'good' });
        }
        void queryClient.invalidateQueries({ queryKey: ['invoices', 'detail', i.id] });
      },
    },
  );
  const removePayment = useApiMutation<string, InvoiceDto>(
    (pid) => ({ path: `/invoices/${i.id}/payments/${pid}`, method: 'DELETE' }),
    {
      invalidate: [['invoices'], ['project']],
      successMessage: t('paymentRemoved'),
      onSuccess: (dto) => {
        setDetail(dto);
        setUndo(null);
      },
    },
  );
  const reminders = useApiMutation<boolean, InvoiceDto>(
    (paused) => ({ path: `/invoices/${i.id}/reminders`, body: { paused } }),
    { invalidate: [['invoices']], onSuccess: setDetail },
  );
  const canPay = !credit && i.balance > 0 && can('payments.write');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-[14px] sm:grid-cols-3">
          <Fact label={t('issueDate')} value={formatDay(i.issueDate)} />
          {!credit ? <Fact label={t('dueDate')} value={formatDay(i.dueDate)} /> : null}
          {i.servicePeriodEnd ? (
            <Fact
              label={t('period')}
              value={`${formatDay(i.servicePeriodStart)} – ${formatDay(i.servicePeriodEnd)}`}
            />
          ) : null}
          {i.structuredCommunication ? (
            <Fact
              label={t('communication')}
              value={formatStructuredCommunication(i.structuredCommunication)}
              mono
            />
          ) : null}
          {i.buyer ? (
            <Fact
              label={t('buyer')}
              value={[i.buyer.name, i.buyer.vatNumber, i.buyer.address].filter(Boolean).join(' · ')}
              wide
            />
          ) : null}
          {i.creditedInvoice ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] text-muted">{t('credits')}</span>
              <Link
                href={`/facturation/${i.creditedInvoice.id}`}
                className="font-mono text-[13px] text-accent underline"
              >
                {i.creditedInvoice.number}
              </Link>
            </div>
          ) : null}
        </Card>

        <LinesTable invoice={i} />
        <Totals
          net={i.totalNet}
          breakdown={i.vatBreakdown}
          gross={i.totalGross}
          credit={credit}
          retention={i.retentionAmount ? { percent: i.retentionPercent, amount: i.retentionAmount } : null}
          {...(!credit ? { balance: i.balance } : {})}
        />
        {i.vatMentions.length ? (
          <ul className="flex flex-col gap-1 text-[13px] text-muted">
            {i.vatMentions.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <aside className="flex min-w-0 flex-col gap-4">
        <Card className="flex flex-col gap-3 p-5">
          <CardTitle as="h2">{t('documents')}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {i.pdfUrl ? (
              <a
                href={i.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-[14px] font-medium hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                <FileDown aria-hidden className="size-4" />
                PDF
              </a>
            ) : null}
            {i.ublUrl ? (
              <a
                href={i.ublUrl}
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-3 text-[14px] font-medium hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
              >
                <FileDown aria-hidden className="size-4" />
                {t('ubl')}
              </a>
            ) : null}
          </div>
          <p className="flex items-start gap-2 text-[14px]">
            {i.deliveryChannel === 'peppol' ? (
              <Send aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <Mail aria-hidden className="mt-0.5 size-4 shrink-0" />
            )}
            <span>
              {i.deliveryStatus
                ? t(`delivery.${i.deliveryChannel ?? 'email'}.${i.deliveryStatus}`, { to: i.sentTo ?? '' })
                : t('delivery.pending')}
              {i.deliveryMessage ? (
                <span className="block text-[13px] text-muted">{i.deliveryMessage}</span>
              ) : null}
            </span>
          </p>
        </Card>

        {!credit ? (
          <Card className="flex flex-col gap-3 p-5">
            <CardTitle as="h2">{t('payments')}</CardTitle>
            {i.payments.length ? (
              <ul className="flex flex-col divide-y divide-line-soft">
                {i.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-[14px]">
                    <span>
                      <span className="font-medium tabular-nums">{formatEuros(BigInt(p.amount))}</span>
                      <span className="block text-[12px] text-muted">
                        {formatDay(p.receivedOn)} · {t(`method.${p.method}`)}
                        {p.reference ? ` · ${p.reference}` : ''}
                      </span>
                    </span>
                    {p.source === 'manual' && can('payments.write') ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('removePayment', { amount: formatEuros(BigInt(p.amount)) })}
                        icon={<Undo2 aria-hidden className="size-4" />}
                        onClick={() => setUndo(p.id)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">{i.balance > 0 ? t('noPayment') : t('settled')}</p>
            )}
            {canPay ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  icon={<Wallet aria-hidden className="size-4" />}
                  onClick={() => setPaying(true)}
                >
                  {t('recordPayment')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={link.isPending}
                  icon={
                    i.openPaymentLink ? (
                      <Copy aria-hidden className="size-4" />
                    ) : (
                      <CreditCard aria-hidden className="size-4" />
                    )
                  }
                  onClick={() => link.mutate()}
                >
                  {t('paymentLink')}
                </Button>
              </div>
            ) : null}
          </Card>
        ) : null}

        {!credit && i.dueDate ? (
          <Card className="flex flex-col gap-3 p-5">
            <CardTitle as="h2">{t('reminders')}</CardTitle>
            {i.dunning.length ? (
              <ul className="flex flex-col gap-1 text-[14px]">
                {i.dunning.map((d) => (
                  <li key={d.step}>
                    {d.kind === 'formal_notice' ? t('formalNotice') : t('reminder', { n: d.step })} ·{' '}
                    {formatDay(d.sentAt.slice(0, 10))}
                    <span className="text-muted"> · {t('daysLate', { n: d.daysLate })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">{t('noReminder')}</p>
            )}
            {can('invoices.write') && i.balance > 0 ? (
              <Switch
                label={t('remindersEnabled')}
                checked={!i.remindersPaused}
                onChange={(v) => reminders.mutate(!v)}
              />
            ) : null}
          </Card>
        ) : null}

        {!credit && i.status !== 'cancelled' && can('invoices.write') ? (
          <Card className="flex flex-col gap-3 p-5">
            <CardTitle as="h2">{t('creditNotes')}</CardTitle>
            {i.creditNotes.length ? (
              <ul className="flex flex-col gap-1 text-[14px]">
                {i.creditNotes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/facturation/${c.id}`}
                      className="text-accent underline-offset-4 hover:underline"
                    >
                      {c.number ?? tb('draft')}
                    </Link>{' '}
                    · {formatEuros(BigInt(c.totalGross))}
                  </li>
                ))}
              </ul>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              icon={<FileMinus aria-hidden className="size-4" />}
              onClick={() => setCrediting(true)}
            >
              {t('createCreditNote')}
            </Button>
          </Card>
        ) : null}
      </aside>

      {paying ? <PaymentDialog invoice={i} onClose={() => setPaying(false)} /> : null}
      {crediting ? <CreditNoteDialog invoice={i} onClose={() => setCrediting(false)} /> : null}
      <ConfirmDialog
        open={undo !== null}
        onClose={() => setUndo(null)}
        onConfirm={() => undo && removePayment.mutate(undo)}
        title={t('removePaymentTitle')}
        description={t('removePaymentDescription')}
        confirmLabel={t('removePaymentConfirm')}
        cancelLabel={t('keep')}
        closeLabel={t('keep')}
        destructive
        loading={removePayment.isPending}
      />
    </div>
  );
}

function PaymentDialog({ invoice: i, onClose }: { invoice: InvoiceDto; onClose: () => void }) {
  const t = useTranslations('billing.paymentDialog');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(i.balance);
  const [receivedOn, setReceivedOn] = useState(today());
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [id] = useState(() => uuidv7());
  const save = useApiMutation<void, InvoiceDto>(
    () => ({
      path: `/invoices/${i.id}/payments`,
      body: { id, amount, receivedOn, method, reference: reference.trim() || null },
    }),
    {
      invalidate: [['invoices'], ['project']],
      successMessage: (dto) => (dto.balance === 0 ? t('settled') : t('recorded')),
      onSuccess: (dto) => {
        queryClient.setQueryData(['invoices', 'detail', dto.id], dto);
        onClose();
      },
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description', { balance: formatEuros(BigInt(i.balance)) })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            loading={save.isPending}
            disabled={amount <= 0 || amount > i.balance}
            onClick={() => save.mutate()}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput
          label={t('amount')}
          cents={amount}
          onChange={setAmount}
          hint={amount > i.balance ? t('tooMuch') : undefined}
        />
        <TextField
          label={t('date')}
          type="date"
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
        />
        <SelectField
          label={t('method')}
          value={method}
          options={['transfer', 'bancontact', 'card', 'cash', 'other'].map((m) => ({
            value: m,
            label: t(`methods.${m}`),
          }))}
          onChange={(e) => setMethod(e.target.value)}
        />
        <TextField label={t('reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
    </Dialog>
  );
}

function CreditNoteDialog({ invoice: i, onClose }: { invoice: InvoiceDto; onClose: () => void }) {
  const t = useTranslations('billing.creditDialog');
  const tc = useTranslations('common');
  const router = useRouter();
  const [full, setFull] = useState(true);
  const [reason, setReason] = useState('');
  const [amounts, setAmounts] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [id] = useState(() => uuidv7());
  const create = useApiMutation<void, InvoiceDto>(
    () => ({
      path: `/invoices/${i.id}/credit-note`,
      body: {
        id,
        reason: reason.trim(),
        ...(full
          ? {}
          : {
              lines: Object.entries(amounts)
                .filter(([, v]) => v > 0)
                .map(([index, amount]) => ({ index: Number(index), amount })),
            }),
      },
    }),
    { invalidate: [['invoices']], onSuccess: (dto) => router.push(`/facturation/${dto.id}`) },
  );
  const submit = () => {
    if (reason.trim().length < 2) return setError(t('errors.reason'));
    if (!full && !Object.values(amounts).some((v) => v > 0)) return setError(t('errors.amount'));
    setError(null);
    create.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { number: i.number ?? '' })}
      description={t('description')}
      closeLabel={tc('close')}
      className="w-[min(94vw,620px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            {t('create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField label={t('reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Checkbox label={t('full')} checked={full} onChange={(e) => setFull(e.target.checked)} />
        {!full ? (
          <ul className="flex flex-col gap-3">
            {i.lines.map((l, index) =>
              l.kind === 'deduction' ? null : (
                <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_9rem] items-end gap-3">
                  <p className="pb-3 text-[14px]">
                    {l.description}
                    <span className="block text-[12px] text-muted">
                      {formatEuros(BigInt(l.netAmount))} HTVA
                    </span>
                  </p>
                  <MoneyInput
                    label={t('amount', { n: index + 1 })}
                    cents={amounts[index] ?? 0}
                    onChange={(v) => setAmounts((a) => ({ ...a, [index]: v }))}
                  />
                </li>
              ),
            )}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-[14px] text-crit">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function Fact({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={wide ? 'col-span-2 flex flex-col gap-0.5 sm:col-span-3' : 'flex min-w-0 flex-col gap-0.5'}
    >
      <span className="text-[12px] text-muted">{label}</span>
      <span className={mono ? 'font-mono text-[13px]' : 'break-words'}>{value}</span>
    </div>
  );
}
