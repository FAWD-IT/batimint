'use client';

import type { ChangeOrderDto, CommentDto, ProjectDto } from '@batimint/contracts';
import {
  type ChangeOrderLineInput,
  computeChangeOrder,
  formatEuros,
  formatPercent,
  type VatRegime,
} from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Chip,
  cn,
  Dialog,
  Drawer,
  ErrorState,
  Notice,
  Skeleton,
  TextAreaField,
  TextField,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileDown, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { CellInput, CellTextarea, MoneyCell } from '@/components/quotes/cells';
import { type LibraryLine, LibraryPicker } from '@/components/quotes/LibraryPicker';
import { EDITOR_VAT_REGIMES } from '@/components/quotes/LineRow';
import { itemSuggestion, toDecimal } from '@/components/quotes/quote-state';
import { ApiError } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { CHANGE_ORDER_TONES } from './status';

const NEW_POST = '__new__';

interface EditLine {
  id: string;
  budgetLineId: string | null;
  newPostLabel: string;
  itemId: string | null;
  code: string | null;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: number;
  unitCost: number;
  laborHours: string;
  vatRegime: VatRegime;
}

interface Form {
  title: string;
  description: string;
  delayDays: string;
  lines: EditLine[];
}

const emptyLine = (budgetLineId: string | null, vatRegime: VatRegime): EditLine => ({
  id: uuidv7(),
  budgetLineId,
  newPostLabel: '',
  itemId: null,
  code: null,
  description: '',
  unit: 'u',
  quantity: '1',
  unitPrice: 0,
  unitCost: 0,
  laborHours: '0',
  vatRegime,
});

function fromDto(co: ChangeOrderDto): Form {
  return {
    title: co.title,
    description: co.description ?? '',
    delayDays: String(co.delayDays),
    lines: co.lines.map((l) => ({
      id: l.id,
      budgetLineId: l.budgetLineId,
      newPostLabel: l.newPostLabel ?? '',
      itemId: l.itemId,
      code: l.code,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity.replace('.', ','),
      unitPrice: l.unitPrice,
      unitCost: l.unitCost ?? 0,
      laborHours: l.laborHours,
      vatRegime: l.vatRegime as VatRegime,
    })),
  };
}

function toBody(f: Form) {
  return {
    title: f.title.trim(),
    description: f.description.trim() || null,
    delayDays: Math.max(0, Number.parseInt(f.delayDays || '0', 10) || 0),
    lines: f.lines.map((l) => ({
      id: l.id,
      budgetLineId: l.budgetLineId,
      newPostLabel: l.budgetLineId ? null : l.newPostLabel.trim() || null,
      itemId: l.itemId,
      code: l.code,
      description: l.description.trim(),
      unit: l.unit.trim() || 'u',
      quantity: toDecimal(l.quantity) ?? '0',
      unitPrice: l.unitPrice,
      unitCost: l.unitCost,
      laborHours: l.laborHours,
      discountPercent: '0',
      vatRegime: l.vatRegime,
    })),
  };
}

/**
 * Avenant (02 P5) : création et édition en brouillon (calcul en direct, comme le devis), envoi,
 * puis suivi : questions du client, réponse, signature ou refus.
 */
export function ChangeOrderDrawer({
  project,
  changeOrderId,
  prefillBudgetLineId,
  onClose,
}: {
  project: ProjectDto;
  changeOrderId: string | null;
  prefillBudgetLineId?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('changeOrders');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [id, setId] = useState<string | null>(changeOrderId);
  // L'envoi vit au niveau du tiroir : l'éditeur se recrée quand le brouillon reçoit son identifiant.
  const [sending, setSending] = useState<ChangeOrderDto | null>(null);
  const co = useApi<ChangeOrderDto>(['change_orders', 'detail', id], id ? `/change-orders/${id}` : null);
  const title = id
    ? co.data
      ? t('editor.titleEdit', { n: co.data.ordinal })
      : t('title')
    : t('editor.titleNew');
  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      description={
        co.data ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={CHANGE_ORDER_TONES[co.data.status]} dot>
              {t(`status.${co.data.status}`)}
            </Chip>
            {co.data.number ? <span className="font-mono">{co.data.number}</span> : null}
          </span>
        ) : undefined
      }
      closeLabel={tc('close')}
      className="w-[min(100vw,920px)]"
    >
      {id && co.isLoading ? (
        <Skeleton className="h-80" />
      ) : id && co.error ? (
        <ErrorState title={t('notFound')} description={errorMessage(co.error)} />
      ) : id && co.data && co.data.status !== 'draft' ? (
        <ChangeOrderView project={project} co={co.data} />
      ) : (
        <ChangeOrderEditor
          key={co.data ? `${co.data.id}-${co.data.revision}` : 'new'}
          project={project}
          co={co.data ?? null}
          prefillBudgetLineId={prefillBudgetLineId ?? null}
          onCreated={setId}
          onDeleted={onClose}
          onReload={() => void co.refetch()}
          onSend={setSending}
        />
      )}
      {sending ? (
        <SendChangeOrderDialog co={sending} email={project.customer.email} onClose={() => setSending(null)} />
      ) : null}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Éditeur (brouillon)
// ---------------------------------------------------------------------------

function ChangeOrderEditor({
  project,
  co,
  prefillBudgetLineId,
  onCreated,
  onDeleted,
  onReload,
  onSend,
}: {
  project: ProjectDto;
  co: ChangeOrderDto | null;
  prefillBudgetLineId: string | null;
  onCreated: (id: string) => void;
  onDeleted: () => void;
  onReload: () => void;
  onSend: (co: ChangeOrderDto) => void;
}) {
  const t = useTranslations('changeOrders.editor');
  const tq = useTranslations('quotes.vat');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const defaultRegime = (co?.project.defaultVatRegime ?? project.vat.regime ?? 'standard_21') as VatRegime;
  const defaultPost = prefillBudgetLineId ?? project.budgetLines[0]?.id ?? null;
  const [form, setForm] = useState<Form>(() =>
    co ? fromDto(co) : { title: '', description: '', delayDays: '0', lines: [] },
  );
  const [error, setError] = useState<string | null>(null);
  const [newId] = useState(() => uuidv7());
  const withCosts = can('pricing.read');

  const totals = useMemo(() => {
    const inputs: ChangeOrderLineInput[] = form.lines.map((l) => ({
      id: l.id,
      description: l.description,
      unit: l.unit,
      quantity: toDecimal(l.quantity) ?? '0',
      unitPrice: BigInt(l.unitPrice),
      unitCost: BigInt(l.unitCost),
      laborHours: l.laborHours,
      vatRegime: l.vatRegime,
      budgetLineId: l.budgetLineId,
      newPostLabel: l.newPostLabel,
    }));
    return computeChangeOrder(inputs);
  }, [form.lines]);
  const lineNet = new Map(totals.lines.map((l) => [l.id, l.netAmount]));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['change_orders'] });
    void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
  };
  const save = useApiMutation<{ then?: 'send' }, ChangeOrderDto>(
    () =>
      co
        ? { path: `/change-orders/${co.id}`, method: 'PUT', body: { ...toBody(form), revision: co.revision } }
        : { path: `/projects/${project.id}/change-orders`, body: { id: newId, ...toBody(form) } },
    {
      silentError: true,
      successMessage: (r, v) => (v.then === 'send' ? '' : co ? t('saved') : t('created', { n: r.ordinal })),
      onSuccess: (r, v) => {
        invalidate();
        queryClient.setQueryData(['change_orders', 'detail', r.id], r);
        if (!co) onCreated(r.id);
        if (v.then === 'send') onSend(r);
      },
    },
  );
  const remove = useApiMutation<void>(() => ({ path: `/change-orders/${co!.id}`, method: 'DELETE' }), {
    successMessage: t('deleted'),
    onSuccess: () => {
      invalidate();
      onDeleted();
    },
  });

  const validate = (): boolean => {
    if (form.title.trim().length < 2) return (setError(t('titleRequired')), false);
    if (!form.lines.length) return (setError(t('lineRequired')), false);
    if (form.lines.some((l) => !l.budgetLineId && !l.newPostLabel.trim()))
      return (setError(t('postRequired')), false);
    setError(null);
    return true;
  };
  const submit = (e: FormEvent, then?: 'send') => {
    e.preventDefault();
    if (!validate()) return;
    save.mutate(then ? { then } : {});
  };
  const setLine = (id: string, patch: Partial<EditLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const addLibrary = (lines: LibraryLine[]) =>
    setForm((f) => ({
      ...f,
      lines: [
        ...f.lines,
        ...lines.map((l) => ({
          ...emptyLine(f.lines.at(-1)?.budgetLineId ?? defaultPost, itemSuggestion(l.vatRate, defaultRegime)),
          itemId: l.itemId,
          code: l.code,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity.replace('.', ','),
          unitPrice: l.unitPrice,
          unitCost: l.unitCost ?? 0,
          laborHours: l.laborHours,
        })),
      ],
    }));
  const conflict = save.error instanceof ApiError && save.error.code === 'stale_revision';

  return (
    <form noValidate onSubmit={(e) => submit(e)} className="flex flex-col gap-5">
      {conflict ? (
        <Notice tone="warn">
          <span className="flex flex-wrap items-center gap-3">
            {t('conflict')}
            <Button size="sm" variant="secondary" onClick={onReload}>
              {t('reload')}
            </Button>
          </span>
        </Notice>
      ) : error || save.error ? (
        <Notice tone="crit">{error ?? errorMessage(save.error)}</Notice>
      ) : null}
      <TextField
        label={t('titleLabel')}
        placeholder={t('titlePlaceholder')}
        value={form.title}
        onChange={(e) => setForm({ ...form, title: e.target.value })}
        autoFocus={!co}
      />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <TextAreaField
          label={t('description')}
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <TextField
          label={t('delayDays')}
          hint={t('delayHint')}
          inputMode="numeric"
          value={form.delayDays}
          onChange={(e) => setForm({ ...form, delayDays: e.target.value.replace(/\D/g, '').slice(0, 3) })}
        />
      </div>

      <section aria-labelledby="co-lines" className="flex flex-col gap-2">
        <h3 id="co-lines" className="text-[14px] font-semibold">
          {t('lines')}
        </h3>
        {form.lines.length === 0 ? <p className="text-[14px] text-muted">{t('noLines')}</p> : null}
        <ol className="flex flex-col gap-3">
          {form.lines.map((l, i) => {
            const n = i + 1;
            return (
              <li key={l.id} className="flex flex-col gap-2 rounded-[12px] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`post-${l.id}`}>
                    {t('postOf', { n })}
                  </label>
                  <select
                    id={`post-${l.id}`}
                    value={l.budgetLineId ?? NEW_POST}
                    onChange={(e) =>
                      setLine(l.id, { budgetLineId: e.target.value === NEW_POST ? null : e.target.value })
                    }
                    className="h-10 min-w-0 flex-1 rounded-[8px] border border-line bg-surface px-2 text-[14px]"
                  >
                    {project.budgetLines.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                    <option value={NEW_POST}>{t('newPost')}</option>
                  </select>
                  {!l.budgetLineId ? (
                    <CellInput
                      label={t('newPostOf', { n })}
                      placeholder={t('newPostLabel')}
                      value={l.newPostLabel}
                      onChange={(e) => setLine(l.id, { newPostLabel: e.target.value })}
                      className="flex-1 border border-line"
                    />
                  ) : null}
                  <button
                    type="button"
                    aria-label={t('removeLine', { n })}
                    onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((x) => x.id !== l.id) }))}
                    className="flex size-10 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-crit"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
                <CellTextarea
                  label={t('descriptionOf', { n })}
                  placeholder={t('description_')}
                  value={l.description}
                  onChange={(e) => setLine(l.id, { description: e.target.value })}
                  className="font-medium"
                />
                <div
                  className={cn(
                    'grid grid-cols-2 gap-2 sm:items-end',
                    withCosts
                      ? 'sm:grid-cols-[80px_70px_110px_110px_90px_1fr]'
                      : 'sm:grid-cols-[80px_70px_110px_90px_1fr]',
                  )}
                >
                  <Labeled label={t('quantity')}>
                    <CellInput
                      label={t('quantityOf', { n })}
                      inputMode="decimal"
                      value={l.quantity}
                      invalid={toDecimal(l.quantity) === null}
                      onChange={(e) => setLine(l.id, { quantity: e.target.value.replace(/[^\d.,]/g, '') })}
                      className="border border-line text-right tabular-nums"
                    />
                  </Labeled>
                  <Labeled label={t('unit')}>
                    <CellInput
                      label={t('unitOf', { n })}
                      value={l.unit}
                      maxLength={12}
                      onChange={(e) => setLine(l.id, { unit: e.target.value })}
                      className="border border-line"
                    />
                  </Labeled>
                  <Labeled label={t('price')}>
                    <MoneyCell
                      label={t('priceOf', { n })}
                      cents={l.unitPrice}
                      onChange={(unitPrice) => setLine(l.id, { unitPrice })}
                      className="border border-line"
                    />
                  </Labeled>
                  {withCosts ? (
                    <Labeled label={t('cost')}>
                      <MoneyCell
                        label={t('costOf', { n })}
                        cents={l.unitCost}
                        onChange={(unitCost) => setLine(l.id, { unitCost })}
                        className="border border-line"
                      />
                    </Labeled>
                  ) : null}
                  <Labeled label={t('vat')}>
                    <select
                      aria-label={t('vatOf', { n })}
                      value={l.vatRegime}
                      onChange={(e) => setLine(l.id, { vatRegime: e.target.value as VatRegime })}
                      className="h-10 w-full rounded-[8px] border border-line bg-surface px-1.5 text-[13px]"
                    >
                      {[...new Set([l.vatRegime, ...EDITOR_VAT_REGIMES])].map((r) => (
                        <option key={r} value={r}>
                          {tq(`short.${r}`)}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <p className="col-span-2 self-center text-right text-[15px] font-semibold tabular-nums sm:col-span-1">
                    {formatEuros(lineNet.get(l.id) ?? 0n)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <LibraryPicker
              label={t('addFromLibrary')}
              onAdd={addLibrary}
              onError={(e) => setError(errorMessage(e))}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() =>
              setForm((f) => ({
                ...f,
                lines: [...f.lines, emptyLine(f.lines.at(-1)?.budgetLineId ?? defaultPost, defaultRegime)],
              }))
            }
          >
            {t('addLine')}
          </Button>
        </div>
      </section>

      <Totals totals={totals} withCosts={withCosts} />

      <div className="sticky bottom-0 -mx-5 flex flex-wrap justify-end gap-2 border-t border-line-soft bg-surface px-5 py-3">
        {co && !co.number ? (
          <Button
            variant="ghost"
            icon={<Trash2 aria-hidden className="size-4" />}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t('delete')}
          </Button>
        ) : null}
        <Button type="submit" variant="secondary" loading={save.isPending && !save.variables?.then}>
          {t('save')}
        </Button>
        {can('quotes.send') ? (
          <Button
            icon={<Send aria-hidden className="size-4" />}
            loading={save.isPending && save.variables?.then === 'send'}
            onClick={(e) => submit(e, 'send')}
          >
            {t('send')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Totals({
  totals,
  withCosts,
}: {
  totals: ReturnType<typeof computeChangeOrder>;
  withCosts: boolean;
}) {
  const t = useTranslations('changeOrders.editor');
  const d = totals.document;
  return (
    <section aria-label={t('totals')} className="ml-auto flex w-full max-w-sm flex-col gap-1.5 text-[14px]">
      <Row label={t('net')} value={formatEuros(d.totalNet)} />
      {d.vatBreakdown.map((v) => (
        <Row
          key={`${v.category}-${v.ratePercent}`}
          label={v.category === 'AE' ? t('reverseCharge') : t('vatAt', { rate: v.ratePercent })}
          value={formatEuros(v.taxAmount)}
          muted
        />
      ))}
      <div className="mt-1 flex items-baseline justify-between rounded-[12px] bg-panel px-3 py-2.5 text-white">
        <span className="font-semibold">{t('gross')}</span>
        <span className="text-[18px] font-bold tabular-nums" data-testid="co-total-gross">
          {formatEuros(d.totalGross)}
        </span>
      </div>
      {withCosts && totals.marginRate ? (
        <p
          className={cn(
            'text-right text-[12px]',
            totals.marginRate.isNegative() ? 'text-crit' : 'text-muted',
          )}
        >
          {t('margin', { rate: formatPercent(totals.marginRate) })}
        </p>
      ) : null}
    </section>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', muted && 'text-muted')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

function SendChangeOrderDialog({
  co,
  email: initial,
  onClose,
}: {
  co: ChangeOrderDto;
  email: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('changeOrders.send');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(co.project.customerEmail ?? initial ?? '');
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState(false);
  const send = useApiMutation<void, ChangeOrderDto>(
    () => ({
      path: `/change-orders/${co.id}/send`,
      body: { email: email.trim(), message: message.trim() || null },
    }),
    {
      silentError: true,
      successMessage: () => t('sent', { email: email.trim() }),
      onSuccess: (r) => {
        queryClient.setQueryData(['change_orders', 'detail', r.id], r);
        void queryClient.invalidateQueries({ queryKey: ['change_orders'] });
        void queryClient.invalidateQueries({ queryKey: ['project', co.projectId] });
        onClose();
      },
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('hint')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            type="submit"
            form="send-co"
            loading={send.isPending}
            icon={<Send aria-hidden className="size-4" />}
          >
            {t('submit')}
          </Button>
        </>
      }
    >
      <form
        id="send-co"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setInvalid(true);
          send.mutate();
        }}
      >
        {send.error ? <Notice tone="crit">{errorMessage(send.error)}</Notice> : null}
        <TextField
          label={t('email')}
          type="email"
          value={email}
          error={invalid ? t('invalidEmail') : undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            setInvalid(false);
          }}
        />
        <TextAreaField
          label={t('message')}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Lecture : envoyé, signé ou refusé
// ---------------------------------------------------------------------------

function ChangeOrderView({ project, co }: { project: ProjectDto; co: ChangeOrderDto }) {
  const t = useTranslations('changeOrders');
  const can = useCan();
  const relative = useRelativeTime();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const [refusing, setRefusing] = useState(false);
  const [reply, setReply] = useState('');
  const thread = useApi<{ items: CommentDto[] }>(
    ['comments', 'change_order', co.id],
    `/comments?subjectType=change_order&subjectId=${co.id}`,
  );
  const refresh = (r?: ChangeOrderDto) => {
    if (r) queryClient.setQueryData(['change_orders', 'detail', r.id], r);
    void queryClient.invalidateQueries({ queryKey: ['change_orders'] });
    void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
  };
  const withdraw = useApiMutation<void, ChangeOrderDto>(
    () => ({ path: `/change-orders/${co.id}/withdraw`, body: {} }),
    { successMessage: t('view.withdrawn'), onSuccess: (r) => refresh(r) },
  );
  const send = useApiMutation<{ body: string }>(
    ({ body }) => ({
      path: '/comments',
      body: { id: uuidv7(), subjectType: 'change_order', subjectId: co.id, body, visibleToClient: true },
    }),
    {
      successMessage: t('view.replied'),
      onSuccess: () => {
        setReply('');
        void queryClient.invalidateQueries({ queryKey: ['comments', 'change_order', co.id] });
        refresh();
      },
    },
  );
  const totals = co;
  const write = can('projects.write');
  return (
    <div className="flex flex-col gap-5">
      <Notice tone={co.status === 'signed' ? 'good' : co.status === 'refused' ? 'crit' : 'accent'}>
        {co.status === 'signed'
          ? t('view.lockedSigned')
          : co.status === 'refused'
            ? `${t('view.refused', { date: relative(co.refusedAt!) })}${co.refusalReason ? ` — ${t('view.refusalReason', { reason: co.refusalReason })}` : ''}`
            : t('view.lockedSent')}
      </Notice>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
        {co.sentTo && co.sentAt ? (
          <span>{t('view.sentTo', { email: co.sentTo, date: relative(co.sentAt) })}</span>
        ) : null}
        {co.signature ? (
          <span className="font-semibold text-good">
            {t('view.signedBy', { name: co.signature.signerName, date: relative(co.signature.signedAt) })}
          </span>
        ) : null}
        <span>{t('delay', { days: co.delayDays })}</span>
      </div>
      <div>
        <h3 className="text-[17px] font-semibold">{co.title}</h3>
        {co.description ? (
          <p className="mt-1 text-[14px] whitespace-pre-wrap text-muted">{co.description}</p>
        ) : null}
      </div>
      <ul className="flex flex-col divide-y divide-line-soft rounded-[12px] border border-line">
        {co.lines.map((l) => {
          const post = l.budgetLineId
            ? project.budgetLines.find((b) => b.id === l.budgetLineId)?.label
            : l.newPostLabel;
          return (
            <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[14px] font-medium">{l.description}</p>
                <p className="text-[12px] text-muted">
                  {post} · {l.quantity.replace('.', ',')} {l.unit} × {formatEuros(BigInt(l.unitPrice))}
                </p>
              </div>
              <span className="shrink-0 text-[14px] font-semibold tabular-nums">
                {formatEuros(BigInt(l.netAmount))}
              </span>
            </li>
          );
        })}
      </ul>
      <section
        className="ml-auto flex w-full max-w-sm flex-col gap-1.5 text-[14px]"
        aria-label={t('editor.totals')}
      >
        <Row label={t('editor.net')} value={formatEuros(BigInt(totals.totalNet))} />
        <Row label={t('editor.vat')} value={formatEuros(BigInt(totals.totalVat))} muted />
        <div className="mt-1 flex items-baseline justify-between rounded-[12px] bg-panel px-3 py-2.5 text-white">
          <span className="font-semibold">{t('editor.gross')}</span>
          <span className="text-[18px] font-bold tabular-nums">{formatEuros(BigInt(totals.totalGross))}</span>
        </div>
      </section>
      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/v1/change-orders/${co.id}/pdf`}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses('secondary', 'sm')}
        >
          <FileDown aria-hidden className="size-4" />
          {t('view.pdf')}
        </a>
        {write && co.status === 'sent' ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Undo2 aria-hidden className="size-4" />}
              loading={withdraw.isPending}
              onClick={() => withdraw.mutate()}
            >
              {t('view.withdraw')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRefusing(true)}>
              {t('view.markRefused')}
            </Button>
          </>
        ) : null}
        {write && co.status === 'refused' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Undo2 aria-hidden className="size-4" />}
            loading={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            {t('view.reopen')}
          </Button>
        ) : null}
      </div>

      <section
        aria-labelledby={`thread-${co.id}`}
        className="flex flex-col gap-3 border-t border-line-soft pt-4"
      >
        <h3 id={`thread-${co.id}`} className="text-[15px] font-semibold">
          {t('view.thread')}
        </h3>
        {(thread.data?.items ?? []).filter((c) => c.visibleToClient).length === 0 ? (
          <p className="text-[14px] text-muted">{t('view.threadEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-2" data-testid="co-thread">
            {thread
              .data!.items.filter((c) => c.visibleToClient)
              .map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    'max-w-[85%] rounded-[12px] px-3 py-2 text-[14px]',
                    c.fromClient ? 'self-start bg-line-soft' : 'self-end bg-ink text-white',
                  )}
                >
                  <p
                    className={cn('text-[12px] font-semibold', c.fromClient ? 'text-muted' : 'text-white/70')}
                  >
                    {c.fromClient ? `${c.authorLabel} · ${t('view.client')}` : c.authorLabel} ·{' '}
                    {relative(c.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
          </ol>
        )}
        {write && co.status !== 'refused' ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) send.mutate({ body: reply.trim() });
            }}
          >
            <TextAreaField
              label={t('view.reply')}
              placeholder={t('view.replyPlaceholder')}
              rows={2}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            {send.error ? <p className="text-[13px] text-crit">{errorMessage(send.error)}</p> : null}
            <Button
              type="submit"
              size="sm"
              className="self-end"
              disabled={!reply.trim()}
              loading={send.isPending}
            >
              {t('view.replySend')}
            </Button>
          </form>
        ) : null}
      </section>
      {refusing ? <RefuseDialog co={co} onClose={() => setRefusing(false)} onDone={refresh} /> : null}
    </div>
  );
}

function RefuseDialog({
  co,
  onClose,
  onDone,
}: {
  co: ChangeOrderDto;
  onClose: () => void;
  onDone: (r: ChangeOrderDto) => void;
}) {
  const t = useTranslations('changeOrders.view');
  const tc = useTranslations('common');
  const [reason, setReason] = useState('');
  const refuse = useApiMutation<void, ChangeOrderDto>(
    () => ({ path: `/change-orders/${co.id}/refuse`, body: { reason: reason.trim() || null } }),
    {
      successMessage: t('refusedSaved'),
      onSuccess: (r) => {
        onDone(r);
        onClose();
      },
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('refuseTitle')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="danger" loading={refuse.isPending} onClick={() => refuse.mutate()}>
            {t('markRefused')}
          </Button>
        </>
      }
    >
      <TextAreaField
        label={t('refuseReason')}
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Dialog>
  );
}
