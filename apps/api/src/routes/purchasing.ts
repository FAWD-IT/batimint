/**
 * Achats et factures fournisseurs (03 §8, 02 P3.3, P6) : bons de commande (proposition depuis le
 * devis, envoi numéroté, réception), factures reçues (Peppol, dépôt PDF/XML, simulation en mode
 * mock), boîte « À imputer », ventilation et statuts jusqu'au paiement.
 */
import {
  AllocationInputSchema,
  GoodsReceiptInputSchema,
  OkSchema,
  OrderProposalSchema,
  parseTenantSettings,
  PeppolSimulationSchema,
  PurchaseOrderInputSchema,
  PurchaseOrderSchema,
  PurchaseOrderSendSchema,
  PurchaseOrderSummarySchema,
  SupplierInvoiceSchema,
  SupplierInvoiceSummarySchema,
} from '@batimint/contracts';
import { emitEvent, nextSequenceValue, type Tx, withSystem, withTenant } from '@batimint/db';
import { buildSimpleUbl, parseUbl, renderPurchaseOrderPdf, UblError } from '@batimint/documents';
import {
  assertTransition,
  dec,
  formatDocumentNumber,
  lineTotal,
  SupplierInvoiceStatus,
  sumCents,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { inTenant } from '../lib/tenant';
import {
  ingestSupplierInvoice,
  INVOICE_INCLUDE,
  invoiceDto,
  invoicedByOrder,
  orderProposal,
  PO_INCLUDE,
  poDto,
} from '../services/purchasing';
import { addressLines } from '../services/quotes';

const MAX_UPLOAD = 15 * 1024 * 1024;

async function writeLines(
  tx: Tx,
  tenantId: string,
  poId: string,
  lines: z.infer<typeof PurchaseOrderInputSchema>['lines'],
) {
  await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: poId } });
  await tx.purchaseOrderLine.createMany({
    data: lines.map((l, position) => ({
      tenantId,
      purchaseOrderId: poId,
      position,
      description: l.description,
      supplierCode: l.supplierCode ?? null,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: BigInt(l.unitPrice),
      budgetLineId: l.budgetLineId ?? null,
      sourceKey: l.sourceKey ?? null,
    })),
  });
  return sumCents(lines.map((l) => lineTotal(l.quantity, BigInt(l.unitPrice))));
}

/** PDF du bon de commande, rangé dans le stockage ; renvoie sa clé. */
async function storeOrderPdf(
  deps: AppDeps,
  tx: Tx,
  poId: string,
  at: { number: string; date: Date },
): Promise<string> {
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      project: { include: { tenant: true } },
      supplier: true,
    },
  });
  const t = po.project.tenant;
  const pdf = await renderPurchaseOrderPdf({
    tenant: {
      name: t.legalName ?? t.name,
      lines: [...addressLines(t), ...(t.vatNumber ? [`TVA ${t.vatNumber}`] : [])],
      brandColor: t.brandColor,
    },
    supplier: {
      name: po.supplier.name,
      lines: [
        po.supplier.street,
        [po.supplier.postalCode, po.supplier.city].filter(Boolean).join(' '),
      ].filter((x): x is string => Boolean(x)),
    },
    number: at.number,
    date: at.date,
    projectRef: `${po.project.number} — ${po.project.name}`,
    deliveryAddress: po.deliveryAddress,
    expectedOn: po.expectedOn,
    notes: po.notes,
    lines: po.lines.map((l) => ({
      description: l.description,
      supplierCode: l.supplierCode,
      unit: l.unit,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice,
    })),
    totalNet: po.totalNet,
  });
  const key = `t/${po.tenantId}/purchase-orders/${po.id}/${at.number}.pdf`;
  await deps.integrations.storage.put({ bucket: 'uploads', key, body: pdf, contentType: 'application/pdf' });
  return key;
}

export const purchasingRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    /^(application\/(pdf|xml|octet-stream)|text\/xml|image\/(jpeg|png|webp))$/,
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD },
    (_r, body, done) => done(null, body),
  );

  // -------------------------------------------------------------------------
  // Bons de commande
  // -------------------------------------------------------------------------
  app.get(
    '/projects/:id/order-proposal',
    {
      schema: {
        tags: ['achats'],
        summary: 'Matériaux du devis à commander, groupés par fournisseur',
        params: z.object({ id: z.uuid() }),
        response: { 200: OrderProposalSchema },
      },
    },
    (req) => inTenant(deps, req, 'purchases.write', ({ tx }) => orderProposal(tx, req.params.id)),
  );

  app.get(
    '/purchase-orders',
    {
      schema: {
        tags: ['achats'],
        summary: 'Bons de commande (par chantier ou fournisseur)',
        querystring: z.object({
          projectId: z.uuid().optional(),
          supplierId: z.uuid().optional(),
          status: z.enum(['draft', 'sent', 'partially_received', 'received', 'cancelled', 'open']).optional(),
        }),
        response: { 200: z.object({ items: z.array(PurchaseOrderSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.read', async ({ tx }) => {
        const q = req.query;
        const rows = await tx.purchaseOrder.findMany({
          where: {
            ...(q.projectId ? { projectId: q.projectId } : {}),
            ...(q.supplierId ? { supplierId: q.supplierId } : {}),
            ...(q.status === 'open'
              ? { status: { in: ['draft', 'sent', 'partially_received'] } }
              : q.status
                ? { status: q.status }
                : {}),
          },
          include: PO_INCLUDE,
          orderBy: [{ createdAt: 'desc' }],
          take: 200,
        });
        const invoiced = await invoicedByOrder(
          tx,
          rows.map((r) => r.id),
        );
        const items = [];
        for (const r of rows) {
          const { lines, ...dto } = await poDto(tx, r, invoiced.get(r.id) ?? 0n);
          items.push({ ...dto, lineCount: lines.length });
        }
        return { items };
      }),
  );

  app.get(
    '/purchase-orders/:id',
    {
      schema: {
        tags: ['achats'],
        summary: 'Bon de commande',
        params: z.object({ id: z.uuid() }),
        response: { 200: PurchaseOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.read', async ({ tx }) => {
        const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id }, include: PO_INCLUDE });
        if (!po) throw notFound('Ce bon de commande');
        return poDto(tx, po);
      }),
  );

  app.post(
    '/purchase-orders',
    {
      schema: {
        tags: ['achats'],
        summary: 'Créer ou mettre à jour un bon de commande brouillon (identifiant client)',
        body: PurchaseOrderInputSchema,
        response: { 200: PurchaseOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        const existing = await tx.purchaseOrder.findUnique({ where: { id: b.id } });
        if (existing && existing.status !== 'draft')
          throw conflict('purchase_order_sent', 'Ce bon de commande est envoyé : il ne se modifie plus.');
        const project = await tx.project.findUnique({ where: { id: b.projectId }, include: { site: true } });
        if (!project) throw notFound('Ce chantier');
        if (!(await tx.supplier.findFirst({ where: { id: b.supplierId, archivedAt: null } })))
          throw notFound('Ce fournisseur');
        const posts = new Set(
          (await tx.budgetLine.findMany({ where: { projectId: project.id }, select: { id: true } })).map(
            (x) => x.id,
          ),
        );
        if (b.lines.some((l) => l.budgetLineId && !posts.has(l.budgetLineId)))
          throw badRequest('invalid_budget_line', 'Un poste ne fait pas partie de ce chantier.');
        const address =
          b.deliveryAddress ??
          (project.site ? `${project.site.street}, ${project.site.postalCode} ${project.site.city}` : null);
        if (!existing)
          await tx.purchaseOrder.create({
            data: {
              id: b.id,
              tenantId: auth.tenantId,
              projectId: project.id,
              supplierId: b.supplierId,
              expectedOn: b.expectedOn ? new Date(`${b.expectedOn}T00:00:00Z`) : null,
              deliveryAddress: address,
              notes: b.notes ?? null,
              createdBy: auth.userId,
            },
          });
        const total = await writeLines(tx, auth.tenantId, b.id, b.lines);
        const po = await tx.purchaseOrder.update({
          where: { id: b.id },
          data: {
            totalNet: total,
            supplierId: b.supplierId,
            expectedOn: b.expectedOn ? new Date(`${b.expectedOn}T00:00:00Z`) : null,
            deliveryAddress: address,
            notes: b.notes ?? null,
          },
          include: PO_INCLUDE,
        });
        if (!existing)
          await audit('purchase_order.created', 'purchase_order', po.id, { total: total.toString() });
        return poDto(tx, po, 0n);
      }),
  );

  app.delete(
    '/purchase-orders/:id',
    {
      schema: {
        tags: ['achats'],
        summary: 'Supprimer un brouillon, ou annuler un bon envoyé',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.write', async ({ tx, auth, actor, audit }) => {
        const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id } });
        if (!po) return { ok: true as const };
        if (po.status === 'draft') {
          await tx.purchaseOrder.delete({ where: { id: po.id } });
          return { ok: true as const };
        }
        if ((await invoicedByOrder(tx, [po.id])).get(po.id))
          throw conflict(
            'purchase_order_invoiced',
            'Ce bon de commande est déjà facturé : il ne s’annule plus.',
          );
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: 'cancelled' } });
        await audit('purchase_order.cancelled', 'purchase_order', po.id, { number: po.number });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'project',
          aggregateId: po.projectId,
          payload: { projectId: po.projectId, fields: ['purchase_orders'] },
          actor,
        });
        return { ok: true as const };
      }),
  );

  app.post(
    '/purchase-orders/:id/send',
    {
      schema: {
        tags: ['achats'],
        summary: 'Envoyer le bon de commande au fournisseur (numéro BC, PDF, e-mail)',
        params: z.object({ id: z.uuid() }),
        body: PurchaseOrderSendSchema,
        response: { 200: PurchaseOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.write', async ({ tx, auth, actor, audit }) => {
        const locked = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM purchase_orders WHERE id = ${req.params.id}::uuid FOR UPDATE`;
        if (!locked[0]) throw notFound('Ce bon de commande');
        const po = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: req.params.id },
          include: { ...PO_INCLUDE, project: { include: { tenant: true } }, supplier: true },
        });
        if (po.status !== 'draft')
          throw conflict('purchase_order_sent', 'Ce bon de commande est déjà envoyé.');
        if (!po.lines.length) throw badRequest('purchase_order_empty', 'Ajoutez au moins une ligne.');
        const email = req.body.email ?? po.supplier.orderEmail ?? po.supplier.email;
        if (!email)
          throw badRequest(
            'supplier_email',
            'Ce fournisseur n’a pas d’adresse de commande : indiquez un e-mail.',
          );
        const now = new Date();
        const year = now.getUTCFullYear();
        const t = po.project.tenant;
        const number = formatDocumentNumber(parseTenantSettings(t.settings).numbering.purchase_order, {
          year,
          sequence: await nextSequenceValue(tx, auth.tenantId, 'purchase_order', year),
        });
        const key = await storeOrderPdf(deps, tx, po.id, { number, date: now });
        const sent = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'sent', number, sentAt: now, sentTo: email, pdfKey: key },
          include: PO_INCLUDE,
        });
        await audit('purchase_order.sent', 'purchase_order', po.id, {
          number,
          email,
          total: po.totalNet.toString(),
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'purchase_order.sent.v1',
          aggregateType: 'project',
          aggregateId: po.projectId,
          payload: { purchaseOrderId: po.id, projectId: po.projectId, email },
          actor,
        });
        return poDto(tx, sent, 0n);
      }),
  );

  app.get(
    '/purchase-orders/:id/pdf',
    {
      schema: {
        tags: ['achats'],
        summary: 'PDF du bon de commande',
        params: z.object({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      // Bon envoyé sans PDF rangé (reprise de l'ancien logiciel, stockage perdu) : on le régénère.
      const po = await inTenant(deps, req, 'purchases.read', async ({ tx }) => {
        const row = await tx.purchaseOrder.findUnique({ where: { id: req.params.id } });
        if (!row?.number) return null;
        if (row.pdfKey) return row;
        const pdfKey = await storeOrderPdf(deps, tx, row.id, {
          number: row.number,
          date: row.sentAt ?? row.createdAt,
        });
        return tx.purchaseOrder.update({ where: { id: row.id }, data: { pdfKey } });
      });
      if (!po?.pdfKey) throw notFound('Ce bon de commande envoyé');
      const body = await deps.integrations.storage.get('uploads', po.pdfKey);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${po.number}.pdf"`)
        .send(Buffer.from(body));
    },
  );

  app.post(
    '/purchase-orders/:id/receipts',
    {
      schema: {
        tags: ['achats'],
        summary: 'Réception partielle ou totale',
        params: z.object({ id: z.uuid() }),
        body: GoodsReceiptInputSchema,
        response: { 200: PurchaseOrderSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.write', async ({ tx, auth, actor }) => {
        const po = await tx.purchaseOrder.findUnique({ where: { id: req.params.id }, include: PO_INCLUDE });
        if (!po) throw notFound('Ce bon de commande');
        if (!['sent', 'partially_received'].includes(po.status))
          throw conflict('purchase_order_not_open', 'Seul un bon de commande envoyé peut être réceptionné.');
        for (const r of req.body.lines) {
          const line = po.lines.find((l) => l.id === r.lineId);
          if (!line) throw notFound('Cette ligne');
          await tx.purchaseOrderLine.update({
            where: { id: line.id },
            data: {
              receivedQuantity: dec(line.receivedQuantity.toString()).plus(dec(r.quantity)).toString(),
            },
          });
        }
        await tx.goodsReceipt.create({
          data: {
            tenantId: auth.tenantId,
            purchaseOrderId: po.id,
            receivedBy: auth.userId,
            note: req.body.note ?? null,
            lines: req.body.lines,
          },
        });
        const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
        const complete = lines.every((l) =>
          dec(l.receivedQuantity.toString()).greaterThanOrEqualTo(dec(l.quantity.toString())),
        );
        const updated = await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: complete ? 'received' : 'partially_received' },
          include: PO_INCLUDE,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'purchase_order.received.v1',
          aggregateType: 'project',
          aggregateId: po.projectId,
          payload: { purchaseOrderId: po.id, projectId: po.projectId, complete },
          actor,
        });
        return poDto(tx, updated);
      }),
  );

  // -------------------------------------------------------------------------
  // Factures fournisseurs
  // -------------------------------------------------------------------------
  app.get(
    '/supplier-invoices',
    {
      schema: {
        tags: ['achats'],
        summary: 'Factures fournisseurs (boîte « À imputer » par défaut)',
        querystring: z.object({
          view: z.enum(['inbox', 'allocated', 'to_pay', 'all']).default('inbox'),
          projectId: z.uuid().optional(),
          supplierId: z.uuid().optional(),
        }),
        response: {
          200: z.object({
            items: z.array(SupplierInvoiceSummarySchema),
            counts: z.object({
              inbox: z.number().int(),
              allocated: z.number().int(),
              to_pay: z.number().int(),
            }),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'supplier_invoices.read', async ({ tx }) => {
        const q = req.query;
        const statuses =
          q.view === 'inbox'
            ? (['received', 'to_allocate'] as const)
            : q.view === 'allocated'
              ? (['allocated', 'validated'] as const)
              : q.view === 'to_pay'
                ? (['to_pay', 'blocked'] as const)
                : null;
        const rows = await tx.supplierInvoice.findMany({
          where: {
            ...(statuses ? { status: { in: [...statuses] } } : {}),
            ...(q.projectId ? { allocations: { some: { projectId: q.projectId } } } : {}),
            ...(q.supplierId ? { supplierId: q.supplierId } : {}),
          },
          include: INVOICE_INCLUDE,
          orderBy: [{ receivedAt: 'desc' }],
          take: 200,
        });
        const items = [];
        for (const r of rows) {
          const { lines: _lines, allocations, ...dto } = await invoiceDto(tx, r);
          items.push({ ...dto, allocatedProjects: [...new Set(allocations.map((a) => a.projectLabel))] });
        }
        const count = async (s: readonly string[]) =>
          tx.supplierInvoice.count({ where: { status: { in: s as never[] } } });
        return {
          items,
          counts: {
            inbox: await count(['received', 'to_allocate']),
            allocated: await count(['allocated', 'validated']),
            to_pay: await count(['to_pay', 'blocked']),
          },
        };
      }),
  );

  app.get(
    '/supplier-invoices/:id',
    {
      schema: {
        tags: ['achats'],
        summary: 'Facture fournisseur',
        params: z.object({ id: z.uuid() }),
        response: { 200: SupplierInvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'supplier_invoices.read', async ({ tx }) => {
        const i = await tx.supplierInvoice.findUnique({
          where: { id: req.params.id },
          include: INVOICE_INCLUDE,
        });
        if (!i) throw notFound('Cette facture');
        return invoiceDto(tx, i);
      }),
  );

  app.get(
    '/supplier-invoices/:id/document',
    {
      schema: {
        tags: ['achats'],
        summary: 'Document original',
        params: z.object({ id: z.uuid() }),
        hide: true,
      },
    },
    async (req, reply) => {
      const i = await inTenant(deps, req, 'supplier_invoices.read', ({ tx }) =>
        tx.supplierInvoice.findUnique({ where: { id: req.params.id } }),
      );
      if (!i?.documentKey) throw notFound('Ce document');
      const body = await deps.integrations.storage.get('legal', i.documentKey);
      return reply
        .header('content-type', i.documentType ?? 'application/octet-stream')
        .header(
          'content-disposition',
          `inline; filename="${(i.number ?? 'facture').replace(/[^\w.-]/g, '_')}"`,
        )
        .send(Buffer.from(body));
    },
  );

  app.post(
    '/supplier-invoices/:id/allocate',
    {
      schema: {
        tags: ['achats'],
        summary: 'Ventiler la facture sur un ou plusieurs chantiers et postes',
        params: z.object({ id: z.uuid() }),
        body: AllocationInputSchema,
        response: { 200: SupplierInvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'supplier_invoices.allocate', async ({ tx, auth, actor, audit }) => {
        const i = await tx.supplierInvoice.findUnique({ where: { id: req.params.id } });
        if (!i) throw notFound('Cette facture');
        if (!['received', 'to_allocate', 'allocated'].includes(i.status))
          throw conflict('supplier_invoice_locked', 'Cette facture est validée : elle ne se ventile plus.');
        const list = req.body.allocations;
        const sum = list.reduce((s, a) => s + BigInt(a.amount), 0n);
        if (sum !== i.totalNet)
          throw badRequest(
            'allocation_total',
            `La ventilation (${(Number(sum) / 100).toFixed(2)} €) doit égaler le total HTVA de la facture (${(Number(i.totalNet) / 100).toFixed(2)} €).`,
          );
        for (const a of list) {
          const p = await tx.project.findUnique({ where: { id: a.projectId }, select: { id: true } });
          if (!p) throw notFound('Ce chantier');
          if (
            a.budgetLineId &&
            !(await tx.budgetLine.findFirst({ where: { id: a.budgetLineId, projectId: a.projectId } }))
          )
            throw badRequest('invalid_budget_line', 'Un poste ne fait pas partie de son chantier.');
        }
        await tx.costAllocation.deleteMany({ where: { invoiceId: i.id } });
        await tx.costAllocation.createMany({
          data: list.map((a) => ({
            tenantId: auth.tenantId,
            invoiceId: i.id,
            projectId: a.projectId,
            budgetLineId: a.budgetLineId,
            amount: BigInt(a.amount),
            createdBy: auth.userId,
          })),
        });
        const projectIds = [...new Set(list.map((a) => a.projectId))];
        await tx.supplierInvoice.update({
          where: { id: i.id },
          data: {
            status: 'allocated',
            matchMethod: i.status === 'allocated' && i.matchMethod ? i.matchMethod : 'manual',
            projectId: projectIds.length === 1 ? projectIds[0] : null,
            allocatedAt: new Date(),
            allocatedBy: auth.userId,
          },
        });
        await audit('supplier_invoice.allocated', 'supplier_invoice', i.id, {
          allocations: list.map((a) => ({ ...a, amount: String(a.amount) })),
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'supplier_invoice.allocated.v1',
          aggregateType: 'supplier_invoice',
          aggregateId: i.id,
          payload: { invoiceId: i.id, projectIds, automatic: false },
          actor,
        });
        return invoiceDto(
          tx,
          await tx.supplierInvoice.findUniqueOrThrow({ where: { id: i.id }, include: INVOICE_INCLUDE }),
        );
      }),
  );

  app.post(
    '/supplier-invoices/:id/status',
    {
      schema: {
        tags: ['achats'],
        summary: 'Valider, mettre à payer, bloquer ou marquer payée',
        params: z.object({ id: z.uuid() }),
        body: z.object({ to: z.enum(['validated', 'to_pay', 'blocked', 'paid', 'allocated']) }),
        response: { 200: SupplierInvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'supplier_invoices.allocate', async ({ tx, auth, actor, audit }) => {
        const i = await tx.supplierInvoice.findUnique({ where: { id: req.params.id } });
        if (!i) throw notFound('Cette facture');
        const to = req.body.to;
        try {
          assertTransition(SupplierInvoiceStatus, i.status, to);
        } catch {
          throw conflict(
            'invalid_transition',
            'Ce changement de statut n’est pas possible pour cette facture.',
          );
        }
        const now = new Date();
        await tx.supplierInvoice.update({
          where: { id: i.id },
          data: {
            status: to,
            ...(to === 'validated' ? { validatedAt: now, validatedBy: auth.userId } : {}),
            ...(to === 'paid' ? { paidAt: now } : {}),
          },
        });
        await audit(`supplier_invoice.${to}`, 'supplier_invoice', i.id, { from: i.status });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'project.updated.v1',
          aggregateType: 'supplier_invoice',
          aggregateId: i.id,
          payload: { projectId: i.projectId ?? i.id, fields: ['supplier_invoices'] },
          actor,
        });
        return invoiceDto(
          tx,
          await tx.supplierInvoice.findUniqueOrThrow({ where: { id: i.id }, include: INVOICE_INCLUDE }),
        );
      }),
  );

  app.post(
    '/supplier-invoices/upload',
    {
      schema: {
        tags: ['achats'],
        summary: 'Déposer une facture reçue hors Peppol (PDF, photo ou XML UBL)',
        querystring: z.object({ id: z.uuid().optional() }),
        response: { 201: SupplierInvoiceSchema },
      },
    },
    async (req, reply) => {
      const body = req.body as Buffer | undefined;
      const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('empty_file', 'Le fichier est vide.');
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'facture'))
        .replace(/[^\w.\-() ]+/g, '_')
        .slice(0, 120);
      const isXml =
        /xml/.test(contentType) ||
        /^\s*<\?xml|^\s*<(Invoice|CreditNote)\b/.test(body.subarray(0, 200).toString());
      let ubl = null;
      if (isXml)
        try {
          ubl = parseUbl(body.toString('utf8'));
        } catch (err) {
          if (err instanceof UblError)
            throw badRequest('invalid_ubl', `Document UBL illisible : ${err.message}`);
          throw err;
        }
      const dto = await inTenant(deps, req, 'supplier_invoices.allocate', async ({ tx, auth, actor }) => {
        const id = req.query.id ?? uuidv7();
        const existing = await tx.supplierInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
        if (existing) return invoiceDto(tx, existing);
        const key = `t/${auth.tenantId}/supplier-invoices/${id}/${fileName}`;
        await deps.integrations.storage.put({
          bucket: 'legal',
          key,
          body,
          contentType: contentType || 'application/octet-stream',
        });
        const invoice = await ingestSupplierInvoice(tx, {
          tenantId: auth.tenantId,
          id,
          source: 'upload',
          externalId: null,
          ubl,
          document: { key, contentType: contentType || 'application/octet-stream' },
          fallbackName: fileName.replace(/\.[a-z0-9]+$/i, ''),
          actor,
        });
        return invoiceDto(
          tx,
          await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: INVOICE_INCLUDE }),
        );
      });
      return reply.status(201).send(dto);
    },
  );

  /** Simulation d'une facture Peppol (fournisseur d'accès « mock ») : même chemin que le webhook. */
  app.post(
    '/integrations/peppol/simulate-inbound',
    {
      schema: {
        tags: ['achats'],
        summary: 'Simuler la réception d’une facture fournisseur par Peppol (mode mock)',
        body: PeppolSimulationSchema,
        response: { 201: SupplierInvoiceSchema },
      },
    },
    async (req, reply) => {
      if (deps.integrations.peppol.provider !== 'mock')
        throw forbidden('La simulation n’existe qu’avec le fournisseur Peppol de démonstration.');
      const dto = await inTenant(deps, req, 'supplier_invoices.allocate', async ({ tx, auth, actor }) => {
        const b = req.body;
        const supplier = await tx.supplier.findUnique({ where: { id: b.supplierId } });
        if (!supplier) throw notFound('Ce fournisseur');
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } });
        const xml = buildSimpleUbl({
          number: b.number,
          issueDate: new Date().toISOString().slice(0, 10),
          dueDate: new Date(Date.now() + supplier.paymentTermsDays * 86_400_000).toISOString().slice(0, 10),
          supplier: {
            name: supplier.name,
            vatNumber:
              supplier.vatNumber ?? `BE${(supplier.enterpriseNumber ?? '0000000000').replace(/\D/g, '')}`,
            enterpriseNumber: supplier.enterpriseNumber ?? '0000000000',
            ...(supplier.street ? { street: supplier.street } : {}),
            ...(supplier.postalCode ? { postalCode: supplier.postalCode } : {}),
            ...(supplier.city ? { city: supplier.city } : {}),
          },
          buyer: {
            name: tenant.legalName ?? tenant.name,
            vatNumber: tenant.vatNumber,
            enterpriseNumber: tenant.enterpriseNumber,
          },
          orderReference: b.orderReference ?? null,
          buyerReference: b.buyerReference ?? null,
          note: b.note ?? null,
          delivery: b.deliveryAddress ?? null,
          lines: b.lines.map((l) => ({
            description: l.description,
            supplierCode: l.supplierCode ?? null,
            quantity: l.quantity,
            unitPrice: BigInt(l.unitPrice),
            vatRate: l.vatRate,
          })),
        });
        const id = uuidv7();
        const key = `t/${auth.tenantId}/supplier-invoices/${id}/peppol.xml`;
        await deps.integrations.storage.put({
          bucket: 'legal',
          key,
          body: Buffer.from(xml),
          contentType: 'application/xml',
        });
        const invoice = await ingestSupplierInvoice(tx, {
          tenantId: auth.tenantId,
          id,
          source: 'peppol',
          externalId: `sim-${id}`,
          ubl: parseUbl(xml),
          document: { key, contentType: 'application/xml' },
          actor,
        });
        return invoiceDto(
          tx,
          await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id }, include: INVOICE_INCLUDE }),
        );
      });
      return reply.status(201).send(dto);
    },
  );
};

/**
 * Webhook du fournisseur d'accès Peppol (public, signé) : facture reçue pour une entité légale →
 * tenant correspondant. Plugin séparé : il lit le corps brut pour vérifier la signature.
 */
export const peppolWebhookRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: 5 * 1024 * 1024 },
    (_r, body, done) => done(null, body),
  );
  app.post(
    '/webhooks/peppol',
    {
      schema: { tags: ['achats'], summary: 'Webhook Peppol (facture reçue, statut)', hide: true },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      let event;
      try {
        event = deps.integrations.peppol.parseWebhook(raw, req.headers as Record<string, string | undefined>);
      } catch {
        return reply
          .status(401)
          .send({ error: { code: 'invalid_signature', message: 'Signature invalide.' } });
      }
      if (event.type !== 'document.received') return reply.status(202).send({ ok: true });
      const data = event.data as { legalEntityId?: string; documentId?: string; ubl?: string };
      if (!data.legalEntityId || !data.documentId || !data.ubl)
        return reply.status(400).send({ error: { code: 'invalid_payload', message: 'Document incomplet.' } });
      const connection = await withSystem(deps.prisma, (tx) =>
        tx.integrationConnection.findFirst({ where: { kind: 'peppol', externalId: data.legalEntityId } }),
      );
      if (!connection)
        return reply.status(404).send({ error: { code: 'unknown_entity', message: 'Entité inconnue.' } });
      let ubl;
      try {
        ubl = parseUbl(data.ubl);
      } catch (err) {
        req.log.warn({ err }, 'document Peppol illisible');
        return reply.status(422).send({ error: { code: 'invalid_ubl', message: 'Document UBL illisible.' } });
      }
      await withTenant(deps.prisma, connection.tenantId, null, async (tx) => {
        const id = uuidv7();
        const key = `t/${connection.tenantId}/supplier-invoices/${id}/peppol.xml`;
        await deps.integrations.storage.put({
          bucket: 'legal',
          key,
          body: Buffer.from(data.ubl!),
          contentType: 'application/xml',
        });
        await ingestSupplierInvoice(tx, {
          tenantId: connection.tenantId,
          id,
          source: 'peppol',
          externalId: data.documentId!,
          ubl,
          document: { key, contentType: 'application/xml' },
          actor: { type: 'system', label: 'Peppol' },
        });
      });
      return reply.status(202).send({ ok: true });
    },
  );
};
