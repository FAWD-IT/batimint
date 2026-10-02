/**
 * Achats (03 §8, 02 P6) — effets idempotents :
 *  - BC envoyé : e-mail au fournisseur (PDF), fil du chantier, engagement sur le budget ;
 *  - facture reçue : extraction (dépôt PDF), rapprochement BC → référence → adresse, sinon
 *    suggestions IA et boîte « À imputer » ;
 *  - facture ventilée : grand livre des coûts, engagement restant des BC, fil, écarts signalés.
 */
import { parseEventPayload, projectChannel, tenantChannel } from '@batimint/contracts';
import { emitEvent, type Tx } from '@batimint/db';
import {
  allocateInvoice,
  compareWithOrder,
  type Discrepancy,
  dec,
  formatEuros,
  lineTotal,
  matchSupplierInvoice,
  remainingCommitment,
  roundHalfAwayFromZero,
} from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer, ConsumerContext } from '../consumer';
import { notify, office } from './shared';

const SYSTEM = { type: 'system' as const, label: 'Batimint' };
const SOURCE_LABEL = { peppol: 'reçue via Peppol', upload: 'déposée', email: 'reçue par e-mail' } as const;
/** Une suggestion IA seule n'impute jamais automatiquement : elle reste à confirmer. */
const AI_LIMIT = 5;

async function publish(ctx: ConsumerContext, projectIds: string[], topics: string[]) {
  for (const id of new Set(projectIds))
    for (const topic of topics) await ctx.publish({ channel: projectChannel(id), topic, ref: id });
  await ctx.publish({
    channel: tenantChannel(ctx.event.tenantId),
    topic: 'supplier_invoices',
    ref: ctx.event.aggregateId,
  });
  await ctx.publish({
    channel: tenantChannel(ctx.event.tenantId),
    topic: 'purchase_orders',
    ref: ctx.event.aggregateId,
  });
}

/** Ligne du grand livre, mise à jour en place, et événement de coût (dérive, compta). */
async function upsertCost(
  ctx: ConsumerContext,
  c: {
    projectId: string;
    budgetLineId: string | null;
    category: 'purchase_order' | 'supplier_invoice';
    sourceType: string;
    sourceId: string;
    label: string;
    amount: bigint;
  },
) {
  const { tx, event } = ctx;
  const key = {
    tenantId: event.tenantId,
    category: c.category,
    sourceType: c.sourceType,
    sourceId: c.sourceId,
  };
  const before = await tx.projectCost.findUnique({ where: { tenantId_category_sourceType_sourceId: key } });
  if (before && before.amount === c.amount && before.budgetLineId === c.budgetLineId) return;
  const row = await tx.projectCost.upsert({
    where: { tenantId_category_sourceType_sourceId: key },
    create: {
      ...key,
      projectId: c.projectId,
      budgetLineId: c.budgetLineId,
      label: c.label,
      amount: c.amount,
    },
    update: { amount: c.amount, budgetLineId: c.budgetLineId, label: c.label },
  });
  await emitEvent(tx, {
    tenantId: event.tenantId,
    type: 'project.cost_recorded.v1',
    aggregateType: 'project',
    aggregateId: c.projectId,
    payload: {
      projectId: c.projectId,
      costId: row.id,
      budgetLineId: row.budgetLineId,
      category: c.category,
      amount: row.amount.toString(),
    },
    actor: SYSTEM,
  });
}

/** Engagement restant d'un BC, par poste : commandé − déjà facturé sur ce BC (jamais négatif). */
export async function recomputeOrderCommitment(ctx: ConsumerContext, orderId: string): Promise<void> {
  const { tx } = ctx;
  const po = await tx.purchaseOrder.findUnique({
    where: { id: orderId },
    include: { lines: true, supplier: true },
  });
  if (!po) return;
  const prefix = `${po.id}:`;
  const current = await tx.projectCost.findMany({
    where: { category: 'purchase_order', sourceType: 'purchase_order', sourceId: { startsWith: prefix } },
  });
  const wanted = new Map<string, { budgetLineId: string | null; amount: bigint }>();
  if (['sent', 'partially_received', 'received'].includes(po.status)) {
    const ordered = new Map<string | null, bigint>();
    for (const l of po.lines)
      ordered.set(
        l.budgetLineId,
        (ordered.get(l.budgetLineId) ?? 0n) + lineTotal(l.quantity.toString(), l.unitPrice),
      );
    const invoiced = new Map<string | null, bigint>();
    for (const a of await tx.costAllocation.findMany({
      where: {
        projectId: po.projectId,
        invoice: {
          purchaseOrderId: po.id,
          status: { in: ['allocated', 'validated', 'to_pay', 'blocked', 'paid'] },
        },
      },
    }))
      invoiced.set(a.budgetLineId, (invoiced.get(a.budgetLineId) ?? 0n) + a.amount);
    for (const [bl, amount] of ordered) {
      const rest = remainingCommitment(amount, invoiced.get(bl) ?? 0n);
      if (rest > 0n) wanted.set(`${prefix}${bl ?? 'none'}`, { budgetLineId: bl, amount: rest });
    }
  }
  for (const c of current) {
    if (wanted.has(c.sourceId)) continue;
    await tx.projectCost.delete({ where: { id: c.id } });
    await emitEvent(tx, {
      tenantId: ctx.event.tenantId,
      type: 'project.cost_recorded.v1',
      aggregateType: 'project',
      aggregateId: po.projectId,
      payload: {
        projectId: po.projectId,
        costId: c.id,
        budgetLineId: c.budgetLineId,
        category: 'purchase_order',
        amount: '0',
      },
      actor: SYSTEM,
    });
  }
  for (const [sourceId, w] of wanted)
    await upsertCost(ctx, {
      projectId: po.projectId,
      budgetLineId: w.budgetLineId,
      category: 'purchase_order',
      sourceType: 'purchase_order',
      sourceId,
      label: `BC ${po.number ?? ''} — ${po.supplier.name} (non facturé)`,
      amount: w.amount,
    });
}

export const purchaseOrderSent: Consumer = {
  name: 'purchase-order-sent',
  events: ['purchase_order.sent.v1', 'purchase_order.received.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    if (event.type === 'purchase_order.received.v1') {
      const p = parseEventPayload('purchase_order.received.v1', event.payload);
      const po = await tx.purchaseOrder.findUnique({
        where: { id: p.purchaseOrderId },
        include: { supplier: true },
      });
      if (!po) return;
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          projectId: po.projectId,
          type: 'purchase_order.received',
          title: `${p.complete ? 'Livraison complète' : 'Livraison partielle'} : ${po.number} (${po.supplier.name})`,
          actorLabel: (event.actor as { label?: string } | null)?.label ?? null,
          occurredAt: event.occurredAt,
        },
      });
      await publish(ctx, [po.projectId], ['timeline', 'purchase_orders']);
      return;
    }
    const p = parseEventPayload('purchase_order.sent.v1', event.payload);
    const po = await tx.purchaseOrder.findUnique({
      where: { id: p.purchaseOrderId },
      include: { supplier: true, project: { include: { tenant: true } } },
    });
    if (!po || po.status === 'draft') return;
    const t = po.project.tenant;
    const pdf = po.pdfKey
      ? await deps.integrations.storage.get('uploads', po.pdfKey).catch(() => null)
      : null;
    await deps.integrations.mailer.send({
      ...buildEmail({
        to: p.email,
        subject: `${t.name} — bon de commande ${po.number}`,
        title: `Bon de commande ${po.number}`,
        paragraphs: [
          'Bonjour,',
          `Veuillez trouver ci-joint notre bon de commande ${po.number} pour le chantier « ${po.project.name} » (${formatEuros(po.totalNet)} HTVA).`,
          po.deliveryAddress ? `Livraison : ${po.deliveryAddress}.` : 'Adresse de livraison à convenir.',
          `Merci de reporter le numéro ${po.number} sur votre facture (référence d’achat Peppol) : elle sera rapprochée automatiquement.`,
        ],
        footer: `${t.name}${t.phone ? ` · ${t.phone}` : ''}${t.email ? ` · ${t.email}` : ''}`,
        ...(t.email ? { replyTo: t.email } : {}),
      }),
      ...(pdf
        ? {
            attachments: [
              { filename: `${po.number}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' },
            ],
          }
        : {}),
    });
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        projectId: po.projectId,
        customerId: po.project.customerId,
        type: 'purchase_order.sent',
        title: `Bon de commande ${po.number} envoyé à ${po.supplier.name}`,
        body: p.email,
        amount: -po.totalNet,
        actorLabel: (event.actor as { label?: string } | null)?.label ?? null,
        occurredAt: event.occurredAt,
      },
    });
    await recomputeOrderCommitment(ctx, po.id);
    await publish(ctx, [po.projectId], ['timeline', 'purchase_orders', 'project']);
  },
};

// ---------------------------------------------------------------------------
// Rapprochement
// ---------------------------------------------------------------------------

async function extractIfNeeded(ctx: ConsumerContext, invoiceId: string) {
  const { tx, deps } = ctx;
  const i = await tx.supplierInvoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lines: true },
  });
  if (i.source === 'peppol' || i.lines.length || i.extraction || !i.documentKey) return i;
  const doc = await deps.integrations.storage.get('legal', i.documentKey).catch(() => null);
  if (!doc) return i;
  try {
    const { invoice: x } = await deps.integrations.ai.extractInvoice(
      doc,
      i.documentType ?? 'application/pdf',
      {
        text: [i.supplierName, i.notes].filter(Boolean).join(' '),
      },
    );
    const cents = (v: number | null) => (v === null ? null : roundHalfAwayFromZero(dec(v).times(100)));
    const gross = cents(x.totalGross);
    const net =
      cents(x.totalNet) ?? (gross !== null ? roundHalfAwayFromZero(dec(gross).dividedBy('1.21')) : null);
    return tx.supplierInvoice.update({
      where: { id: i.id },
      data: {
        extraction: JSON.parse(JSON.stringify(x)),
        supplierName: x.supplierName ?? i.supplierName,
        supplierVat: x.supplierVat ?? i.supplierVat,
        number: x.invoiceNumber ?? i.number,
        orderReference: x.purchaseOrderRef ?? i.orderReference,
        ...(net !== null ? { totalNet: net, totalGross: gross ?? net, totalVat: (gross ?? net) - net } : {}),
        lines: {
          create: x.lines.map((l, position) => ({
            tenantId: i.tenantId,
            position,
            description: l.description,
            quantity: l.quantity ?? '1',
            unitPrice: cents(l.unitPrice) ?? 0n,
            net: cents(l.net) ?? 0n,
          })),
        },
      },
      include: { lines: true },
    });
  } catch {
    return i; // l'extraction est une aide : la facture reste à compléter à la main
  }
}

export const supplierInvoiceMatching: Consumer = {
  name: 'supplier-invoice-matching',
  events: ['supplier_invoice.received.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('supplier_invoice.received.v1', event.payload);
    const found = await tx.supplierInvoice.findUnique({ where: { id: p.invoiceId } });
    if (!found || found.status !== 'received') return;
    const invoice = await extractIfNeeded(ctx, found.id);
    const lines = invoice.lines.map((l) => ({
      description: l.description,
      supplierCode: l.supplierCode,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice,
      net: l.net,
    }));
    const orders = await tx.purchaseOrder.findMany({
      where: { status: { in: ['sent', 'partially_received', 'received'] }, number: { not: null } },
      select: { id: true, number: true, supplierId: true, projectId: true },
    });
    const projects = await tx.project.findMany({
      where: { status: { in: ['preparation', 'in_progress', 'suspended', 'provisional_acceptance'] } },
      include: { site: true, budgetLines: { orderBy: { position: 'asc' } } },
    });
    const match = matchSupplierInvoice({
      invoice: {
        supplierId: invoice.supplierId,
        orderReference: invoice.orderReference,
        texts: [invoice.notes ?? '', ...lines.map((l) => l.description)],
        deliveryAddress: invoice.deliveryAddress,
      },
      orders: orders.map((o) => ({ ...o, number: o.number! })),
      projects: projects.map((x) => ({
        id: x.id,
        number: x.number,
        street: x.site?.street ?? null,
        postalCode: x.site?.postalCode ?? null,
      })),
    });

    if (match && invoice.totalNet !== 0n) {
      const orderLines = match.purchaseOrderId
        ? (await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: match.purchaseOrderId } })).map(
            (l) => ({
              id: l.id,
              description: l.description,
              supplierCode: l.supplierCode,
              quantity: l.quantity.toString(),
              unitPrice: l.unitPrice,
              budgetLineId: l.budgetLineId,
            }),
          )
        : [];
      // Sans BC : le poste suggéré par l'IA sur ce chantier, sinon « non ventilé ».
      let fallback: string | null = null;
      if (!orderLines.length) {
        const project = projects.find((x) => x.id === match.projectId)!;
        const { suggestions } = await deps.integrations.ai.suggestAllocation(
          {
            supplierName: invoice.supplierName,
            lines: lines.map((l) => l.description),
            reference: invoice.orderReference,
          },
          [
            {
              id: project.id,
              name: project.name,
              address: project.site?.street ?? '',
              budgetLines: project.budgetLines.map((b) => ({ id: b.id, name: b.label })),
            },
          ],
        );
        fallback = suggestions.find((s) => s.score >= 0.3)?.budgetLineId ?? null;
      }
      const allocations = allocateInvoice({
        totalNet: invoice.totalNet,
        lines,
        orderLines,
        fallbackBudgetLineId: fallback,
      });
      const discrepancies: Discrepancy[] = orderLines.length
        ? compareWithOrder({ lines, orderLines, invoiceNet: invoice.totalNet })
        : [];
      await tx.costAllocation.createMany({
        data: allocations.map((a) => ({
          tenantId: event.tenantId,
          invoiceId: invoice.id,
          projectId: match.projectId,
          budgetLineId: a.budgetLineId,
          amount: a.amount,
        })),
      });
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'allocated',
          matchMethod: match.method,
          matchConfidence: match.confidence.toFixed(3),
          purchaseOrderId: match.purchaseOrderId,
          projectId: match.projectId,
          discrepancies: JSON.parse(
            JSON.stringify(discrepancies, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)),
          ),
          allocatedAt: new Date(),
        },
      });
      await emitEvent(tx, {
        tenantId: event.tenantId,
        type: 'supplier_invoice.allocated.v1',
        aggregateType: 'supplier_invoice',
        aggregateId: invoice.id,
        payload: { invoiceId: invoice.id, projectIds: [match.projectId], automatic: true },
        actor: SYSTEM,
      });
      return;
    }

    // Incertain : suggestions classées (IA) et boîte « À imputer ».
    const { suggestions } = await deps.integrations.ai.suggestAllocation(
      {
        supplierName: invoice.supplierName,
        lines: lines.map((l) => l.description),
        reference: invoice.orderReference,
      },
      projects.map((x) => ({
        id: x.id,
        name: x.name,
        address: x.site ? `${x.site.street}, ${x.site.postalCode} ${x.site.city}` : '',
        budgetLines: x.budgetLines.map((b) => ({ id: b.id, name: b.label })),
      })),
    );
    await tx.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'to_allocate',
        matchMethod: null,
        suggestions: suggestions.slice(0, AI_LIMIT).map((s) => ({ ...s })),
      },
    });
    await emitEvent(tx, {
      tenantId: event.tenantId,
      type: 'supplier_invoice.to_allocate.v1',
      aggregateType: 'supplier_invoice',
      aggregateId: invoice.id,
      payload: { invoiceId: invoice.id },
      actor: SYSTEM,
    });
  },
};

export const supplierInvoiceInbox: Consumer = {
  name: 'supplier-invoice-inbox',
  events: ['supplier_invoice.to_allocate.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('supplier_invoice.to_allocate.v1', event.payload);
    const i = await tx.supplierInvoice.findUnique({ where: { id: p.invoiceId } });
    if (!i) return;
    await notify(
      ctx,
      (await office(tx, event.tenantId)).map((m) => m.userId),
      {
        type: 'supplier_invoice.to_allocate',
        title: `Facture ${i.supplierName} à imputer`,
        body: `${i.number ?? 'Sans numéro'} · ${formatEuros(i.totalNet)} HTVA`,
        link: `/achats/factures?facture=${i.id}`,
      },
    );
    await publish(ctx, [], []);
  },
};

// ---------------------------------------------------------------------------
// Ventilation → grand livre, engagement des BC, fil
// ---------------------------------------------------------------------------

async function postLabels(tx: Tx, ids: (string | null)[]) {
  const rows = await tx.budgetLine.findMany({
    where: { id: { in: ids.filter((x): x is string => Boolean(x)) } },
    select: { id: true, label: true },
  });
  return new Map(rows.map((r) => [r.id, r.label]));
}

export const supplierInvoiceLedger: Consumer = {
  name: 'supplier-invoice-ledger',
  events: ['supplier_invoice.allocated.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('supplier_invoice.allocated.v1', event.payload);
    const i = await tx.supplierInvoice.findUnique({
      where: { id: p.invoiceId },
      include: { allocations: true },
    });
    if (!i) return;
    const prefix = `${i.id}:`;
    const wantedIds = new Set(i.allocations.map((a) => `${prefix}${a.id}`));
    const stale = await tx.projectCost.findMany({
      where: {
        category: 'supplier_invoice',
        sourceType: 'supplier_invoice',
        sourceId: { startsWith: prefix },
      },
    });
    for (const c of stale)
      if (!wantedIds.has(c.sourceId)) await tx.projectCost.delete({ where: { id: c.id } });
    const label = `Facture ${i.supplierName}${i.number ? ` ${i.number}` : ''}`;
    for (const a of i.allocations)
      await upsertCost(ctx, {
        projectId: a.projectId,
        budgetLineId: a.budgetLineId,
        category: 'supplier_invoice',
        sourceType: 'supplier_invoice',
        sourceId: `${prefix}${a.id}`,
        label,
        amount: a.amount,
      });
    if (i.purchaseOrderId) await recomputeOrderCommitment(ctx, i.purchaseOrderId);
    // Commandes d'autres chantiers touchés par une ré-imputation : aucune (le BC suit la facture).

    const posts = await postLabels(
      tx,
      i.allocations.map((a) => a.budgetLineId),
    );
    const po = i.purchaseOrderId
      ? await tx.purchaseOrder.findUnique({ where: { id: i.purchaseOrderId }, select: { number: true } })
      : null;
    const byProject = new Map<string, typeof i.allocations>();
    for (const a of i.allocations) byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a]);
    const actor = (event.actor as { label?: string } | null)?.label ?? null;
    for (const [projectId, list] of byProject) {
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { customerId: true } });
      const where = list
        .map((a) => (a.budgetLineId ? `au poste ${posts.get(a.budgetLineId) ?? ''}` : 'non ventilée'))
        .join(', ');
      const how = p.automatic
        ? i.matchMethod === 'purchase_order'
          ? `Rapprochée du bon de commande ${po?.number ?? ''} · imputée ${where}, sans saisie`
          : i.matchMethod === 'project_reference'
            ? `Reconnue par la référence du chantier · imputée ${where}, sans saisie`
            : `Reconnue par l’adresse de livraison · imputée ${where}, sans saisie`
        : `Imputée ${where}${actor ? ` par ${actor}` : ''}`;
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          projectId,
          customerId: project?.customerId ?? null,
          type: 'supplier_invoice.allocated',
          title: `Facture ${i.supplierName} ${SOURCE_LABEL[i.source]}`,
          body: how,
          amount: -list.reduce((s, a) => s + a.amount, 0n),
          actorLabel: actor,
          occurredAt: event.occurredAt,
          data: { invoiceId: i.id },
        },
      });
    }
    const discrepancies = (i.discrepancies as { kind: string }[]) ?? [];
    if (discrepancies.length)
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'supplier_invoice.discrepancy',
          title: `Écart entre la facture ${i.supplierName} et le bon de commande ${po?.number ?? ''}`,
          body: `${discrepancies.length} écart${discrepancies.length > 1 ? 's' : ''} à vérifier avant de valider`,
          link: `/achats/factures?facture=${i.id}`,
        },
      );
    await publish(ctx, [...byProject.keys()], ['timeline', 'project', 'budget']);
  },
};
