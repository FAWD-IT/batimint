'use client';

import type {
  OrderProposalDto,
  ProjectDto,
  PurchaseOrderDto,
  PurchaseOrderSummaryDto,
  SupplierDto,
  SupplierInvoiceSummaryDto,
} from '@batimint/contracts';
import { formatEuros, formatQuantity, lineTotal } from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  Notice,
  SelectField,
  Skeleton,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardList, PackagePlus, Plus, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';
import { OrderDrawer } from './OrderDrawer';
import { OrdersTable } from './OrdersView';
import { INVOICE_STATUS_TONES } from './status';

/** Onglet « Achats » du cockpit : bons de commande du chantier et factures imputées. */
export function PurchasesTab({ project }: { project: ProjectDto }) {
  const t = useTranslations('purchasing');
  const can = useCan();
  const relative = useRelativeTime();
  const [drawer, setDrawer] = useState<{ id: string | null } | null>(null);
  const [proposing, setProposing] = useState(false);
  const orders = useApi<{ items: PurchaseOrderSummaryDto[] }>(
    ['purchase_orders', 'list', 'project', project.id],
    `/purchase-orders?projectId=${project.id}`,
  );
  const invoices = useApi<{ items: SupplierInvoiceSummaryDto[] }>(
    ['supplier_invoices', 'list', 'project', project.id],
    can('supplier_invoices.read') ? `/supplier-invoices?view=all&projectId=${project.id}` : null,
  );
  const items = orders.data?.items ?? [];
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="po-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="po-title" className="text-[17px] font-semibold">
            {t('orders.title')}
          </h2>
          {can('purchases.write') ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => setDrawer({ id: null })}
              >
                {t('orders.new')}
              </Button>
              <Button
                size="sm"
                icon={<PackagePlus aria-hidden className="size-4" />}
                onClick={() => setProposing(true)}
              >
                {t('proposal.open')}
              </Button>
            </div>
          ) : null}
        </div>
        {orders.isLoading ? (
          <Skeleton className="h-40" />
        ) : items.length ? (
          <OrdersTable items={items} onOpen={(id) => setDrawer({ id })} relative={relative} />
        ) : (
          <EmptyState
            icon={<ClipboardList aria-hidden className="size-5" />}
            title={t('orders.projectEmptyTitle')}
            description={t('orders.projectEmpty')}
            action={
              can('purchases.write') ? (
                <Button onClick={() => setProposing(true)}>{t('proposal.open')}</Button>
              ) : null
            }
          />
        )}
      </section>

      {can('supplier_invoices.read') ? (
        <Card className="flex flex-col gap-3 p-5">
          <CardTitle>{t('projectInvoices.title')}</CardTitle>
          {invoices.isLoading ? (
            <Skeleton className="h-24" />
          ) : invoices.data?.items.length ? (
            <ul className="flex flex-col divide-y divide-line-soft">
              {invoices.data.items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/achats/factures?vue=all&facture=${i.id}`}
                    className="flex min-h-11 min-w-0 flex-col justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="font-medium hover:underline">
                      {i.supplier.name}
                      {i.number ? (
                        <span className="ml-2 font-mono text-[13px] text-muted">{i.number}</span>
                      ) : null}
                    </span>
                    <span className="text-[12px] text-muted">
                      {i.purchaseOrder?.number ? `${i.purchaseOrder.number} · ` : ''}
                      {relative(i.receivedAt)}
                    </span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular-nums">{formatEuros(BigInt(i.totalNet))}</span>
                    <Chip tone={INVOICE_STATUS_TONES[i.status] ?? 'neutral'} dot>
                      {t(`invoice.status.${i.status}`)}
                    </Chip>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-[14px] text-muted">
              <Receipt aria-hidden className="size-4" />
              {t('projectInvoices.empty')}
            </p>
          )}
        </Card>
      ) : null}

      {drawer ? (
        <OrderDrawer orderId={drawer.id} projectId={project.id} onClose={() => setDrawer(null)} />
      ) : null}
      {proposing ? (
        <ProposalDialog
          project={project}
          onClose={() => setProposing(false)}
          onCreated={(first) => {
            setProposing(false);
            if (first) setDrawer({ id: first });
          }}
        />
      ) : null}
    </div>
  );
}

/** Matériaux du devis groupés par fournisseur → un bon de commande brouillon par fournisseur (P3.3). */
function ProposalDialog({
  project,
  onClose,
  onCreated,
}: {
  project: ProjectDto;
  onClose: () => void;
  onCreated: (firstOrderId: string | null) => void;
}) {
  const t = useTranslations('purchasing.proposal');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const proposal = useApi<OrderProposalDto>(
    ['purchase_orders', 'proposal', project.id],
    `/projects/${project.id}/order-proposal`,
  );
  const suppliers = useApi<{ items: SupplierDto[] }>(['suppliers', 'list', ''], '/suppliers');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [supplierOf, setSupplierOf] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = proposal.data?.groups ?? [];
  const isPicked = (key: string, alreadyOrdered: boolean) => picked[key] ?? !alreadyOrdered;
  const chosen = groups
    .map((g, index) => ({
      index,
      supplierId: supplierOf[index] ?? g.supplierId ?? '',
      lines: g.lines.filter((l) => isPicked(l.sourceKey, l.alreadyOrdered)),
    }))
    .filter((g) => g.lines.length);

  const create = async () => {
    if (!chosen.length) return setError(t('nothing'));
    if (chosen.some((g) => !g.supplierId)) return setError(t('missingSupplier'));
    setError(null);
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const g of chosen) {
        const dto = await api<PurchaseOrderDto>('/purchase-orders', {
          body: {
            id: uuidv7(),
            projectId: project.id,
            supplierId: g.supplierId,
            lines: g.lines.map((l) => ({
              description: l.description,
              supplierCode: l.supplierCode ?? null,
              unit: l.unit,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              budgetLineId: l.budgetLineId ?? null,
              sourceKey: l.sourceKey,
            })),
          },
        });
        ids.push(dto.id);
      }
      void queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      toast.show({ title: t('created', { n: ids.length }), tone: 'good' });
      onCreated(ids.length === 1 ? ids[0]! : null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const supplierOptions = [
    { value: '', label: t('chooseSupplier') },
    ...(suppliers.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      className="w-[min(94vw,760px)]"
      footer={
        groups.length ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button loading={busy} disabled={!chosen.length} onClick={() => void create()}>
              {t('create', { n: chosen.length })}
            </Button>
          </>
        ) : undefined
      }
    >
      {proposal.isLoading || suppliers.isLoading ? (
        <Skeleton className="h-48" />
      ) : proposal.error ? (
        <Notice tone="crit">{errorMessage(proposal.error)}</Notice>
      ) : !groups.length ? (
        <EmptyState
          icon={<PackagePlus aria-hidden className="size-5" />}
          title={t('emptyTitle')}
          description={project.quote ? t('empty') : t('noQuote')}
        />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g, index) => {
            const selected = g.lines.filter((l) => isPicked(l.sourceKey, l.alreadyOrdered));
            const total = selected.reduce((s, l) => s + lineTotal(l.quantity, BigInt(l.unitPrice)), 0n);
            return (
              <section
                key={g.supplierId ?? `none-${index}`}
                aria-label={g.supplierName ?? t('unknownSupplier')}
                className="flex flex-col gap-3 rounded-[12px] border border-line p-4"
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  {g.supplierId ? (
                    <h3 className="text-[15px] font-semibold">{g.supplierName}</h3>
                  ) : (
                    <SelectField
                      label={t('supplierFor', { n: index + 1 })}
                      hint={t('supplierHint')}
                      containerClassName="min-w-60"
                      value={supplierOf[index] ?? ''}
                      options={supplierOptions}
                      onChange={(e) => setSupplierOf((m) => ({ ...m, [index]: e.target.value }))}
                    />
                  )}
                  <span className="text-[14px] font-semibold tabular-nums">{formatEuros(total)}</span>
                </div>
                <ul className="flex flex-col">
                  {g.lines.map((l) => (
                    <li key={l.sourceKey} className="flex items-center justify-between gap-3">
                      <Checkbox
                        label={
                          <span>
                            {l.description}
                            <span className="block text-[12px] text-muted">
                              {formatQuantity(l.quantity)} {l.unit} · {l.budgetLineLabel ?? '—'}
                              {l.alreadyOrdered ? ` · ${t('alreadyOrdered')}` : ''}
                            </span>
                          </span>
                        }
                        checked={isPicked(l.sourceKey, l.alreadyOrdered)}
                        onChange={(e) => setPicked((p) => ({ ...p, [l.sourceKey]: e.target.checked }))}
                      />
                      <span className="shrink-0 text-[13px] text-muted tabular-nums">
                        {formatEuros(lineTotal(l.quantity, BigInt(l.unitPrice)))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {error ? (
            <p role="alert" className="text-[14px] text-crit">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
