/**
 * Sous-traitance (03 §9, 05 §7, 02 P9) — effets idempotents :
 *  - contrat conclu ou modifié : engagé du poste (contrat − déjà facturé), fil du chantier ;
 *  - facture d'un sous-traitant : imputée au poste du contrat, consultation 30bis à la réception ;
 *  - dette au moment du paiement : alerte au bureau, fil ; retenue appliquée : fil ;
 *  - invitation au portail : lien et e-mail vouvoyé ; documents déposés ou expirés : alertes.
 */
import { parseEventPayload, parseTenantSettings, projectChannel, tenantChannel } from '@batimint/contracts';
import {
  createPortalToken,
  emitEvent,
  recordThirtyBisCheck,
  subcontractorPortalUrl,
  subcontractTotals,
  type ThirtyBisPorts,
  ThirtyBisUnavailableError,
} from '@batimint/db';
import { renderThirtyBisProofPdf } from '@batimint/documents';
import { formatEuros, hasThirtyBisDebt, subcontractCommitment, thirtyBisWithholding } from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer, ConsumerContext, WorkerDeps } from '../consumer';
import { footerOf } from './projects';
import { upsertCost } from './purchasing';
import { dateFr, notify, office } from './shared';

const SYSTEM = { type: 'system' as const, label: 'Batimint' };

const DOCUMENT_LABEL: Record<string, string> = {
  rc_insurance: 'Assurance responsabilité civile',
  social_certificate: 'Attestation ONSS (absence de dettes sociales)',
  tax_certificate: 'Attestation SPF Finances (absence de dettes fiscales)',
  access_certificate: 'Accès à la profession',
  other: 'Document',
};

export function workerThirtyBisPorts(deps: WorkerDeps): ThirtyBisPorts {
  return {
    provider: deps.integrations.thirtyBis.provider,
    check: (n) => deps.integrations.thirtyBis.check(n),
    saveProof: async (key, pdf) => {
      await deps.integrations.storage.put({
        bucket: 'legal',
        key,
        body: pdf,
        contentType: 'application/pdf',
      });
    },
    renderProof: (input) => renderThirtyBisProofPdf(input),
  };
}

const debtLabel = (c: { hasSocialDebt: boolean; hasTaxDebt: boolean }) =>
  c.hasSocialDebt && c.hasTaxDebt
    ? 'dettes sociales et fiscales'
    : c.hasSocialDebt
      ? 'dette sociale'
      : 'dette fiscale';

async function publish(ctx: ConsumerContext, projectIds: (string | null)[], topics: string[]) {
  for (const id of new Set(projectIds.filter((x): x is string => Boolean(x))))
    for (const topic of topics) await ctx.publish({ channel: projectChannel(id), topic, ref: id });
  for (const topic of ['subcontracts', 'subcontractors', 'supplier_invoices'])
    await ctx.publish({ channel: tenantChannel(ctx.event.tenantId), topic, ref: ctx.event.aggregateId });
}

/** Engagé d'un contrat sur son poste : montant − facturé ; rien une fois clôturé ou annulé. */
export async function recomputeSubcontractCommitment(
  ctx: ConsumerContext,
  subcontractId: string,
): Promise<string | null> {
  const { tx } = ctx;
  const s = await tx.subcontract.findUnique({ where: { id: subcontractId }, include: { supplier: true } });
  if (!s) return null;
  const key = {
    tenantId: s.tenantId,
    category: 'subcontract' as const,
    sourceType: 'subcontract',
    sourceId: s.id,
  };
  const invoiced = (await subcontractTotals(tx, [s.id])).get(s.id)?.invoiced ?? 0n;
  const rest = s.status === 'active' ? subcontractCommitment(s.amount, invoiced) : 0n;
  if (rest === 0n) {
    const existing = await tx.projectCost.findUnique({
      where: { tenantId_category_sourceType_sourceId: key },
    });
    if (!existing) return s.projectId;
    await tx.projectCost.delete({ where: { id: existing.id } });
    await emitEvent(tx, {
      tenantId: s.tenantId,
      type: 'project.cost_recorded.v1',
      aggregateType: 'project',
      aggregateId: s.projectId,
      payload: {
        projectId: s.projectId,
        costId: existing.id,
        budgetLineId: existing.budgetLineId,
        category: 'subcontract',
        amount: '0',
      },
      actor: SYSTEM,
    });
    return s.projectId;
  }
  await upsertCost(ctx, {
    projectId: s.projectId,
    budgetLineId: s.budgetLineId,
    category: 'subcontract',
    sourceType: 'subcontract',
    sourceId: s.id,
    label: `Contrat ${s.number} — ${s.supplier.name}${invoiced > 0n ? ' (non facturé)' : ''}`,
    amount: rest,
  });
  return s.projectId;
}

export const subcontractLedger: Consumer = {
  name: 'subcontract-ledger',
  events: ['subcontract.created.v1', 'subcontract.updated.v1', 'supplier_invoice.allocated.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    let subcontractId: string | null;
    if (event.type === 'supplier_invoice.allocated.v1') {
      const p = parseEventPayload('supplier_invoice.allocated.v1', event.payload);
      const i = await tx.supplierInvoice.findUnique({ where: { id: p.invoiceId } });
      subcontractId = i?.subcontractId ?? null;
    } else {
      const p = parseEventPayload(event.type as 'subcontract.updated.v1', event.payload);
      subcontractId = p.subcontractId;
    }
    if (!subcontractId) return;
    const projectId = await recomputeSubcontractCommitment(ctx, subcontractId);
    await publish(ctx, [projectId], ['project', 'budget', 'subcontracts']);
  },
};

export const subcontractTimeline: Consumer = {
  name: 'subcontract-timeline',
  events: ['subcontract.created.v1', 'subcontract.updated.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload(event.type as 'subcontract.updated.v1', event.payload);
    const s = await tx.subcontract.findUnique({
      where: { id: p.subcontractId },
      include: { supplier: true, project: true },
    });
    if (!s) return;
    const actor = (event.actor as { label?: string } | null)?.label ?? null;
    if (event.type === 'subcontract.created.v1') {
      const check = s.creationCheckId
        ? await tx.thirtyBisCheck.findUnique({ where: { id: s.creationCheckId } })
        : null;
      const post = s.budgetLineId
        ? await tx.budgetLine.findUnique({ where: { id: s.budgetLineId }, select: { label: true } })
        : null;
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          projectId: s.projectId,
          customerId: s.project.customerId,
          type: 'subcontract.created',
          title: `Contrat de sous-traitance ${s.number} avec ${s.supplier.name}`,
          body: [
            `${s.title}${post ? ` · poste ${post.label}` : ''}`,
            check
              ? hasThirtyBisDebt(check)
                ? `30bis : ${debtLabel(check)} — retenue à chaque paiement`
                : '30bis : aucune dette sociale ni fiscale'
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          amount: -s.amount,
          actorLabel: actor,
          occurredAt: event.occurredAt,
          data: { subcontractId: s.id },
        },
      });
      if (check && hasThirtyBisDebt(check))
        await notify(
          ctx,
          (await office(tx, event.tenantId)).map((m) => m.userId),
          {
            type: 'subcontract.debt',
            title: `${s.supplier.name} a des ${debtLabel(check)}`,
            body: `Contrat ${s.number} conclu : une retenue 30bis s’appliquera à chaque paiement.`,
            link: `/sous-traitance/${s.supplierId}`,
          },
        );
    } else if (p.status !== 'active') {
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          projectId: s.projectId,
          customerId: s.project.customerId,
          type: `subcontract.${p.status}`,
          title: `Contrat ${s.number} ${p.status === 'completed' ? 'clôturé' : 'annulé'}`,
          body: s.supplier.name,
          actorLabel: actor,
          occurredAt: event.occurredAt,
          data: { subcontractId: s.id },
        },
      });
    }
    await publish(ctx, [s.projectId], ['timeline']);
  },
};

/**
 * Facture d'un sous-traitant (appelée par le rapprochement) : imputée au poste du contrat. Le
 * contrat est celui choisi sur le portail, sinon le seul contrat en cours du sous-traitant.
 */
export async function allocateToSubcontract(
  ctx: ConsumerContext,
  invoice: {
    id: string;
    supplierId: string | null;
    subcontractId: string | null;
    orderReference: string | null;
    totalNet: bigint;
  },
): Promise<boolean> {
  const { tx, event } = ctx;
  let subcontract = invoice.subcontractId
    ? await tx.subcontract.findUnique({ where: { id: invoice.subcontractId } })
    : null;
  // Une référence de commande l'emporte : le rapprochement BC s'en charge.
  if (!subcontract && invoice.supplierId && !invoice.orderReference) {
    const active = await tx.subcontract.findMany({
      where: { supplierId: invoice.supplierId, status: 'active' },
      take: 2,
    });
    if (active.length === 1) subcontract = active[0]!;
  }
  if (!subcontract || invoice.totalNet === 0n) return false;
  await tx.costAllocation.create({
    data: {
      tenantId: event.tenantId,
      invoiceId: invoice.id,
      projectId: subcontract.projectId,
      budgetLineId: subcontract.budgetLineId,
      amount: invoice.totalNet,
    },
  });
  await tx.supplierInvoice.update({
    where: { id: invoice.id },
    data: {
      status: 'allocated',
      subcontractId: subcontract.id,
      matchMethod: 'subcontract',
      matchConfidence: '1.000',
      projectId: subcontract.projectId,
      allocatedAt: new Date(),
    },
  });
  await emitEvent(tx, {
    tenantId: event.tenantId,
    type: 'supplier_invoice.allocated.v1',
    aggregateType: 'supplier_invoice',
    aggregateId: invoice.id,
    payload: { invoiceId: invoice.id, projectIds: [subcontract.projectId], automatic: true },
    actor: SYSTEM,
  });
  return true;
}

/**
 * Consultation 30bis à la réception d'une facture de sous-traitant (03 §9) : la retenue est
 * calculée pour information ; elle ne bloque qu'au moment du paiement (nouvelle consultation).
 */
export async function thirtyBisAtReception(ctx: ConsumerContext, invoiceId: string): Promise<void> {
  const { tx, event, deps } = ctx;
  const i = await tx.supplierInvoice.findUnique({ where: { id: invoiceId } });
  if (!i?.supplierId) return;
  const supplier = await tx.supplier.findUnique({ where: { id: i.supplierId } });
  if (!supplier || !(i.subcontractId || supplier.isSubcontractor)) return;
  if (await tx.thirtyBisCheck.findFirst({ where: { supplierInvoiceId: i.id, context: 'invoice_received' } }))
    return;
  let check;
  try {
    check = await recordThirtyBisCheck(tx, workerThirtyBisPorts(deps), {
      tenantId: event.tenantId,
      supplierId: supplier.id,
      context: 'invoice_received',
      subcontractId: i.subcontractId,
      supplierInvoiceId: i.id,
    });
  } catch (err) {
    if (err instanceof ThirtyBisUnavailableError) return; // signalé sur la fiche (numéro manquant)
    throw err;
  }
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: event.tenantId } });
  const s = parseTenantSettings(tenant.settings);
  const w = thirtyBisWithholding(
    { net: i.totalNet > 0n ? i.totalNet : 0n, gross: i.totalGross > 0n ? i.totalGross : 0n, check },
    { socialPercent: s.thirtyBisSocialPercent, taxPercent: s.thirtyBisTaxPercent },
  );
  await tx.supplierInvoice.update({
    where: { id: i.id },
    data: { thirtyBisCheckId: check.id, withholdingSocial: w.social, withholdingTax: w.tax },
  });
  await emitEvent(tx, {
    tenantId: event.tenantId,
    type: 'thirty_bis.checked.v1',
    aggregateType: 'supplier',
    aggregateId: supplier.id,
    payload: {
      checkId: check.id,
      supplierId: supplier.id,
      hasDebt: hasThirtyBisDebt(check),
      context: 'invoice_received',
    },
    actor: SYSTEM,
  });
}

export const thirtyBisAlerts: Consumer = {
  name: 'thirty-bis-alerts',
  events: ['supplier_invoice.blocked_thirty_bis.v1', 'supplier_invoice.withholding_applied.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload(event.type as 'supplier_invoice.blocked_thirty_bis.v1', event.payload);
    const i = await tx.supplierInvoice.findUnique({ where: { id: p.invoiceId } });
    const check = await tx.thirtyBisCheck.findUnique({ where: { id: p.checkId } });
    if (!i || !check) return;
    const withheld = BigInt(p.social) + BigInt(p.tax);
    const project = i.projectId
      ? await tx.project.findUnique({ where: { id: i.projectId }, select: { id: true, customerId: true } })
      : null;
    const blocked = event.type === 'supplier_invoice.blocked_thirty_bis.v1';
    if (project)
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          projectId: project.id,
          customerId: project.customerId,
          type: blocked ? 'supplier_invoice.blocked_thirty_bis' : 'supplier_invoice.withholding_applied',
          title: blocked
            ? `Paiement de ${i.supplierName} bloqué : ${debtLabel(check)}`
            : `Retenue 30bis appliquée sur la facture ${i.supplierName}${i.number ? ` ${i.number}` : ''}`,
          body: blocked
            ? `Retenue de ${formatEuros(withheld)} à verser aux administrations avant de payer le solde`
            : `${formatEuros(withheld)} à verser aux administrations · ${formatEuros(i.totalGross - withheld)} au sous-traitant`,
          actorLabel: (event.actor as { label?: string } | null)?.label ?? null,
          occurredAt: event.occurredAt,
          data: { invoiceId: i.id, checkId: check.id },
        },
      });
    if (blocked)
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'supplier_invoice.blocked_thirty_bis',
          title: `Paiement de ${i.supplierName} bloqué par le 30bis`,
          body: `${debtLabel(check)[0]!.toUpperCase()}${debtLabel(check).slice(1)} : retenue de ${formatEuros(withheld)} à appliquer.`,
          link: `/achats/factures?vue=to_pay&facture=${i.id}`,
        },
      );
    await publish(ctx, [project?.id ?? null], ['timeline']);
  },
};

export const subcontractorInvitation: Consumer = {
  name: 'subcontractor-invitation',
  events: ['subcontractor.invited.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('subcontractor.invited.v1', event.payload);
    const s = await tx.supplier.findUnique({ where: { id: p.supplierId }, include: { tenant: true } });
    if (!s) return;
    const t = s.tenant;
    const { token } = await createPortalToken(tx, {
      tenantId: event.tenantId,
      kind: 'subcontractor',
      supplierId: s.id,
      email: p.email,
      createdBy: (event.actor as { id?: string } | null)?.id ?? null,
    });
    const link = subcontractorPortalUrl(deps.appUrl, token);
    const mission = p.subcontractId
      ? await tx.subcontract.findUnique({ where: { id: p.subcontractId }, include: { project: true } })
      : null;
    await deps.integrations.mailer.send({
      ...buildEmail({
        to: p.email,
        subject: `${t.name} — votre espace sous-traitant${mission ? ` (${mission.number})` : ''}`,
        title: 'Votre espace sous-traitant',
        paragraphs: [
          'Bonjour,',
          mission
            ? `${t.name} vous confie la mission « ${mission.title} » sur le chantier « ${mission.project.name} » (contrat ${mission.number}, ${formatEuros(mission.amount)} HTVA).`
            : `${t.name} vous ouvre un espace pour suivre vos missions.`,
          'Vous y trouverez vos missions et leurs dates, le contrat, les documents à fournir (assurance, attestations) et vous pourrez y déposer vos factures.',
        ],
        cta: { label: 'Ouvrir mon espace', href: link },
        footer: footerOf(t),
        brandName: t.name,
        ...(t.email ? { replyTo: t.email } : {}),
      }),
      headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `subcontractor:${s.id}` },
    });
    await publish(ctx, [], []);
  },
};

export const subcontractorDocuments: Consumer = {
  name: 'subcontractor-documents',
  events: ['subcontractor.document_uploaded.v1', 'subcontractor.document_expiring.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    if (event.type === 'subcontractor.document_uploaded.v1') {
      const p = parseEventPayload('subcontractor.document_uploaded.v1', event.payload);
      const s = await tx.supplier.findUnique({ where: { id: p.supplierId } });
      if (!s) return;
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'subcontractor.document_uploaded',
          title: `${s.name} a déposé un document`,
          body: DOCUMENT_LABEL[p.kind] ?? 'Document',
          link: `/sous-traitance/${s.id}`,
        },
      );
      await publish(ctx, [], []);
      return;
    }
    const p = parseEventPayload('subcontractor.document_expiring.v1', event.payload);
    const [s, d] = await Promise.all([
      tx.supplier.findUnique({ where: { id: p.supplierId }, include: { tenant: true } }),
      tx.subcontractorDocument.findUnique({ where: { id: p.documentId } }),
    ]);
    if (!s || !d) return;
    const label = DOCUMENT_LABEL[d.kind] ?? 'Document';
    const when = d.expiresOn ? dateFr(d.expiresOn) : '';
    await notify(
      ctx,
      (await office(tx, event.tenantId)).map((m) => m.userId),
      {
        type: `subcontractor.document_${p.state}`,
        title:
          p.state === 'expired' ? `${label} de ${s.name} expiré` : `${label} de ${s.name} expire le ${when}`,
        body: 'Le sous-traitant est invité à déposer la version à jour sur son espace.',
        link: `/sous-traitance/${s.id}`,
      },
    );
    const email = s.email ?? s.orderEmail;
    if (email) {
      const t = s.tenant;
      const { token } = await createPortalToken(tx, {
        tenantId: event.tenantId,
        kind: 'subcontractor',
        supplierId: s.id,
        email,
      });
      await deps.integrations.mailer.send({
        ...buildEmail({
          to: email,
          subject: `${t.name} — ${label.toLowerCase()} ${p.state === 'expired' ? 'expiré' : 'à renouveler'}`,
          title: p.state === 'expired' ? 'Un document a expiré' : 'Un document arrive à échéance',
          paragraphs: [
            'Bonjour,',
            p.state === 'expired'
              ? `Votre document « ${label} » a expiré le ${when}.`
              : `Votre document « ${label} » expire le ${when}.`,
            'Merci de déposer la version à jour sur votre espace : sans elle, vos prochains paiements risquent d’être retardés.',
          ],
          cta: { label: 'Déposer le document', href: subcontractorPortalUrl(deps.appUrl, token) },
          footer: footerOf(t),
          brandName: t.name,
          ...(t.email ? { replyTo: t.email } : {}),
        }),
        headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `subcontractor:${s.id}` },
      });
    }
    await publish(ctx, [], []);
  },
};

export const subcontractingConsumers: Consumer[] = [
  subcontractLedger,
  subcontractTimeline,
  thirtyBisAlerts,
  subcontractorInvitation,
  subcontractorDocuments,
];
