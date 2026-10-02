'use client';

import type { ProgressStatementDto, ProjectDto } from '@batimint/contracts';
import {
  dec,
  formatEuros,
  formatQuantity,
  InvoicingError,
  type ProgressInputMode,
  progressFromInput,
} from '@batimint/domain';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  TextAreaField,
  TextField,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Send, Stamp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { fromDecimal, toDecimal } from '@/components/quotes/quote-state';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { formatDay, pct, STATEMENT_TONES } from './status';

interface LineState {
  mode: ProgressInputMode;
  value: string;
}

/** « Facturer l'avancement » (02 P7.1) : pré-rempli, modifiable en %, en quantité ou en €. */
export function StatementEditor({ projectId, statementId }: { projectId: string; statementId: string }) {
  const t = useTranslations('billing.statement');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const isNew = statementId === 'nouveau';
  const project = useApi<ProjectDto>(['project', projectId], `/projects/${projectId}`);
  const list = useApi<{ items: ProgressStatementDto[] }>(
    ['progress_statements', projectId],
    isNew ? null : `/projects/${projectId}/progress-statements`,
  );
  const prefill = useApi<ProgressStatementDto>(
    ['progress_statements', projectId, 'prefill'],
    isNew ? `/projects/${projectId}/progress-statements/prefill` : null,
  );
  const st = isNew ? prefill.data : list.data?.items.find((s) => s.id === statementId);
  const error = project.error ?? (isNew ? prefill.error : list.error);
  if (error) return <ErrorState title={tc('errorTitle')} description={errorMessage(error)} />;
  if (!project.data || !st)
    return list.data && !st ? (
      <ErrorState title={t('notFound')} description={t('notFoundHint')} />
    ) : (
      <div className="mx-auto flex max-w-5xl flex-col gap-6" aria-busy="true">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    );
  return (
    <Editor
      key={`${st.id}-${st.status}-${st.cumulativeAmount}`}
      project={project.data}
      statement={st}
      isNew={isNew}
    />
  );
}

function Editor({
  project,
  statement: st,
  isNew,
}: {
  project: ProjectDto;
  statement: ProgressStatementDto;
  isNew: boolean;
}) {
  const t = useTranslations('billing.statement');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [id] = useState(() => (isNew ? uuidv7() : st.id));
  const editable = can('invoices.write') && (st.status === 'draft' || st.status === 'disputed');
  const [periodEnd, setPeriodEnd] = useState(st.periodEnd);
  const [note, setNote] = useState(st.note ?? '');
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      st.lines.map((l) => [
        l.budgetLineId,
        { mode: 'percent' as ProgressInputMode, value: fromDecimal(l.cumulativePercent) },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const computed = useMemo(
    () =>
      st.lines.map((l) => {
        const s = state[l.budgetLineId]!;
        const raw = toDecimal(s.value);
        if (raw === null) return { line: l, error: t('errors.number'), value: null };
        try {
          const value = progressFromInput(
            {
              contractAmount: BigInt(l.contractAmount),
              previousAmount: BigInt(l.previousAmount),
              totalQuantity: l.totalQuantity,
            },
            s.mode,
            s.mode === 'amount' ? dec(raw).times(100).toFixed(0) : raw,
          );
          return { line: l, error: null, value };
        } catch (err) {
          return { line: l, error: err instanceof InvoicingError ? err.message : String(err), value: null };
        }
      }),
    [st.lines, state, t],
  );
  const contract = st.lines.reduce((s, l) => s + BigInt(l.contractAmount), 0n);
  const cumulative = computed.reduce(
    (s, c) => s + (c.value?.cumulativeAmount ?? BigInt(c.line.previousAmount)),
    0n,
  );
  const previous = st.lines.reduce((s, l) => s + BigInt(l.previousAmount), 0n);
  const period = cumulative - previous;
  const hasErrors = computed.some((c) => c.error);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['progress_statements', project.id] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
  };
  const body = () => ({
    id,
    periodEnd,
    note: note.trim() || null,
    lines: computed.map((c) => {
      const s = state[c.line.budgetLineId]!;
      const raw = toDecimal(s.value)!;
      return {
        budgetLineId: c.line.budgetLineId,
        mode: s.mode,
        value: s.mode === 'amount' ? dec(raw).times(100).toFixed(0) : raw,
      };
    }),
  });
  const save = useApiMutation<{ then?: 'submit' }, ProgressStatementDto>(
    () => ({ path: `/projects/${project.id}/progress-statements/${id}`, method: 'PUT', body: body() }),
    {
      successMessage: (_r, v) => (v.then ? '' : t('saved')),
      onSuccess: (_dto, v) => {
        invalidate();
        if (v.then === 'submit') submit.mutate();
        else if (isNew) router.replace(`/chantiers/${project.id}/avancement/${id}`);
      },
    },
  );
  const submit = useApiMutation<void, ProgressStatementDto & { invoiceId: string | null }>(
    () => ({ path: `/progress-statements/${id}/submit` }),
    {
      successMessage: (r) => (r.status === 'submitted' ? t('submitted') : t('approved')),
      onSuccess: (r) => {
        invalidate();
        if (r.invoiceId) router.push(`/facturation/${r.invoiceId}`);
        else router.replace(`/chantiers/${project.id}/avancement/${id}`);
      },
    },
  );
  const go = (then?: 'submit') => {
    if (hasErrors) return setError(t('errors.fix'));
    if (then && period <= 0n) return setError(t('errors.empty'));
    setError(null);
    save.mutate({ then });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href={`/chantiers/${project.id}?onglet=facturation`} className="hover:underline">
            {project.number} · {project.name}
          </Link>
        }
        title={t('title', { n: st.ordinal })}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={STATEMENT_TONES[st.status] ?? 'neutral'} dot>
              {t(`status.${st.status}`)}
            </Chip>
            <span>{st.approvalRequired ? t('approvalRequired') : t('directBilling')}</span>
          </span>
        }
      />
      {st.status === 'disputed' && st.disputeReason ? (
        <Notice tone="crit" title={t('disputed')}>
          {st.disputeReason}
        </Notice>
      ) : null}
      {st.status === 'submitted' ? <Notice tone="accent">{t('waiting')}</Notice> : null}
      {st.invoice ? (
        <Notice tone="good">
          <Link href={`/facturation/${st.invoice.id}`} className="font-medium underline">
            {st.invoice.number ? t('invoiceIssued', { number: st.invoice.number }) : t('invoiceDraft')}
          </Link>
        </Notice>
      ) : null}

      <Card className="grid gap-4 p-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <TextField
          label={t('periodEnd')}
          type="date"
          value={periodEnd}
          disabled={!editable}
          onChange={(e) => setPeriodEnd(e.target.value)}
        />
        <TextAreaField
          label={t('note')}
          rows={1}
          value={note}
          disabled={!editable}
          onChange={(e) => setNote(e.target.value)}
        />
      </Card>

      <ul className="flex flex-col gap-3" aria-label={t('posts')}>
        {computed.map(({ line: l, error: lineError, value }) => {
          const s = state[l.budgetLineId]!;
          const setLine = (patch: Partial<LineState>) =>
            setState((m) => ({ ...m, [l.budgetLineId]: { ...m[l.budgetLineId]!, ...patch } }));
          const switchMode = (mode: ProgressInputMode) => {
            const v = value;
            const next =
              mode === 'percent'
                ? fromDecimal(
                    (v ? v.cumulativeRatio.times(100) : dec(l.cumulativePercent))
                      .toDecimalPlaces(2)
                      .toString(),
                  )
                : mode === 'quantity'
                  ? fromDecimal(
                      (v?.cumulativeQuantity ?? dec(l.cumulativeQuantity ?? '0'))
                        .toDecimalPlaces(2)
                        .toString(),
                    )
                  : fromDecimal(
                      dec((v?.cumulativeAmount ?? BigInt(l.cumulativeAmount)).toString())
                        .dividedBy(100)
                        .toFixed(2),
                    );
            setLine({ mode, value: next });
          };
          const modes: { value: ProgressInputMode; label: string }[] = [
            { value: 'percent', label: '%' },
            ...(l.totalQuantity ? [{ value: 'quantity' as const, label: l.unit ?? t('qty') }] : []),
            { value: 'amount', label: '€' },
          ];
          return (
            <li
              key={l.budgetLineId}
              className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface p-4 sm:flex-row sm:items-end"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{l.label}</p>
                <p className="text-[13px] text-muted">
                  {t('contract', { amount: formatEuros(BigInt(l.contractAmount)) })} ·{' '}
                  {t('previous', { pct: pct(l.previousPercent) })} · {t('tasks', { pct: pct(l.taskPercent) })}
                  {l.totalQuantity ? ` · ${formatQuantity(l.totalQuantity)} ${l.unit}` : ''}
                </p>
              </div>
              {editable ? (
                <div className="flex items-end gap-2">
                  <Segmented<ProgressInputMode>
                    label={t('mode', { post: l.label })}
                    value={s.mode}
                    onChange={switchMode}
                    options={modes}
                  />
                  <TextField
                    label={t('cumulative', { post: l.label })}
                    containerClassName="w-32"
                    className="text-right"
                    inputMode="decimal"
                    value={s.value}
                    error={lineError}
                    onChange={(e) => setLine({ value: e.target.value })}
                  />
                </div>
              ) : (
                <p className="text-[14px] tabular-nums">{pct(l.cumulativePercent)}</p>
              )}
              <p
                className="w-32 text-right text-[14px] tabular-nums sm:pb-3"
                aria-label={t('periodFor', { post: l.label })}
              >
                {formatEuros(value ? value.periodAmount : BigInt(l.periodAmount))}
              </p>
            </li>
          );
        })}
      </ul>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex flex-col">
          <span className="text-[13px] text-muted">
            {t('summary', {
              pct: pct(
                contract
                  ? dec(cumulative.toString()).dividedBy(contract.toString()).times(100).toFixed(1)
                  : '0',
              ),
              contract: formatEuros(contract),
            })}
          </span>
          <span className="text-[22px] font-bold tabular-nums" data-testid="statement-period">
            {formatEuros(period)}
          </span>
          <span className="text-[13px] text-muted">{t('periodHint')}</span>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={save.isPending && !save.variables?.then}
              onClick={() => go()}
            >
              {tc('save')}
            </Button>
            <Button
              icon={
                st.approvalRequired ? (
                  <Send aria-hidden className="size-4" />
                ) : (
                  <Stamp aria-hidden className="size-4" />
                )
              }
              loading={(save.isPending && save.variables?.then === 'submit') || submit.isPending}
              onClick={() => go('submit')}
            >
              {st.approvalRequired ? t('submit') : t('bill')}
            </Button>
          </div>
        ) : null}
      </Card>
      {error ? (
        <p role="alert" className="text-[14px] text-crit">
          {error}
        </p>
      ) : null}
      {st.approvedAt ? (
        <p className="text-[13px] text-muted">
          {t('approvedBy', { name: st.approvedByName ?? '—', date: formatDay(st.approvedAt.slice(0, 10)) })}
        </p>
      ) : null}
    </div>
  );
}
