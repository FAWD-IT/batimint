/**
 * Achats (03 §8) : bons de commande, proposition depuis le devis, factures fournisseurs reçues
 * (Peppol, dépôt) jusqu'à leur ventilation sur les chantiers.
 */
import type {
  DiscrepancyDto,
  OrderProposalDto,
  PurchaseOrderDto,
  SupplierInvoiceDto,
} from '@batimint/contracts';
import { emitEvent, type EventActor, type Tx } from '@batimint/db';
import type { ParsedUbl } from '@batimint/documents';
import { groupBySupplier, lineTotal, normalizeRef } from '@batimint/domain';
import { iso, isoDate } from '../lib/tenant';
import { invoiceThirtyBis } from './subcontracting';

type PoRow = Awaited<ReturnType<Tx['purchaseOrder']['findUniqueOrThrow']>> & {
  lines: Awaited<ReturnType<Tx['purchaseOrderLine']['findUniqueOrThrow']>>[];
  supplier: { id: string; name: string; orderEmail: string | null; email: string | null };
  project: { id: string; number: string; name: string };
};

export const PO_INCLUDE = {
  lines: { orderBy: { position: 'asc' as const } },
  supplier: { select: { id: true, name: true, orderEmail: true, email: true } },
  project: { select: { id: true, number: true, name: true } },
};

/** Montant déjà facturé par bon de commande (ventilations des factures rapprochées). */
export async function invoicedByOrder(tx: Tx, orderIds: string[]): Promise<Map<string, bigint>> {
  if (!orderIds.length) return new Map();
  const invoices = await tx.supplierInvoice.findMany({
    where: {
      purchaseOrderId: { in: orderIds },
      status: { in: ['allocated', 'validated', 'to_pay', 'blocked', 'paid'] },
    },
    select: { purchaseOrderId: true, totalNet: true },
  });
  const map = new Map<string, bigint>();
  for (const i of invoices) map.set(i.purchaseOrderId!, (map.get(i.purchaseOrderId!) ?? 0n) + i.totalNet);
  return map;
}

export async function poDto(tx: Tx, po: PoRow, invoiced?: bigint): Promise<PurchaseOrderDto> {
  const labels = new Map(
    (
      await tx.budgetLine.findMany({
        where: { id: { in: po.lines.flatMap((l) => (l.budgetLineId ? [l.budgetLineId] : [])) } },
        select: { id: true, label: true },
      })
    ).map((b) => [b.id, b.label]),
  );
  return {
    id: po.id,
    number: po.number,
    status: po.status,
    project: po.project,
    supplier: {
      id: po.supplier.id,
      name: po.supplier.name,
      orderEmail: po.supplier.orderEmail ?? po.supplier.email,
    },
    expectedOn: isoDate(po.expectedOn),
    deliveryAddress: po.deliveryAddress,
    notes: po.notes,
    totalNet: Number(po.totalNet),
    invoiced: Number(invoiced ?? (await invoicedByOrder(tx, [po.id])).get(po.id) ?? 0n),
    sentAt: iso(po.sentAt),
    sentTo: po.sentTo,
    lines: po.lines.map((l) => ({
      id: l.id,
      description: l.description,
      supplierCode: l.supplierCode,
      unit: l.unit,
      quantity: l.quantity.toString(),
      unitPrice: Number(l.unitPrice),
      total: Number(lineTotal(l.quantity.toString(), l.unitPrice)),
      budgetLineId: l.budgetLineId,
      budgetLineLabel: l.budgetLineId ? (labels.get(l.budgetLineId) ?? null) : null,
      receivedQuantity: l.receivedQuantity.toString(),
      sourceKey: l.sourceKey,
    })),
    createdAt: po.createdAt.toISOString(),
  };
}

/**
 * Matériaux du devis signé à commander (P3.3), groupés par fournisseur préféré de l'article.
 * Une ligne déjà commandée (BC non annulé) est signalée pour ne pas la commander deux fois.
 */
export async function orderProposal(tx: Tx, projectId: string): Promise<OrderProposalDto> {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { quoteId: true } });
  const quote = project?.quoteId
    ? await tx.quote.findUnique({ where: { id: project.quoteId }, select: { currentVersionId: true } })
    : null;
  if (!quote?.currentVersionId) return { groups: [] };
  const sections = await tx.quoteSection.findMany({
    // Sections obligatoires, et options retenues par le client.
    where: { versionId: quote.currentVersionId, OR: [{ optional: false }, { selected: true }] },
    include: { lines: { orderBy: { position: 'asc' } } },
    orderBy: { position: 'asc' },
  });
  const budgetLines = await tx.budgetLine.findMany({
    where: { projectId },
    select: { id: true, label: true, quoteSectionKey: true },
  });
  const postOf = new Map(budgetLines.map((b) => [b.quoteSectionKey, b]));
  const itemIds = sections.flatMap((s) => s.lines.flatMap((l) => (l.itemId ? [l.itemId] : [])));
  const items = new Map(
    (
      await tx.item.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, kind: true, supplierId: true, code: true },
      })
    ).map((i) => [i.id, i]),
  );
  const supplierCodes = new Map(
    (
      await tx.supplierPrice.findMany({
        where: { itemId: { in: itemIds } },
        select: { itemId: true, supplierId: true, supplierCode: true },
      })
    ).map((p) => [`${p.itemId}|${p.supplierId}`, p.supplierCode]),
  );
  const ordered = new Set(
    (
      await tx.purchaseOrderLine.findMany({
        where: { purchaseOrder: { projectId, status: { not: 'cancelled' } }, sourceKey: { not: null } },
        select: { sourceKey: true },
      })
    ).map((l) => l.sourceKey!),
  );
  const materials = sections.flatMap((s) =>
    s.lines
      .filter((l) => {
        if (l.kind !== 'item' || l.unitCost <= 0n) return false;
        const item = l.itemId ? items.get(l.itemId) : null;
        // Matériaux : article de type « matériau », ou ligne libre sans main-d'œuvre.
        return item ? item.kind === 'material' : Number(l.laborHours.toString()) === 0;
      })
      .map((l) => {
        const item = l.itemId ? items.get(l.itemId) : null;
        const supplierId = item?.supplierId ?? null;
        return {
          key: l.key,
          description: l.description,
          unit: l.unit,
          quantity: l.quantity.toString(),
          unitCost: l.unitCost,
          budgetLineId: postOf.get(s.key)?.id ?? null,
          supplierId,
          supplierCode:
            item && supplierId ? (supplierCodes.get(`${item.id}|${supplierId}`) ?? item.code) : null,
        };
      }),
  );
  const groups = groupBySupplier(materials);
  const names = new Map(
    (
      await tx.supplier.findMany({
        where: { id: { in: groups.flatMap((g) => (g.supplierId ? [g.supplierId] : [])) } },
        select: { id: true, name: true },
      })
    ).map((s) => [s.id, s.name]),
  );
  const labelOf = new Map(budgetLines.map((b) => [b.id, b.label]));
  return {
    groups: groups.map((g) => ({
      supplierId: g.supplierId,
      supplierName: g.supplierId ? (names.get(g.supplierId) ?? null) : null,
      total: Number(g.total),
      lines: g.lines.map((l) => ({
        description: l.description,
        supplierCode: l.supplierCode ?? null,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: Number(l.unitCost),
        budgetLineId: l.budgetLineId,
        sourceKey: l.key,
        budgetLineLabel: l.budgetLineId ? (labelOf.get(l.budgetLineId) ?? null) : null,
        alreadyOrdered: ordered.has(l.key),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Factures fournisseurs
// ---------------------------------------------------------------------------

/** Retrouve le fournisseur par numéro de TVA ou d'entreprise (chiffres seuls). */
export async function findSupplier(tx: Tx, vat: string | null, enterprise: string | null) {
  const digits = (s: string | null) =>
    s
      ? normalizeRef(s)
          .replace(/^BE/, '')
          .replace(/^0?(\d{9})$/, '0$1')
      : null;
  const keys = [digits(vat), digits(enterprise)].filter((k): k is string => Boolean(k));
  if (!keys.length) return null;
  const all = await tx.supplier.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, vatNumber: true, enterpriseNumber: true },
  });
  return (
    all.find(
      (s) => keys.includes(digits(s.vatNumber) ?? '') || keys.includes(digits(s.enterpriseNumber) ?? ''),
    ) ?? null
  );
}

/**
 * Enregistre une facture reçue (UBL lu, ou document à extraire) et émet l'événement de réception.
 * Idempotent par identifiant externe (renvoi d'un webhook Peppol).
 */
export async function ingestSupplierInvoice(
  tx: Tx,
  input: {
    tenantId: string;
    id: string;
    source: 'peppol' | 'upload' | 'email';
    externalId: string | null;
    ubl: ParsedUbl | null;
    document: { key: string; contentType: string } | null;
    fallbackName?: string;
    actor: EventActor;
    /** Dépôt par le sous-traitant sur son portail : émetteur et contrat connus. */
    supplierId?: string | null;
    subcontractId?: string | null;
    /** Montants déclarés par le sous-traitant au dépôt d'un PDF (sans UBL). */
    declared?: { number: string; net: bigint; vat: bigint } | null;
  },
) {
  if (input.externalId) {
    const existing = await tx.supplierInvoice.findFirst({ where: { externalId: input.externalId } });
    if (existing) return existing;
  }
  const u = input.ubl;
  const sign = u?.kind === 'credit_note' ? -1n : 1n;
  const supplier = input.supplierId
    ? await tx.supplier.findUnique({ where: { id: input.supplierId } })
    : u
      ? await findSupplier(
          tx,
          u.supplier.vatNumber,
          u.supplier.endpointScheme === '0208' ? u.supplier.endpointId : null,
        )
      : null;
  const invoice = await tx.supplierInvoice.create({
    data: {
      id: input.id,
      tenantId: input.tenantId,
      source: input.source,
      externalId: input.externalId,
      supplierId: supplier?.id ?? null,
      supplierName: supplier?.name ?? u?.supplier.name ?? input.fallbackName ?? 'Fournisseur à identifier',
      supplierVat: u?.supplier.vatNumber ?? null,
      number: u?.number ?? input.declared?.number ?? null,
      issueDate: u?.issueDate ? new Date(`${u.issueDate}T00:00:00Z`) : null,
      dueDate: u?.dueDate ? new Date(`${u.dueDate}T00:00:00Z`) : null,
      currency: u?.currency ?? 'EUR',
      totalNet: (u?.totals.net ?? input.declared?.net ?? 0n) * sign,
      totalVat: (u?.totals.vat ?? input.declared?.vat ?? 0n) * sign,
      totalGross: (u?.totals.gross ?? (input.declared ? input.declared.net + input.declared.vat : 0n)) * sign,
      orderReference: u?.orderReference ?? null,
      deliveryAddress: u?.deliveryAddress ?? null,
      notes: [u?.buyerReference, ...(u?.notes ?? [])].filter(Boolean).join('\n') || null,
      documentKey: input.document?.key ?? null,
      documentType: input.document?.contentType ?? null,
      subcontractId: input.subcontractId ?? null,
      lines: u
        ? {
            create: u.lines.map((l, position) => ({
              tenantId: input.tenantId,
              position,
              description: l.description,
              supplierCode: l.supplierCode,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              net: l.net * sign,
              vatRate: l.vatRate,
            })),
          }
        : undefined,
    },
  });
  await emitEvent(tx, {
    tenantId: input.tenantId,
    type: 'supplier_invoice.received.v1',
    aggregateType: 'supplier_invoice',
    aggregateId: invoice.id,
    payload: { invoiceId: invoice.id, source: input.source },
    actor: input.actor,
  });
  return invoice;
}

type InvoiceRow = Awaited<ReturnType<Tx['supplierInvoice']['findUniqueOrThrow']>> & {
  lines: Awaited<ReturnType<Tx['supplierInvoiceLine']['findUniqueOrThrow']>>[];
  allocations: Awaited<ReturnType<Tx['costAllocation']['findUniqueOrThrow']>>[];
};

export const INVOICE_INCLUDE = {
  lines: { orderBy: { position: 'asc' as const } },
  allocations: { orderBy: { createdAt: 'asc' as const } },
};

export async function invoiceDto(tx: Tx, i: InvoiceRow): Promise<SupplierInvoiceDto> {
  const suggestions =
    (i.suggestions as { projectId: string; budgetLineId: string | null; score: number; reason: string }[]) ??
    [];
  const projectIds = [
    ...new Set([
      ...i.allocations.map((a) => a.projectId),
      ...suggestions.map((s) => s.projectId),
      ...(i.projectId ? [i.projectId] : []),
    ]),
  ];
  const projects = new Map(
    (
      await tx.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, number: true, name: true },
      })
    ).map((p) => [p.id, p]),
  );
  const lineIds = [
    ...i.allocations.map((a) => a.budgetLineId),
    ...suggestions.map((s) => s.budgetLineId),
  ].filter((x): x is string => Boolean(x));
  const posts = new Map(
    (await tx.budgetLine.findMany({ where: { id: { in: lineIds } }, select: { id: true, label: true } })).map(
      (b) => [b.id, b.label],
    ),
  );
  const po = i.purchaseOrderId
    ? await tx.purchaseOrder.findUnique({
        where: { id: i.purchaseOrderId },
        select: { id: true, number: true },
      })
    : null;
  const label = (id: string) => {
    const p = projects.get(id);
    return p ? `${p.number} — ${p.name}` : '—';
  };
  const project = i.projectId ? projects.get(i.projectId) : null;
  return {
    id: i.id,
    source: i.source,
    supplier: { id: i.supplierId, name: i.supplierName, vatNumber: i.supplierVat },
    number: i.number,
    issueDate: isoDate(i.issueDate),
    dueDate: isoDate(i.dueDate),
    totalNet: Number(i.totalNet),
    totalVat: Number(i.totalVat),
    totalGross: Number(i.totalGross),
    orderReference: i.orderReference,
    notes: i.notes,
    status: i.status,
    matchMethod: i.matchMethod,
    matchConfidence: i.matchConfidence ? Number(i.matchConfidence) : null,
    purchaseOrder: po,
    project: project ?? null,
    suggestions: suggestions
      .filter((s) => projects.has(s.projectId))
      .map((s) => ({
        projectId: s.projectId,
        projectLabel: label(s.projectId),
        budgetLineId: s.budgetLineId,
        budgetLineLabel: s.budgetLineId ? (posts.get(s.budgetLineId) ?? null) : null,
        score: s.score,
        reason: s.reason,
      })),
    discrepancies: ((i.discrepancies as DiscrepancyDto[]) ?? []).map((d) => d),
    allocations: i.allocations.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      projectLabel: label(a.projectId),
      budgetLineId: a.budgetLineId,
      budgetLineLabel: a.budgetLineId ? (posts.get(a.budgetLineId) ?? null) : null,
      amount: Number(a.amount),
    })),
    lines: i.lines.map((l) => ({
      description: l.description,
      supplierCode: l.supplierCode,
      quantity: l.quantity.toString(),
      unitPrice: Number(l.unitPrice),
      net: Number(l.net),
      vatRate: l.vatRate?.toString() ?? null,
    })),
    documentUrl: i.documentKey ? `/api/v1/supplier-invoices/${i.id}/document` : null,
    receivedAt: i.receivedAt.toISOString(),
    ...(await invoiceThirtyBis(tx, i)),
  };
}
