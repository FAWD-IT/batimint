/**
 * Devis (04, catalogue d'événements) :
 *  - quote.sent → lien de portail (jeton créé à l'envoi, seule son empreinte est stockée) et e-mail ;
 *  - quote.sent / viewed / signed / refused / expired → fil chronologique, notifications, temps réel ;
 *  - quote.signed → chantier, postes budgétaires, tâches, facture d'acompte en brouillon,
 *    prospect devenu client, affaire gagnée (idempotent : un devis = un chantier) ;
 *  - quote.reminder_due → relance du client à J+7.
 */
import { createHash, randomBytes } from 'node:crypto';
import { parseEventPayload, tenantChannel } from '@batimint/contracts';
import { emitEvent, loadVersionContent, nextSequenceValue, type Tx } from '@batimint/db';
import {
  computeDocumentTotals,
  computeQuote,
  dec,
  formatDocumentNumber,
  formatEuros,
  isSectionIncluded,
  roundHalfAwayFromZero,
  type VatRegime,
} from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer } from '../consumer';
import { dateFr, notify, office } from './shared';

const PORTAL_LINK_DAYS = 120;

async function createPortalLink(
  tx: Tx,
  q: { id: string; tenantId: string; customerId: string | null; validUntil: Date | null },
  email: string,
  appUrl: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const base = q.validUntil ?? new Date();
  await tx.portalToken.create({
    data: {
      tenantId: q.tenantId,
      kind: 'quote',
      quoteId: q.id,
      customerId: q.customerId,
      email,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(base.getTime() + PORTAL_LINK_DAYS * 86_400_000),
    },
  });
  return `${appUrl}/p/${encodeURIComponent(token)}`;
}

export const sendQuoteEmail: Consumer = {
  name: 'send-quote-email',
  events: ['quote.sent.v1'],
  async handle({ tx, event, deps }) {
    const p = parseEventPayload('quote.sent.v1', event.payload);
    const q = await tx.quote.findUnique({
      where: { id: p.quoteId },
      include: { tenant: true, customer: true },
    });
    const v = await tx.quoteVersion.findUnique({ where: { id: p.versionId } });
    if (!q || !v || q.status === 'signed') return;
    const link = await createPortalLink(tx, q, p.email, deps.appUrl);
    const sender = q.ownerUserId ? await tx.user.findUnique({ where: { id: q.ownerUserId } }) : null;
    const pdf = v.pdfKey ? await deps.integrations.storage.get('uploads', v.pdfKey).catch(() => null) : null;
    const name = q.customer?.firstName
      ? `${q.customer.firstName} ${q.customer.lastName ?? ''}`.trim()
      : q.customer?.displayName;
    await deps.integrations.mailer.send({
      ...buildEmail({
        to: p.email,
        subject: `${q.tenant.name} — devis ${q.number ?? ''} : ${q.title}`.replace(/\s+/g, ' '),
        title: `Votre devis ${q.number ?? ''}`.trim(),
        paragraphs: [
          name ? `Bonjour ${name},` : 'Bonjour,',
          ...(p.message ? [p.message] : [`Veuillez trouver notre devis « ${q.title} ».`]),
          `Vous pouvez le consulter, choisir vos options et le signer en ligne${
            q.validUntil ? ` jusqu'au ${dateFr(q.validUntil)}` : ''
          }. Le PDF est joint à cet e-mail.`,
        ],
        cta: { label: 'Consulter et signer le devis', href: link },
        footer: `${q.tenant.name}${q.tenant.phone ? ` · ${q.tenant.phone}` : ''}${q.tenant.email ? ` · ${q.tenant.email}` : ''}`,
        ...(sender ? { replyTo: sender.email } : q.tenant.email ? { replyTo: q.tenant.email } : {}),
      }),
      ...(pdf
        ? {
            attachments: [
              {
                filename: `${q.number ?? 'devis'}.pdf`,
                content: Buffer.from(pdf),
                contentType: 'application/pdf',
              },
            ],
          }
        : {}),
      headers: { 'X-Batimint-Tenant': q.tenantId, 'X-Batimint-Document': `quote:${q.id}` },
    });
  },
};

export const quoteReminder: Consumer = {
  name: 'quote-reminder',
  events: ['quote.reminder_due.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('quote.reminder_due.v1', event.payload);
    const q = await tx.quote.findUnique({
      where: { id: p.quoteId },
      include: { tenant: true, customer: true },
    });
    if (!q || !['sent', 'viewed'].includes(q.status) || !q.customer?.email) return;
    const link = await createPortalLink(tx, q, q.customer.email, deps.appUrl);
    await deps.integrations.mailer.send(
      buildEmail({
        to: q.customer.email,
        subject: `Rappel : votre devis ${q.number ?? ''} — ${q.tenant.name}`.replace(/\s+/g, ' '),
        title: 'Votre devis vous attend',
        paragraphs: [
          'Bonjour,',
          `Nous vous avons transmis notre devis « ${q.title} ». Avez-vous des questions ? Nous restons à votre disposition.`,
          ...(q.validUntil ? [`Il reste valable jusqu'au ${dateFr(q.validUntil)}.`] : []),
        ],
        cta: { label: 'Consulter le devis', href: link },
        footer: `${q.tenant.name}${q.tenant.phone ? ` · ${q.tenant.phone}` : ''}`,
        ...(q.tenant.email ? { replyTo: q.tenant.email } : {}),
      }),
    );
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'quote.reminder_sent',
        title: 'Relance envoyée au client',
        body: q.number,
        customerId: q.customerId,
        opportunityId: q.opportunityId,
        quoteId: q.id,
        occurredAt: event.occurredAt,
      },
    });
    await ctx.publish({ channel: tenantChannel(event.tenantId), topic: 'quotes', ref: q.id });
  },
};

const TIMELINE_TITLES: Record<string, (who: string) => string> = {
  'quote.sent.v1': () => 'Devis envoyé',
  'quote.viewed.v1': (who) => `Vu par ${who}`,
  'quote.signed.v1': (who) => `Signé par ${who}`,
  'quote.refused.v1': () => 'Devis refusé',
  'quote.expired.v1': () => 'Devis expiré',
};

export const quoteTimeline: Consumer = {
  name: 'quote-timeline',
  events: ['quote.sent.v1', 'quote.viewed.v1', 'quote.signed.v1', 'quote.refused.v1', 'quote.expired.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const quoteId = (event.payload as { quoteId: string }).quoteId;
    const q = await tx.quote.findUnique({ where: { id: quoteId }, include: { customer: true } });
    if (!q) return;
    const actor = (event.actor as { label?: string } | null)?.label;
    const who = actor ?? q.customer?.displayName ?? 'le client';
    const title = TIMELINE_TITLES[event.type]!(who);
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: event.type.replace(/\.v\d+$/, ''),
        title,
        body: q.number ? `${q.number} — ${q.title}` : q.title,
        customerId: q.customerId,
        opportunityId: q.opportunityId,
        quoteId: q.id,
        actorLabel: actor ?? null,
        occurredAt: event.occurredAt,
      },
    });
    if (event.type === 'quote.viewed.v1') {
      const recipients = q.ownerUserId
        ? [q.ownerUserId]
        : (await office(tx, event.tenantId)).map((m) => m.userId);
      await notify(ctx, recipients, {
        type: 'quote.viewed',
        title: `${q.number ?? 'Devis'} vu par ${who}`,
        body: q.title,
        link: `/devis/${q.id}`,
      });
    }
    if (event.type === 'quote.refused.v1') {
      const recipients = (await office(tx, event.tenantId, ['owner', 'admin'])).map((m) => m.userId);
      await notify(ctx, recipients, {
        type: 'quote.refused',
        title: `${q.number ?? 'Devis'} refusé`,
        body: q.title,
        link: `/devis/${q.id}`,
      });
    }
    await ctx.publish({ channel: tenantChannel(event.tenantId), topic: 'quotes', ref: q.id });
  },
};

/** Répartit l'acompte TVAC sur les taux du devis, pour une facture d'acompte aux bons taux. */
function depositLines(
  breakdown: { regimes: string[]; taxableAmount: bigint; ratePercent: string }[],
  totalGross: bigint,
  deposit: bigint,
): { netAmount: bigint; vatRegime: VatRegime }[] {
  if (deposit <= 0n || totalGross <= 0n) return [];
  const ratio = dec(deposit.toString()).dividedBy(totalGross.toString());
  return breakdown
    .filter((b) => b.taxableAmount > 0n)
    .map((b) => ({
      netAmount: roundHalfAwayFromZero(dec(b.taxableAmount.toString()).times(ratio)),
      vatRegime: b.regimes[0] as VatRegime,
    }));
}

export const quoteSignedProject: Consumer = {
  name: 'quote-signed-project',
  events: ['quote.signed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('quote.signed.v1', event.payload);
    const q = await tx.quote.findUnique({
      where: { id: p.quoteId },
      include: { customer: true, site: true, project: true, tenant: true },
    });
    if (!q || !q.customerId) return;
    if (q.project) return; // déjà créé (rejeu)
    const loaded = await loadVersionContent(tx, p.versionId);
    if (!loaded) return;
    const totals = computeQuote(loaded.content);
    const year = new Date().getFullYear();
    const number = formatDocumentNumber('CH{YYYY}-{SEQ:3}', {
      year,
      sequence: await nextSequenceValue(tx, event.tenantId, 'project', year),
    });

    const project = await tx.project.create({
      data: {
        tenantId: event.tenantId,
        number,
        name: q.title,
        customerId: q.customerId,
        siteId: q.siteId,
        quoteId: q.id,
        opportunityId: q.opportunityId,
        status: 'preparation',
        contractAmount: totals.document.totalNet,
        managerUserId: q.ownerUserId,
      },
    });

    // Un poste budgétaire par poste retenu du devis, et ses tâches (une par ligne chiffrée).
    const sectionTotals = new Map(totals.sections.map((s) => [s.id, s]));
    const lineTotals = new Map(totals.lines.map((l) => [l.id, l]));
    let taskPosition = 0;
    for (const [position, s] of loaded.content.sections.filter((x) => isSectionIncluded(x)).entries()) {
      const st = sectionTotals.get(s.id)!;
      const bl = await tx.budgetLine.create({
        data: {
          tenantId: event.tenantId,
          projectId: project.id,
          quoteSectionKey: s.id,
          position,
          label: s.title || `Poste ${position + 1}`,
          budgetedCost: st.cost,
          saleAmount: st.netAmount,
          laborHours: st.laborHours.toString(),
        },
      });
      const items = s.lines.filter((l) => l.kind === 'item');
      if (items.length)
        await tx.task.createMany({
          data: items.map((l) => ({
            tenantId: event.tenantId,
            projectId: project.id,
            budgetLineId: bl.id,
            quoteLineKey: l.id,
            position: taskPosition++,
            title: l.description.split('\n')[0]!.slice(0, 300),
            quantity: String(l.quantity),
            unit: l.unit,
            plannedHours: lineTotals.get(l.id)?.laborHours.toDecimalPlaces(2).toString() ?? '0',
            amount: lineTotals.get(l.id)?.netAmount ?? 0n,
          })),
        });
    }

    // Facture d'acompte en brouillon, aux taux du devis (05 §4 : mêmes fonctions de calcul).
    const deposit = depositLines(
      totals.document.vatBreakdown,
      totals.document.totalGross,
      totals.depositAmount,
    );
    if (deposit.length) {
      const pct =
        loaded.version.depositKind === 'percent' && loaded.version.depositValue
          ? `${loaded.version.depositValue.toString().replace(/\.?0+$/, '')} %`
          : null;
      const label = `Acompte${pct ? ` de ${pct}` : ''} sur le devis ${q.number ?? ''} — ${q.title}`.replace(
        /\s+/g,
        ' ',
      );
      const doc = computeDocumentTotals(
        deposit.map((d) => ({ quantity: '1', unitPrice: d.netAmount, vatRegime: d.vatRegime })),
      );
      await tx.invoice.create({
        data: {
          tenantId: event.tenantId,
          projectId: project.id,
          customerId: q.customerId,
          quoteId: q.id,
          type: 'deposit',
          status: 'draft',
          title: label,
          totalNet: doc.totalNet,
          totalVat: doc.totalVat,
          totalGross: doc.totalGross,
          lines: {
            create: deposit.map((d, i) => ({
              tenantId: event.tenantId,
              position: i,
              description: label,
              quantity: '1',
              unitPrice: d.netAmount,
              vatRegime: d.vatRegime,
            })),
          },
        },
      });
    }

    await tx.vatCertificate.updateMany({ where: { quoteId: q.id }, data: { projectId: project.id } });
    if (q.customer?.status !== 'customer')
      await tx.customer.update({ where: { id: q.customerId }, data: { status: 'customer' } });
    if (q.opportunityId) {
      const opp = await tx.opportunity.findUnique({ where: { id: q.opportunityId } });
      if (opp && opp.stage !== 'won') {
        await tx.opportunity.update({
          where: { id: opp.id },
          data: { stage: 'won', wonAt: new Date(), lostReason: null },
        });
        await emitEvent(tx, {
          tenantId: event.tenantId,
          type: 'opportunity.stage_changed.v1',
          aggregateType: 'opportunity',
          aggregateId: opp.id,
          payload: { opportunityId: opp.id, from: opp.stage, to: 'won' },
          actor: { type: 'system', label: 'Signature du devis' },
        });
      }
    }
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        type: 'project.created',
        title: 'Chantier créé à la signature du devis',
        body: `${q.number ?? ''} — ${formatEuros(totals.document.totalNet)} HTVA`.trim(),
        customerId: q.customerId,
        opportunityId: q.opportunityId,
        quoteId: q.id,
        projectId: project.id,
        visibleToClient: true,
        occurredAt: event.occurredAt,
      },
    });
    await emitEvent(tx, {
      tenantId: event.tenantId,
      type: 'project.created.v1',
      aggregateType: 'project',
      aggregateId: project.id,
      payload: { projectId: project.id, quoteId: q.id },
      actor: { type: 'system', label: 'Signature du devis' },
    });
    const recipients = (await office(tx, event.tenantId)).map((m) => m.userId);
    await notify(ctx, recipients, {
      type: 'quote.signed',
      title: `${q.number ?? 'Devis'} signé par ${q.customer?.displayName ?? 'le client'}`,
      body: `${q.title} — ${formatEuros(totals.document.totalNet)} HTVA. Chantier ${number} créé.`,
      link: `/devis/${q.id}`,
    });
    await ctx.publish({ channel: tenantChannel(event.tenantId), topic: 'projects', ref: project.id });
    await ctx.publish({ channel: tenantChannel(event.tenantId), topic: 'quotes', ref: q.id });
    await ctx.publish({
      channel: tenantChannel(event.tenantId),
      topic: 'opportunities',
      ref: q.opportunityId ?? q.id,
    });
    await ctx.publish({ channel: tenantChannel(event.tenantId), topic: 'customers', ref: q.customerId });
  },
};
