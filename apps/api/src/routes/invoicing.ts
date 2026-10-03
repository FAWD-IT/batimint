/**
 * Facturation et encaissement (03 §10, 02 P7) : factures et notes de crédit (brouillon → émise,
 * immuable), documents PDF + UBL, paiements, liens de paiement, relances, encours ; états
 * d'avancement par chantier (pré-remplis, approuvés par le client ou facturés directement).
 */
import {
  CreditNoteInputSchema,
  InvoiceDraftInputSchema,
  InvoiceListQuerySchema,
  InvoiceListSchema,
  InvoiceSchema,
  OkSchema,
  PaymentInputSchema,
  ProgressStatementInputSchema,
  ProgressStatementSchema,
  ReceivablesSchema,
} from '@batimint/contracts';
import {
  createProgressInvoiceDraft,
  emitEvent,
  projectPostContext,
  type Tx,
  withSystem,
  withTenant,
} from '@batimint/db';
import {
  computeDocumentTotals,
  creditNoteLines,
  dec,
  type DraftInvoiceLine,
  InvoicingError,
  progressFromInput,
  suggestProgressPercent,
  summarizeStatement,
  type VatRegime,
} from '@batimint/domain';
import type { MockPaymentLinkProvider } from '@batimint/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { inTenant } from '../lib/tenant';
import {
  approvalRequired,
  balanceOf,
  INVOICE_INCLUDE,
  invoiceDocuments,
  invoiceDto,
  issueInvoice,
  OPEN_STATUSES,
  recordPayment,
  removePayment,
  statementDto,
  summaryDto,
  today,
} from '../services/invoicing';

async function loadInvoice(tx: Tx, id: string) {
  const i = await tx.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!i) throw notFound('Cette facture');
  return i;
}

async function writeDraftLines(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
  lines: z.infer<typeof InvoiceDraftInputSchema>['lines'],
) {
  await tx.invoiceLine.deleteMany({ where: { invoiceId } });
  await tx.invoiceLine.createMany({
    data: lines.map((l, position) => ({
      tenantId,
      invoiceId,
      position,
      kind: l.kind ?? 'item',
      description: l.description,
      unit: l.unit,
      // Une déduction se saisit en montant positif : la quantité −1 porte le signe (BR-27).
      quantity: l.kind === 'deduction' ? `-${dec(l.quantity).abs().toString()}` : l.quantity,
      unitPrice: BigInt(l.unitPrice),
      vatRegime: l.vatRegime,
      budgetLineId: l.budgetLineId ?? null,
    })),
  });
  return computeDocumentTotals(
    lines.map((l) => ({
      quantity: l.kind === 'deduction' ? `-${dec(l.quantity).abs().toString()}` : l.quantity,
      unitPrice: BigInt(l.unitPrice),
      vatRegime: l.vatRegime as VatRegime,
    })),
  );
}

async function taskPercents(tx: Tx, projectId: string): Promise<Map<string, string>> {
  const posts = await projectPostContext(tx, projectId);
  return new Map(
    posts.map((p) => [p.budgetLineId, dec(p.taskProgress).times(100).toDecimalPlaces(1).toString()]),
  );
}

export const invoicingRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  // -------------------------------------------------------------------------
  // Factures
  // -------------------------------------------------------------------------
  app.get(
    '/invoices',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Factures et notes de crédit (brouillons, à encaisser, en retard, payées)',
        querystring: InvoiceListQuerySchema,
        response: { 200: InvoiceListSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.read', async ({ tx }) => {
        const q = req.query;
        const day = today();
        const dayDate = new Date(`${day}T00:00:00Z`);
        const scope = {
          ...(q.projectId ? { projectId: q.projectId } : {}),
          ...(q.customerId ? { customerId: q.customerId } : {}),
        };
        const statusFilter =
          q.view === 'draft'
            ? { status: 'draft' as const }
            : q.view === 'open'
              ? { status: { in: [...OPEN_STATUSES] }, type: { not: 'credit_note' as const } }
              : q.view === 'overdue'
                ? {
                    status: { in: [...OPEN_STATUSES] },
                    type: { not: 'credit_note' as const },
                    dueDate: { lt: dayDate },
                  }
                : q.view === 'paid'
                  ? { status: { in: ['paid' as const, 'cancelled' as const] } }
                  : {};
        const rows = await tx.invoice.findMany({
          where: {
            ...scope,
            ...statusFilter,
            ...(q.q
              ? {
                  OR: [
                    { number: { contains: q.q, mode: 'insensitive' as const } },
                    { title: { contains: q.q, mode: 'insensitive' as const } },
                    { customer: { displayName: { contains: q.q, mode: 'insensitive' as const } } },
                  ],
                }
              : {}),
          },
          include: INVOICE_INCLUDE,
          orderBy: [{ issueDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
          take: 300,
        });
        const open = await tx.invoice.findMany({
          where: { ...scope, status: { in: [...OPEN_STATUSES] }, type: { not: 'credit_note' } },
          select: {
            type: true,
            status: true,
            totalGross: true,
            retentionAmount: true,
            retentionReleasedAt: true,
            amountPaid: true,
            amountCredited: true,
            dueDate: true,
          },
        });
        const receivable = open.reduce((s, i) => s + balanceOf(i), 0n);
        const overdue = open.filter((i) => i.dueDate && i.dueDate < dayDate && balanceOf(i) > 0n);
        return {
          items: rows.map((r) => summaryDto(r, day)),
          counts: {
            draft: await tx.invoice.count({ where: { ...scope, status: 'draft' } }),
            open: open.filter((i) => balanceOf(i) > 0n).length,
            overdue: overdue.length,
          },
          receivable: Number(receivable),
          overdueAmount: Number(overdue.reduce((s, i) => s + balanceOf(i), 0n)),
        };
      }),
  );

  app.get(
    '/invoices/:id',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Facture ou note de crédit',
        params: z.object({ id: z.uuid() }),
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.read', async ({ tx }) =>
        invoiceDto(tx, await loadInvoice(tx, req.params.id)),
      ),
  );

  app.put(
    '/invoices/:id',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Créer ou modifier un brouillon de facture (identifiant client, idempotent)',
        params: z.object({ id: z.uuid() }),
        body: InvoiceDraftInputSchema,
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        if (b.id !== req.params.id) throw badRequest('id_mismatch', 'Identifiant incohérent.');
        const existing = await tx.invoice.findUnique({ where: { id: b.id } });
        if (existing && existing.status !== 'draft')
          throw conflict('invoice_issued', 'Cette facture est émise : corrigez-la par une note de crédit.');
        if (existing?.type === 'credit_note' || existing?.type === 'progress')
          throw conflict(
            'invoice_generated',
            'Ce brouillon est généré (état d’avancement ou note de crédit) : modifiez sa source.',
          );
        if (!(await tx.customer.findUnique({ where: { id: b.customerId } }))) throw notFound('Ce client');
        const project = b.projectId ? await tx.project.findUnique({ where: { id: b.projectId } }) : null;
        if (b.projectId && !project) throw notFound('Ce chantier');
        const settings = await tx.tenant.findUniqueOrThrow({
          where: { id: auth.tenantId },
          select: { settings: true },
        });
        const terms =
          b.paymentTermsDays ?? (settings.settings as { paymentTermsDays?: number }).paymentTermsDays ?? 30;
        const data = {
          type: b.type,
          customerId: b.customerId,
          projectId: b.projectId ?? null,
          title: b.title,
          intro: b.intro ?? null,
          notes: b.notes ?? null,
          paymentTermsDays: terms,
          servicePeriodStart: b.servicePeriodStart ? new Date(`${b.servicePeriodStart}T00:00:00Z`) : null,
          servicePeriodEnd: b.servicePeriodEnd ? new Date(`${b.servicePeriodEnd}T00:00:00Z`) : null,
          retentionPercent: b.type === 'final' && project ? project.retentionPercent : 0,
        };
        if (!existing)
          await tx.invoice.create({
            data: { id: b.id, tenantId: auth.tenantId, ...data, createdBy: auth.userId },
          });
        else await tx.invoice.update({ where: { id: b.id }, data });
        const totals = await writeDraftLines(tx, auth.tenantId, b.id, b.lines);
        await tx.invoice.update({
          where: { id: b.id },
          data: { totalNet: totals.totalNet, totalVat: totals.totalVat, totalGross: totals.totalGross },
        });
        if (!existing) await audit('invoice.draft_created', 'invoice', b.id, { type: b.type });
        return invoiceDto(tx, await loadInvoice(tx, b.id));
      }),
  );

  app.delete(
    '/invoices/:id',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Supprimer un brouillon (une facture émise ne se supprime jamais)',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, audit }) => {
        const i = await tx.invoice.findUnique({ where: { id: req.params.id } });
        if (!i) return { ok: true as const };
        if (i.status !== 'draft')
          throw conflict(
            'invoice_issued',
            'Une facture émise ne se supprime pas : faites une note de crédit.',
          );
        if (i.progressStatementId)
          await tx.progressStatement.update({
            where: { id: i.progressStatementId },
            data: { status: 'approved' },
          });
        await tx.invoice.delete({ where: { id: i.id } });
        await audit('invoice.draft_deleted', 'invoice', i.id, { title: i.title });
        return { ok: true as const };
      }),
  );

  app.post(
    '/invoices/:id/issue',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Émettre : numéro définitif, documents figés, envoi Peppol ou e-mail',
        params: z.object({ id: z.uuid() }),
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      // Les émissions se suivent sur le verrou de la séquence : une rafale attend son tour.
      inTenant(
        deps,
        req,
        'invoices.issue',
        async ({ tx, auth, actor, audit }) => {
          const before = await tx.invoice.findUnique({ where: { id: req.params.id } });
          if (before && before.status !== 'draft')
            return invoiceDto(tx, await loadInvoice(tx, req.params.id));
          await issueInvoice(tx, deps.integrations, {
            tenantId: auth.tenantId,
            invoiceId: req.params.id,
            userId: auth.userId,
            actor,
          });
          const i = await loadInvoice(tx, req.params.id);
          await audit('invoice.issued', 'invoice', i.id, {
            number: i.number,
            totalGross: i.totalGross.toString(),
            type: i.type,
          });
          return invoiceDto(tx, i);
        },
        { maxWaitMs: 60_000, timeoutMs: 60_000 },
      ),
  );

  for (const kind of ['pdf', 'ubl'] as const)
    app.get(
      `/invoices/:id/${kind}`,
      {
        schema: {
          tags: ['facturation'],
          summary: kind === 'pdf' ? 'PDF de la facture émise' : 'UBL Peppol BIS 3 de la facture émise',
          params: z.object({ id: z.uuid() }),
          hide: true,
        },
      },
      async (req, reply) => {
        const doc = await inTenant(deps, req, 'invoices.read', async ({ tx }) => {
          const i = await tx.invoice.findUnique({ where: { id: req.params.id } });
          if (!i || i.status === 'draft') throw notFound('Cette facture émise');
          const key = kind === 'pdf' ? i.pdfKey : i.ublKey;
          if (key)
            return {
              number: i.number!,
              body: Buffer.from(await deps.integrations.storage.get('legal', key)),
            };
          // Reprise de données sans document rangé : régénéré à l'identique depuis les données figées.
          const docs = await invoiceDocuments(tx, deps.integrations, i.id);
          return { number: i.number!, body: kind === 'pdf' ? docs.pdf : Buffer.from(docs.ubl) };
        });
        return reply
          .header('content-type', kind === 'pdf' ? 'application/pdf' : 'application/xml')
          .header(
            'content-disposition',
            `${kind === 'pdf' ? 'inline' : 'attachment'}; filename="${doc.number.replace(/[^\w.-]/g, '_')}.${kind === 'pdf' ? 'pdf' : 'xml'}"`,
          )
          .send(doc.body);
      },
    );

  app.post(
    '/invoices/:id/credit-note',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Préparer une note de crédit (totale ou partielle) liée à la facture',
        params: z.object({ id: z.uuid() }),
        body: CreditNoteInputSchema,
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        const existing = await tx.invoice.findUnique({ where: { id: b.id } });
        if (existing) return invoiceDto(tx, await loadInvoice(tx, b.id));
        const o = await tx.invoice.findUnique({
          where: { id: req.params.id },
          include: { lines: { orderBy: { position: 'asc' } } },
        });
        if (!o) throw notFound('Cette facture');
        if (o.type === 'credit_note' || o.status === 'draft' || o.status === 'cancelled')
          throw conflict('not_creditable', 'Seule une facture émise et non annulée se crédite.');
        const credited = await tx.invoice.aggregate({
          where: { creditedInvoiceId: o.id, status: { not: 'draft' } },
          _sum: { totalNet: true },
        });
        let lines: DraftInvoiceLine[];
        try {
          lines = creditNoteLines({
            original: o.lines.map((l) => ({
              kind: l.kind === 'deduction' ? 'deduction' : 'item',
              description: l.description,
              unit: l.unit,
              quantity: l.quantity.toString(),
              unitPrice: l.unitPrice,
              vatRegime: l.vatRegime as VatRegime,
              budgetLineId: l.budgetLineId,
            })),
            originalNet: o.totalNet,
            alreadyCredited: credited._sum.totalNet ?? 0n,
            ...(b.lines
              ? { partial: b.lines.map((l) => ({ index: l.index, amount: BigInt(l.amount) })) }
              : {}),
            reason: b.reason,
          });
        } catch (err) {
          if (err instanceof InvoicingError) throw badRequest(err.code, err.message);
          throw err;
        }
        const totals = computeDocumentTotals(lines);
        await tx.invoice.create({
          data: {
            id: b.id,
            tenantId: auth.tenantId,
            type: 'credit_note',
            status: 'draft',
            customerId: o.customerId,
            projectId: o.projectId,
            creditedInvoiceId: o.id,
            title: `Note de crédit sur la facture ${o.number} — ${b.reason}`,
            paymentTermsDays: 0,
            totalNet: totals.totalNet,
            totalVat: totals.totalVat,
            totalGross: totals.totalGross,
            createdBy: auth.userId,
            lines: {
              create: lines.map((l, position) => ({
                tenantId: auth.tenantId,
                position,
                kind: l.kind,
                description: l.description,
                unit: l.unit,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                vatRegime: l.vatRegime,
                budgetLineId: l.budgetLineId,
              })),
            },
          },
        });
        await audit('credit_note.draft_created', 'invoice', b.id, { original: o.number, reason: b.reason });
        return invoiceDto(tx, await loadInvoice(tx, b.id));
      }),
  );

  // -------------------------------------------------------------------------
  // Paiements, lien de paiement, relances
  // -------------------------------------------------------------------------
  app.post(
    '/invoices/:id/payments',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Enregistrer un paiement (partiel ou total)',
        params: z.object({ id: z.uuid() }),
        body: PaymentInputSchema,
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'payments.write', async ({ tx, auth, actor, audit }) => {
        const b = req.body;
        const { created } = await recordPayment(tx, {
          tenantId: auth.tenantId,
          invoiceId: req.params.id,
          id: b.id,
          amount: BigInt(b.amount),
          receivedOn: b.receivedOn,
          method: b.method,
          source: 'manual',
          reference: b.reference ?? null,
          userId: auth.userId,
          actor,
        });
        if (created)
          await audit('payment.recorded', 'invoice', req.params.id, {
            paymentId: b.id,
            amount: String(b.amount),
          });
        return invoiceDto(tx, await loadInvoice(tx, req.params.id));
      }),
  );

  app.delete(
    '/invoices/:id/payments/:paymentId',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Annuler un paiement saisi par erreur',
        params: z.object({ id: z.uuid(), paymentId: z.uuid() }),
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'payments.write', async ({ tx, audit }) => {
        await removePayment(tx, req.params.id, req.params.paymentId);
        await audit('payment.removed', 'invoice', req.params.id, { paymentId: req.params.paymentId });
        return invoiceDto(tx, await loadInvoice(tx, req.params.id));
      }),
  );

  app.post(
    '/invoices/:id/payment-link',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Créer un lien de paiement en ligne pour le solde (Bancontact, carte)',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ url: z.string(), amount: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'payments.write', async ({ tx, auth }) =>
        createPaymentLink(tx, deps, auth.tenantId, req.params.id),
      ),
  );

  app.post(
    '/invoices/:id/reminders',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Suspendre ou reprendre les relances automatiques',
        params: z.object({ id: z.uuid() }),
        body: z.object({ paused: z.boolean() }),
        response: { 200: InvoiceSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, audit }) => {
        const i = await loadInvoice(tx, req.params.id);
        await tx.invoice.update({ where: { id: i.id }, data: { remindersPaused: req.body.paused } });
        await audit(
          req.body.paused ? 'invoice.reminders_paused' : 'invoice.reminders_resumed',
          'invoice',
          i.id,
        );
        return invoiceDto(tx, await loadInvoice(tx, i.id));
      }),
  );

  app.get(
    '/receivables',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Encours clients et balance âgée',
        response: { 200: ReceivablesSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.read', async ({ tx }) => {
        const day = today();
        const rows = await tx.invoice.findMany({
          where: { status: { in: [...OPEN_STATUSES] }, type: { not: 'credit_note' } },
          include: { customer: { select: { id: true, displayName: true } } },
        });
        const buckets = { notDue: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, over90: 0n };
        const byCustomer = new Map<
          string,
          {
            customer: { id: string; displayName: string };
            total: bigint;
            overdue: bigint;
            oldest: number;
            n: number;
          }
        >();
        for (const r of rows) {
          const bal = balanceOf(r);
          if (bal <= 0n) continue;
          const due = r.dueDate ? r.dueDate.toISOString().slice(0, 10) : day;
          const late = Math.max(
            0,
            Math.floor((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000),
          );
          const k =
            late === 0
              ? 'notDue'
              : late <= 30
                ? 'd1_30'
                : late <= 60
                  ? 'd31_60'
                  : late <= 90
                    ? 'd61_90'
                    : 'over90';
          buckets[k] += bal;
          const c = byCustomer.get(r.customerId) ?? {
            customer: r.customer,
            total: 0n,
            overdue: 0n,
            oldest: 0,
            n: 0,
          };
          c.total += bal;
          if (late > 0) c.overdue += bal;
          c.oldest = Math.max(c.oldest, late);
          c.n++;
          byCustomer.set(r.customerId, c);
        }
        return {
          total: Number(Object.values(buckets).reduce((s, v) => s + v, 0n)),
          buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Number(v)])) as Record<
            keyof typeof buckets,
            number
          >,
          customers: [...byCustomer.values()]
            .sort((a, b) =>
              b.overdue === a.overdue ? Number(b.total - a.total) : Number(b.overdue - a.overdue),
            )
            .map((c) => ({
              customer: c.customer,
              total: Number(c.total),
              overdue: Number(c.overdue),
              oldestDaysLate: c.oldest,
              invoices: c.n,
            })),
        };
      }),
  );

  // -------------------------------------------------------------------------
  // États d'avancement (P7)
  // -------------------------------------------------------------------------
  app.get(
    '/projects/:id/progress-statements',
    {
      schema: {
        tags: ['facturation'],
        summary: 'États d’avancement du chantier',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ items: z.array(ProgressStatementSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.read', async ({ tx }) => {
        const project = await tx.project.findUnique({
          where: { id: req.params.id },
          include: { customer: true, tenant: true },
        });
        if (!project) throw notFound('Ce chantier');
        const rows = await tx.progressStatement.findMany({
          where: { projectId: project.id },
          include: { lines: true },
          orderBy: { ordinal: 'desc' },
        });
        const ctx = {
          approvalRequired: approvalRequired(project.customer.kind, project.tenant.settings),
          taskPercent: await taskPercents(tx, project.id),
        };
        const items = [];
        for (const r of rows) items.push(await statementDto(tx, r, ctx));
        return { items };
      }),
  );

  app.get(
    '/projects/:id/progress-statements/prefill',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Nouvel état pré-rempli (tâches cochées, jamais sous le déjà facturé)',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProgressStatementSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx }) => {
        const project = await tx.project.findUnique({
          where: { id: req.params.id },
          include: { customer: true, tenant: true },
        });
        if (!project) throw notFound('Ce chantier');
        const posts = await projectPostContext(tx, project.id);
        const last = await tx.progressStatement.findFirst({
          where: { projectId: project.id },
          orderBy: { ordinal: 'desc' },
        });
        const lines = posts.map((p) => {
          const pct = suggestProgressPercent({ ...p, taskProgress: p.taskProgress });
          const v = progressFromInput(p, 'percent', pct);
          return { p, v };
        });
        const summary = summarizeStatement(
          lines.map(({ p, v }) => ({
            contractAmount: p.contractAmount,
            previousAmount: p.previousAmount,
            cumulativeAmount: v.cumulativeAmount,
          })),
        );
        const pct = (a: bigint, c: bigint) =>
          c === 0n ? '0' : dec(a.toString()).dividedBy(c.toString()).times(100).toDecimalPlaces(2).toString();
        return {
          id: '00000000-0000-7000-8000-000000000000',
          projectId: project.id,
          ordinal: (last?.ordinal ?? 0) + 1,
          status: 'draft' as const,
          periodEnd: today(),
          note: null,
          contractAmount: Number(summary.contractAmount),
          previousAmount: Number(summary.previousAmount),
          cumulativeAmount: Number(summary.cumulativeAmount),
          periodAmount: Number(summary.periodAmount),
          cumulativePercent: pct(summary.cumulativeAmount, summary.contractAmount),
          submittedAt: null,
          approvedAt: null,
          approvedByName: null,
          disputeReason: null,
          invoice: null,
          approvalRequired: approvalRequired(project.customer.kind, project.tenant.settings),
          lines: lines.map(({ p, v }) => ({
            budgetLineId: p.budgetLineId,
            label: p.label,
            contractAmount: Number(p.contractAmount),
            previousAmount: Number(p.previousAmount),
            previousPercent: pct(p.previousAmount, p.contractAmount),
            cumulativeAmount: Number(v.cumulativeAmount),
            cumulativePercent: v.cumulativeRatio.times(100).toDecimalPlaces(2).toString(),
            periodAmount: Number(v.periodAmount),
            unit: p.unit,
            totalQuantity: p.totalQuantity,
            cumulativeQuantity: v.cumulativeQuantity?.toDecimalPlaces(4).toString() ?? null,
            taskPercent: dec(p.taskProgress).times(100).toDecimalPlaces(1).toString(),
          })),
        };
      }),
  );

  app.put(
    '/projects/:id/progress-statements/:statementId',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Créer ou modifier un état d’avancement brouillon (en %, en quantité ou en €)',
        params: z.object({ id: z.uuid(), statementId: z.uuid() }),
        body: ProgressStatementInputSchema,
        response: { 200: ProgressStatementSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        const project = await tx.project.findUnique({
          where: { id: req.params.id },
          include: { customer: true, tenant: true },
        });
        if (!project) throw notFound('Ce chantier');
        const existing = await tx.progressStatement.findUnique({ where: { id: req.params.statementId } });
        if (existing && existing.projectId !== project.id) throw notFound('Cet état d’avancement');
        if (existing && existing.status !== 'draft' && existing.status !== 'disputed')
          throw conflict('statement_locked', 'Cet état est soumis ou approuvé : il ne se modifie plus.');
        const pending = await tx.progressStatement.findFirst({
          where: {
            projectId: project.id,
            status: { in: ['draft', 'submitted', 'disputed'] },
            id: { not: req.params.statementId },
          },
        });
        if (pending)
          throw conflict(
            'statement_pending',
            `L’état n°${pending.ordinal} n’est pas encore approuvé : terminez-le avant d’en commencer un autre.`,
          );
        const posts = await projectPostContext(tx, project.id);
        const input = new Map(b.lines.map((l) => [l.budgetLineId, l]));
        const lines = posts.map((p) => {
          const l = input.get(p.budgetLineId);
          try {
            const v = l
              ? progressFromInput(p, l.mode, l.value)
              : progressFromInput(p, 'amount', p.previousAmount.toString());
            return { p, v };
          } catch (err) {
            if (err instanceof InvoicingError) throw badRequest(err.code, `${p.label} : ${err.message}`);
            throw err;
          }
        });
        const summary = summarizeStatement(
          lines.map(({ p, v }) => ({
            contractAmount: p.contractAmount,
            previousAmount: p.previousAmount,
            cumulativeAmount: v.cumulativeAmount,
          })),
        );
        const last = await tx.progressStatement.findFirst({
          where: { projectId: project.id },
          orderBy: { ordinal: 'desc' },
        });
        const data = {
          periodEnd: new Date(`${b.periodEnd}T00:00:00Z`),
          note: b.note ?? null,
          contractAmount: summary.contractAmount,
          previousAmount: summary.previousAmount,
          cumulativeAmount: summary.cumulativeAmount,
          status: 'draft' as const,
          disputeReason: null,
          disputedAt: null,
        };
        if (existing) await tx.progressStatement.update({ where: { id: existing.id }, data });
        else
          await tx.progressStatement.create({
            data: {
              id: req.params.statementId,
              tenantId: auth.tenantId,
              projectId: project.id,
              ordinal: (last?.ordinal ?? 0) + 1,
              createdBy: auth.userId,
              ...data,
            },
          });
        await tx.progressStatementLine.deleteMany({ where: { statementId: req.params.statementId } });
        await tx.progressStatementLine.createMany({
          data: lines.map(({ p, v }, position) => ({
            tenantId: auth.tenantId,
            statementId: req.params.statementId,
            budgetLineId: p.budgetLineId,
            position,
            label: p.label,
            contractAmount: p.contractAmount,
            previousAmount: p.previousAmount,
            cumulativeAmount: v.cumulativeAmount,
            cumulativePercent: v.cumulativeRatio.times(100).toDecimalPlaces(4).toString(),
            unit: p.unit,
            totalQuantity: p.totalQuantity,
            cumulativeQuantity: v.cumulativeQuantity?.toDecimalPlaces(4).toString() ?? null,
          })),
        });
        if (!existing)
          await audit('progress_statement.created', 'progress_statement', req.params.statementId);
        const st = await tx.progressStatement.findUniqueOrThrow({
          where: { id: req.params.statementId },
          include: { lines: true },
        });
        return statementDto(tx, st, {
          approvalRequired: approvalRequired(project.customer.kind, project.tenant.settings),
          taskPercent: new Map(
            posts.map((p) => [p.budgetLineId, dec(p.taskProgress).times(100).toDecimalPlaces(1).toString()]),
          ),
        });
      }),
  );

  app.post(
    '/progress-statements/:id/submit',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Envoyer au client pour approbation (B2C) ou facturer directement (B2B selon paramètres)',
        params: z.object({ id: z.uuid() }),
        response: { 200: ProgressStatementSchema.extend({ invoiceId: z.uuid().nullable() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx, auth, actor, audit }) => {
        const st = await tx.progressStatement.findUnique({
          where: { id: req.params.id },
          include: { lines: true, project: { include: { customer: true, tenant: true } } },
        });
        if (!st) throw notFound('Cet état d’avancement');
        const required = approvalRequired(st.project.customer.kind, st.project.tenant.settings);
        if (st.status === 'draft' || st.status === 'disputed') {
          if (st.cumulativeAmount <= st.previousAmount)
            throw badRequest(
              'statement_empty',
              'Rien à facturer sur cette période : faites avancer au moins un poste.',
            );
          const now = new Date();
          if (required) {
            await tx.progressStatement.update({
              where: { id: st.id },
              data: { status: 'submitted', submittedAt: now },
            });
            await emitEvent(tx, {
              tenantId: auth.tenantId,
              type: 'progress_statement.submitted.v1',
              aggregateType: 'project',
              aggregateId: st.projectId,
              payload: { statementId: st.id, projectId: st.projectId },
              actor,
            });
          } else {
            await tx.progressStatement.update({
              where: { id: st.id },
              data: { status: 'approved', submittedAt: now, approvedAt: now },
            });
            await createProgressInvoiceDraft(tx, st.id, auth.userId);
            await emitEvent(tx, {
              tenantId: auth.tenantId,
              type: 'progress_statement.approved.v1',
              aggregateType: 'project',
              aggregateId: st.projectId,
              payload: { statementId: st.id, projectId: st.projectId, byClient: false },
              actor,
            });
          }
          await audit(
            required ? 'progress_statement.submitted' : 'progress_statement.approved',
            'progress_statement',
            st.id,
            {
              ordinal: st.ordinal,
              cumulative: st.cumulativeAmount.toString(),
            },
          );
        }
        const fresh = await tx.progressStatement.findUniqueOrThrow({
          where: { id: st.id },
          include: { lines: true },
        });
        const dto = await statementDto(tx, fresh, {
          approvalRequired: required,
          taskPercent: await taskPercents(tx, st.projectId),
        });
        return { ...dto, invoiceId: dto.invoice?.id ?? null };
      }),
  );

  app.delete(
    '/progress-statements/:id',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Supprimer un état brouillon',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'invoices.write', async ({ tx }) => {
        const st = await tx.progressStatement.findUnique({ where: { id: req.params.id } });
        if (!st) return { ok: true as const };
        if (st.status !== 'draft' && st.status !== 'disputed')
          throw conflict('statement_locked', 'Un état soumis ou approuvé ne se supprime pas.');
        await tx.progressStatement.delete({ where: { id: st.id } });
        return { ok: true as const };
      }),
  );
};

/** Lien de paiement Mollie (ou simulé) pour le solde ; réutilise un lien ouvert du même montant. */
export async function createPaymentLink(
  tx: Tx,
  deps: AppDeps,
  tenantId: string,
  invoiceId: string,
  portalReturnUrl?: string,
): Promise<{ url: string; amount: number }> {
  const i = await tx.invoice.findUnique({ where: { id: invoiceId } });
  if (!i) throw notFound('Cette facture');
  const balance = balanceOf(i);
  if (balance <= 0n) throw conflict('nothing_due', 'Cette facture est soldée.');
  const open = await tx.paymentLink.findFirst({ where: { invoiceId, status: 'open', amount: balance } });
  if (open) return { url: open.url, amount: Number(open.amount) };
  const appUrl = deps.config.APP_URL.replace(/\/$/, '');
  const link = await deps.integrations.payments.createLink({
    tenantId,
    invoiceId,
    amount: balance,
    description: `Facture ${i.number}`,
    redirectUrl: portalReturnUrl ?? `${appUrl}/facturation/${invoiceId}`,
    webhookUrl: `${appUrl}/api/v1/webhooks/payments`,
  });
  await tx.paymentLink.create({
    data: {
      tenantId,
      invoiceId,
      provider: deps.integrations.payments.provider,
      externalId: link.id,
      url: link.url,
      amount: balance,
      status: 'open',
      expiresAt: link.expiresAt,
    },
  });
  return { url: link.url, amount: Number(balance) };
}

/** Paiement confirmé par le prestataire : lien soldé, paiement enregistré (idempotent par id Mollie). */
async function settlePaymentLink(deps: AppDeps, externalId: string): Promise<{ redirectUrl: string } | null> {
  const link = await withSystem(deps.prisma, (tx) => tx.paymentLink.findFirst({ where: { externalId } }));
  if (!link) return null;
  const status = await deps.integrations.payments.getStatus(externalId);
  await withTenant(deps.prisma, link.tenantId, null, async (tx) => {
    if (status.status !== 'paid') {
      if (status.status !== 'open')
        await tx.paymentLink.update({ where: { id: link.id }, data: { status: status.status } });
      return;
    }
    await tx.paymentLink.update({
      where: { id: link.id },
      data: { status: 'paid', paidAt: status.paidAt ?? new Date() },
    });
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: link.invoiceId } });
    const amount = status.amount > 0n ? status.amount : link.amount;
    if (balanceOf(invoice) < amount) return; // déjà réglée autrement : remboursement à traiter à la main
    await recordPayment(tx, {
      tenantId: link.tenantId,
      invoiceId: link.invoiceId,
      id: uuidv7(),
      amount,
      receivedOn: today(),
      method:
        status.method === 'creditcard' ? 'card' : status.method === 'bancontact' ? 'bancontact' : 'online',
      source: 'payment_link',
      reference: externalId,
      externalId,
      userId: null,
      actor: { type: 'system', label: 'Paiement en ligne' },
    });
  });
  return { redirectUrl: `${deps.config.APP_URL.replace(/\/$/, '')}` };
}

/**
 * Routes publiques des paiements en ligne : webhook du prestataire (Mollie : « id=tr_… » en
 * x-www-form-urlencoded) et page de paiement simulée en mode mock.
 */
export const paymentWebhookRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 16 * 1024 },
    (_r, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );

  app.post(
    '/webhooks/payments',
    {
      schema: { tags: ['facturation'], summary: 'Webhook du prestataire de paiement', hide: true },
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const id = (req.body as { id?: string } | undefined)?.id;
      if (!id || !/^[\w-]{4,64}$/.test(id))
        return reply
          .status(400)
          .send({ error: { code: 'invalid_payload', message: 'Identifiant manquant.' } });
      // Le statut est relu chez le prestataire : le corps du webhook n'est jamais cru tel quel.
      await settlePaymentLink(deps, id);
      return reply.status(200).send({ ok: true });
    },
  );

  const mockOnly = () => {
    if (deps.integrations.payments.provider !== 'mock') throw notFound('Cette page de paiement');
  };

  app.get(
    '/payments/checkout/:id',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Page de paiement simulée (mode mock)',
        params: z.object({ id: z.string().regex(/^tr_[\w]+$/) }),
        response: {
          200: z.object({
            company: z.string(),
            invoiceNumber: z.string().nullable(),
            amount: z.number().int(),
            status: z.string(),
          }),
        },
      },
    },
    async (req) => {
      mockOnly();
      const link = await withSystem(deps.prisma, (tx) =>
        tx.paymentLink.findFirst({
          where: { externalId: req.params.id },
          include: { invoice: { select: { number: true } }, tenant: { select: { name: true } } },
        }),
      );
      if (!link) throw notFound('Ce lien de paiement');
      return {
        company: link.tenant.name,
        invoiceNumber: link.invoice.number,
        amount: Number(link.amount),
        status: link.status,
      };
    },
  );

  app.post(
    '/payments/checkout/:id/complete',
    {
      schema: {
        tags: ['facturation'],
        summary: 'Simuler le paiement (mode mock) : même chemin que le webhook',
        params: z.object({ id: z.string().regex(/^tr_[\w]+$/) }),
        response: { 200: OkSchema },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req) => {
      mockOnly();
      const link = await withSystem(deps.prisma, (tx) =>
        tx.paymentLink.findFirst({ where: { externalId: req.params.id } }),
      );
      if (!link) throw notFound('Ce lien de paiement');
      (deps.integrations.payments as MockPaymentLinkProvider).markPaid(req.params.id, link.amount);
      await settlePaymentLink(deps, req.params.id);
      return { ok: true as const };
    },
  );
};
