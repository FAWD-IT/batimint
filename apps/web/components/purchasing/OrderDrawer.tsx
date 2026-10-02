'use client';

import type { ProjectDto, PurchaseOrderDto, PurchaseOrderInput, SupplierDto } from '@batimint/contracts';
import { dec, formatEuros, formatQuantity, lineTotal } from '@batimint/domain';
import {
  Button,
  Chip,
  ConfirmDialog,
  Dialog,
  Drawer,
  ErrorState,
  Notice,
  SelectField,
  Skeleton,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { FileDown, PackageCheck, Plus, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { fromDecimal, toDecimal } from '@/components/quotes/quote-state';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { formatDay, ORDER_STATUS_TONES } from './status';

const INVALIDATE = [['purchase_orders'], ['project']];

/** Bon de commande : brouillon modifiable, puis envoi, réception et annulation (03 §8). */
export function OrderDrawer({
  orderId,
  projectId,
  onClose,
}: {
  orderId: string | null;
  /** Chantier d'un nouveau bon (sans orderId). */
  projectId?: string;
  onClose: () => void;
}) {
  const t = useTranslations('purchasing.order');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const [id, setId] = useState(orderId);
  const po = useApi<PurchaseOrderDto>(
    ['purchase_orders', 'detail', id],
    id ? `/purchase-orders/${id}` : null,
  );
  const o = po.data;
  return (
    <Drawer
      open
      onClose={onClose}
      title={o ? (o.number ?? t('draftTitle', { supplier: o.supplier.name })) : t('newTitle')}
      description={
        o ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={ORDER_STATUS_TONES[o.status] ?? 'neutral'} dot>
              {t(`status.${o.status}`)}
            </Chip>
            <span>{o.supplier.name}</span>
            <Link
              href={`/chantiers/${o.project.id}?onglet=achats`}
              className="underline-offset-4 hover:underline"
            >
              {o.project.number} · {o.project.name}
            </Link>
          </span>
        ) : undefined
      }
      closeLabel={tc('close')}
      className="w-[min(100vw,820px)]"
    >
      {id && po.error ? (
        <ErrorState title={t('notFound')} description={errorMessage(po.error)} />
      ) : id && !o ? (
        <Skeleton className="h-96" />
      ) : o && o.status !== 'draft' ? (
        <OrderView order={o} />
      ) : (
        <OrderEditor
          key={o ? `${o.id}-${o.totalNet}-${o.lines.length}` : 'new'}
          order={o ?? null}
          projectId={o?.project.id ?? projectId!}
          onSaved={setId}
          onDeleted={onClose}
        />
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Brouillon
// ---------------------------------------------------------------------------

interface EditLine {
  key: string;
  description: string;
  supplierCode: string;
  unit: string;
  quantity: string;
  unitPrice: number;
  budgetLineId: string | null;
  sourceKey: string | null;
}

function OrderEditor({
  order,
  projectId,
  onSaved,
  onDeleted,
}: {
  order: PurchaseOrderDto | null;
  projectId: string;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('purchasing.order');
  const tc = useTranslations('common');
  const can = useCan();
  const queryClient = useQueryClient();
  const project = useApi<ProjectDto>(['project', projectId], `/projects/${projectId}`);
  const suppliers = useApi<{ items: SupplierDto[] }>(['suppliers', 'list', ''], '/suppliers');
  const [id] = useState(() => order?.id ?? uuidv7());
  const [supplierId, setSupplierId] = useState(order?.supplier.id ?? '');
  const [expectedOn, setExpectedOn] = useState(order?.expectedOn ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(order?.deliveryAddress ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [lines, setLines] = useState<EditLine[]>(() =>
    order
      ? order.lines.map((l) => ({
          key: l.id,
          description: l.description,
          supplierCode: l.supplierCode ?? '',
          unit: l.unit,
          quantity: fromDecimal(l.quantity),
          unitPrice: l.unitPrice,
          budgetLineId: l.budgetLineId,
          sourceKey: l.sourceKey,
        }))
      : [newLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<PurchaseOrderDto | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = can('purchases.write');

  const total = useMemo(
    () =>
      lines.reduce((s, l) => {
        const q = toDecimal(l.quantity);
        return q ? s + lineTotal(q, BigInt(l.unitPrice)) : s;
      }, 0n),
    [lines],
  );

  const problem = (): string | null => {
    if (!supplierId) return t('errors.supplier');
    if (!lines.length) return t('errors.noLines');
    if (lines.some((l) => !l.description.trim())) return t('errors.description');
    if (lines.some((l) => !toDecimal(l.quantity) || dec(toDecimal(l.quantity)!).isZero()))
      return t('errors.quantity');
    return null;
  };
  const body = (): PurchaseOrderInput | null => {
    const p = problem();
    setError(p);
    if (p) return null;
    return {
      id,
      projectId,
      supplierId,
      expectedOn: expectedOn || null,
      deliveryAddress: deliveryAddress.trim() || null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        description: l.description.trim(),
        supplierCode: l.supplierCode.trim() || null,
        unit: l.unit.trim() || 'pc',
        quantity: toDecimal(l.quantity)!,
        unitPrice: l.unitPrice,
        budgetLineId: l.budgetLineId,
        sourceKey: l.sourceKey,
      })),
    };
  };
  const save = useApiMutation<{ then?: 'send' }, PurchaseOrderDto>(
    () => ({ path: '/purchase-orders', body: body() }),
    {
      invalidate: INVALIDATE,
      successMessage: (_r, v) => (v.then ? '' : t('saved')),
      onSuccess: (dto, v) => {
        queryClient.setQueryData(['purchase_orders', 'detail', dto.id], dto);
        onSaved(dto.id);
        if (v.then === 'send') setSending(dto);
      },
    },
  );
  const remove = useApiMutation<void>(() => ({ path: `/purchase-orders/${id}`, method: 'DELETE' }), {
    invalidate: INVALIDATE,
    successMessage: t('deleted'),
    onSuccess: onDeleted,
  });
  const submit = (then?: 'send') => {
    if (body()) save.mutate({ then });
  };
  const update = (key: string, patch: Partial<EditLine>) =>
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  if (project.isLoading || suppliers.isLoading) return <Skeleton className="h-96" />;
  const posts = project.data?.budgetLines ?? [];
  const supplierOptions = [
    { value: '', label: t('chooseSupplier') },
    ...(suppliers.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];

  return (
    <div className="flex flex-col gap-6">
      {!suppliers.data?.items.length ? (
        <Notice tone="warn" title={t('noSuppliers')}>
          <Link href="/achats/fournisseurs?nouveau=1" className="font-medium text-accent underline">
            {t('createSupplier')}
          </Link>
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label={t('supplier')}
          value={supplierId}
          options={supplierOptions}
          disabled={!editable}
          onChange={(e) => setSupplierId(e.target.value)}
        />
        <TextField
          label={t('expectedOn')}
          type="date"
          value={expectedOn}
          disabled={!editable}
          onChange={(e) => setExpectedOn(e.target.value)}
        />
        <TextField
          label={t('deliveryAddress')}
          containerClassName="sm:col-span-2"
          value={deliveryAddress}
          placeholder={project.data?.site?.address ?? ''}
          hint={t('deliveryHint')}
          disabled={!editable}
          onChange={(e) => setDeliveryAddress(e.target.value)}
        />
      </div>

      <section aria-labelledby="po-lines" className="flex flex-col gap-3">
        <h3 id="po-lines" className="text-[15px] font-semibold">
          {t('lines')}
        </h3>
        <ul className="flex flex-col gap-3">
          {lines.map((l, index) => (
            <li key={l.key} className="grid gap-3 rounded-[12px] border border-line p-3 sm:grid-cols-6">
              <TextField
                label={t('line.description', { n: index + 1 })}
                containerClassName="sm:col-span-4"
                value={l.description}
                disabled={!editable}
                onChange={(e) => update(l.key, { description: e.target.value })}
              />
              <TextField
                label={t('line.code')}
                containerClassName="sm:col-span-2"
                value={l.supplierCode}
                disabled={!editable}
                onChange={(e) => update(l.key, { supplierCode: e.target.value })}
              />
              <TextField
                label={t('line.quantity')}
                inputMode="decimal"
                value={l.quantity}
                disabled={!editable}
                onChange={(e) => update(l.key, { quantity: e.target.value })}
              />
              <TextField
                label={t('line.unit')}
                value={l.unit}
                disabled={!editable}
                onChange={(e) => update(l.key, { unit: e.target.value })}
              />
              <MoneyInput
                label={t('line.unitPrice')}
                className="sm:col-span-2"
                cents={l.unitPrice}
                onChange={(unitPrice) => update(l.key, { unitPrice })}
              />
              <SelectField
                label={t('line.post')}
                containerClassName="sm:col-span-2"
                value={l.budgetLineId ?? ''}
                disabled={!editable}
                options={[
                  { value: '', label: t('line.noPost') },
                  ...posts.map((b) => ({ value: b.id, label: b.label })),
                ]}
                onChange={(e) => update(l.key, { budgetLineId: e.target.value || null })}
              />
              {editable ? (
                <div className="flex items-end justify-between gap-2 sm:col-span-6">
                  <span className="text-[13px] text-muted tabular-nums">
                    {toDecimal(l.quantity)
                      ? formatEuros(lineTotal(toDecimal(l.quantity)!, BigInt(l.unitPrice)))
                      : '—'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 aria-hidden className="size-4" />}
                    disabled={lines.length === 1}
                    onClick={() => setLines((list) => list.filter((x) => x.key !== l.key))}
                  >
                    {t('line.remove')}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => setLines((list) => [...list, newLine()])}
          >
            {t('addLine')}
          </Button>
        ) : null}
      </section>

      <TextAreaField
        label={t('notes')}
        value={notes}
        rows={3}
        disabled={!editable}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="flex items-center justify-between border-t border-line-soft pt-4">
        <span className="text-[14px] text-muted">{t('totalNet')}</span>
        <span className="text-[18px] font-semibold tabular-nums">{formatEuros(total)}</span>
      </div>
      {error ? (
        <p role="alert" className="text-[14px] text-crit">
          {error}
        </p>
      ) : null}
      {editable ? (
        <div className="flex flex-wrap justify-end gap-2">
          {order ? (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              {t('deleteDraft')}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            loading={save.isPending && !save.variables?.then}
            onClick={() => submit()}
          >
            {tc('save')}
          </Button>
          <Button
            icon={<Send aria-hidden className="size-4" />}
            loading={save.isPending && save.variables?.then === 'send'}
            onClick={() => submit('send')}
          >
            {t('send')}
          </Button>
        </div>
      ) : null}
      {sending ? <SendDialog order={sending} onClose={() => setSending(null)} /> : null}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={tc('delete')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
        destructive
        loading={remove.isPending}
      />
    </div>
  );
}

function newLine(): EditLine {
  return {
    key: uuidv7(),
    description: '',
    supplierCode: '',
    unit: 'pc',
    quantity: '1',
    unitPrice: 0,
    budgetLineId: null,
    sourceKey: null,
  };
}

function SendDialog({ order, onClose }: { order: PurchaseOrderDto; onClose: () => void }) {
  const t = useTranslations('purchasing.order.sendDialog');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(order.supplier.orderEmail ?? '');
  const [message, setMessage] = useState('');
  const send = useApiMutation<void, PurchaseOrderDto>(
    () => ({
      path: `/purchase-orders/${order.id}/send`,
      body: { ...(email.trim() ? { email: email.trim() } : {}), message: message.trim() || null },
    }),
    {
      invalidate: INVALIDATE,
      successMessage: (r) => t('sent', { number: r.number ?? '', email: r.sentTo ?? '' }),
      onSuccess: (dto) => {
        queryClient.setQueryData(['purchase_orders', 'detail', dto.id], dto);
        onClose();
      },
    },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title', { supplier: order.supplier.name })}
      description={t('description', { total: formatEuros(BigInt(order.totalNet)) })}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button
            icon={<Send aria-hidden className="size-4" />}
            loading={send.isPending}
            onClick={() => send.mutate()}
          >
            {t('confirm')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <TextField
          label={t('email')}
          type="email"
          autoComplete="email"
          value={email}
          hint={order.supplier.orderEmail ? undefined : t('emailHint')}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextAreaField
          label={t('message')}
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bon envoyé : lecture, réception, annulation
// ---------------------------------------------------------------------------

function OrderView({ order: o }: { order: PurchaseOrderDto }) {
  const t = useTranslations('purchasing.order');
  const tc = useTranslations('common');
  const can = useCan();
  const queryClient = useQueryClient();
  const [receiving, setReceiving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancel = useApiMutation<void>(() => ({ path: `/purchase-orders/${o.id}`, method: 'DELETE' }), {
    invalidate: INVALIDATE,
    successMessage: t('cancelled'),
    onSuccess: () => {
      setConfirmCancel(false);
      void queryClient.invalidateQueries({ queryKey: ['purchase_orders', 'detail', o.id] });
    },
  });
  const open = o.status === 'sent' || o.status === 'partially_received';
  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-4">
        <Fact label={t('sentAt')} value={o.sentAt ? formatDay(o.sentAt) : '—'} />
        <Fact label={t('sentTo')} value={o.sentTo ?? '—'} />
        <Fact label={t('expectedOn')} value={formatDay(o.expectedOn)} />
        <Fact
          label={t('invoiced')}
          value={`${formatEuros(BigInt(o.invoiced))} / ${formatEuros(BigInt(o.totalNet))}`}
        />
        <Fact label={t('deliveryAddress')} value={o.deliveryAddress ?? '—'} wide />
      </dl>
      <Table label={t('lines')}>
        <thead>
          <tr>
            <Th>{t('line.descriptionColumn')}</Th>
            <Th align="right">{t('line.ordered')}</Th>
            <Th align="right">{t('line.received')}</Th>
            <Th align="right" className="hidden sm:table-cell">
              {t('line.total')}
            </Th>
          </tr>
        </thead>
        <tbody>
          {o.lines.map((l) => (
            <tr key={l.id}>
              <Td>
                <span className="block">{l.description}</span>
                <span className="text-[12px] text-muted">
                  {[l.supplierCode, l.budgetLineLabel].filter(Boolean).join(' · ') || ' '}
                </span>
              </Td>
              <Td align="right" className="tabular-nums">
                {formatQuantity(l.quantity)} {l.unit}
              </Td>
              <Td align="right" className="tabular-nums">
                {formatQuantity(l.receivedQuantity)}
              </Td>
              <Td align="right" className="hidden tabular-nums sm:table-cell">
                {formatEuros(BigInt(l.total))}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {o.notes ? <p className="text-[14px] whitespace-pre-line text-muted">{o.notes}</p> : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft pt-4">
        {o.number ? (
          <a
            href={`/api/v1/purchase-orders/${o.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line px-4 text-[14px] font-medium hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
          >
            <FileDown aria-hidden className="size-4" />
            {t('pdf')}
          </a>
        ) : null}
        {open && can('purchases.write') ? (
          <>
            {o.invoiced === 0 ? (
              <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                {t('cancel')}
              </Button>
            ) : null}
            <Button icon={<PackageCheck aria-hidden className="size-4" />} onClick={() => setReceiving(true)}>
              {t('receive')}
            </Button>
          </>
        ) : null}
      </div>
      {receiving ? <ReceiveDialog order={o} onClose={() => setReceiving(false)} /> : null}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => cancel.mutate()}
        title={t('cancelTitle')}
        description={t('cancelDescription')}
        confirmLabel={t('cancel')}
        cancelLabel={tc('back')}
        closeLabel={tc('close')}
        destructive
        loading={cancel.isPending}
      />
    </div>
  );
}

function ReceiveDialog({ order, onClose }: { order: PurchaseOrderDto; onClose: () => void }) {
  const t = useTranslations('purchasing.order.receiveDialog');
  const tc = useTranslations('common');
  const queryClient = useQueryClient();
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      order.lines.map((l) => {
        const rest = dec(l.quantity).minus(dec(l.receivedQuantity));
        return [l.id, rest.isPositive() ? fromDecimal(rest.toString()) : '0'];
      }),
    ),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const receive = useApiMutation<{ lines: { lineId: string; quantity: string }[] }, PurchaseOrderDto>(
    (b) => ({ path: `/purchase-orders/${order.id}/receipts`, body: { ...b, note: note.trim() || null } }),
    {
      invalidate: INVALIDATE,
      successMessage: t('done'),
      onSuccess: (dto) => {
        queryClient.setQueryData(['purchase_orders', 'detail', dto.id], dto);
        onClose();
      },
    },
  );
  const submit = () => {
    const lines = [];
    for (const l of order.lines) {
      const q = toDecimal(quantities[l.id] ?? '');
      if (q === null) return setError(t('invalid'));
      if (!dec(q).isZero()) lines.push({ lineId: l.id, quantity: q });
    }
    if (!lines.length) return setError(t('nothing'));
    setError(null);
    receive.mutate({ lines });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="w-[min(94vw,640px)]"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={receive.isPending} onClick={submit}>
            {t('confirm')}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-3">
        {order.lines.map((l) => (
          <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-end gap-3">
            <p className="pb-3 text-[14px]">
              {l.description}
              <span className="block text-[12px] text-muted">
                {t('progress', {
                  received: formatQuantity(l.receivedQuantity),
                  ordered: formatQuantity(l.quantity),
                  unit: l.unit,
                })}
              </span>
            </p>
            <TextField
              label={t('received')}
              aria-label={t('quantity', { description: l.description })}
              inputMode="decimal"
              value={quantities[l.id] ?? ''}
              onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      <TextAreaField
        label={t('note')}
        rows={2}
        value={note}
        containerClassName="mt-4"
        onChange={(e) => setNote(e.target.value)}
      />
      {error ? (
        <p role="alert" className="mt-3 text-[14px] text-crit">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div
      className={wide ? 'col-span-2 flex flex-col gap-0.5 sm:col-span-4' : 'flex min-w-0 flex-col gap-0.5'}
    >
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}
