/**
 * Facturation (03 §10, 02 P7, P8) : envoi des factures émises (Peppol si le client est joignable,
 * sinon e-mail avec PDF), suivi de livraison, paiements, états d'avancement (client), relances.
 * Chaque effet est idempotent : statut vérifié avant d'agir, étapes de relance uniques en base.
 */
import {
  parseEventPayload,
  parseTenantSettings,
  projectChannel,
  projectPortalChannel,
  tenantChannel,
} from '@batimint/contracts';
import { createPortalToken, createProgressInvoiceDraft, portalUrl, type Tx } from '@batimint/db';
import {
  brusselsDate,
  DEFAULT_DUNNING_POLICY,
  dueDunningStep,
  formatEuros,
  formatStructuredCommunication,
  invoiceBalance,
} from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer, ConsumerContext } from '../consumer';
import { footerOf, greeting } from './projects';
import { dateFr, notify, office } from './shared';

/** Calendrier et options de relance du tenant (05 §6) sur la politique par défaut. */
export function dunningPolicy(settings: ReturnType<typeof parseTenantSettings>) {
  return {
    ...DEFAULT_DUNNING_POLICY,
    days: settings.dunningDays,
    lateInterestEnabled: settings.lateInterestEnabled,
    lumpSumIndemnityEnabled: settings.lumpSumIndemnityEnabled,
  };
}
const LABEL: Record<string, string> = {
  deposit: 'Facture d’acompte',
  final: 'Facture finale',
  credit_note: 'Note de crédit',
};
const labelOf = (type: string) => LABEL[type] ?? 'Facture';
const day = (d: Date | null) => (d ? dateFr(d) : '');

async function publish(ctx: ConsumerContext, projectId: string | null) {
  if (projectId) {
    for (const topic of ['invoices', 'timeline', 'project'])
      await ctx.publish({ channel: projectChannel(projectId), topic, ref: projectId });
    await ctx.publish({ channel: projectPortalChannel(projectId), topic: 'portal', ref: projectId });
  }
  await ctx.publish({
    channel: tenantChannel(ctx.event.tenantId),
    topic: 'invoices',
    ref: ctx.event.aggregateId,
  });
}

function balance(i: {
  totalGross: bigint;
  retentionAmount: bigint;
  amountPaid: bigint;
  amountCredited: bigint;
}) {
  return invoiceBalance({
    totalGross: i.totalGross,
    retentionAmount: i.retentionAmount,
    paid: i.amountPaid,
    credited: i.amountCredited,
  });
}

async function portalLink(
  ctx: ConsumerContext,
  i: { projectId: string | null; customerId: string },
  email: string,
) {
  if (!i.projectId) return null;
  const { token } = await createPortalToken(ctx.tx, {
    tenantId: ctx.event.tenantId,
    kind: 'project',
    projectId: i.projectId,
    customerId: i.customerId,
    email,
  });
  return portalUrl(ctx.deps.appUrl, token);
}

// ---------------------------------------------------------------------------
// Envoi : Peppol si joignable, sinon e-mail (05 §1)
// ---------------------------------------------------------------------------

export const invoiceDelivery: Consumer = {
  name: 'invoice-delivery',
  events: ['invoice.issued.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('invoice.issued.v1', event.payload);
    const i = await tx.invoice.findUnique({
      where: { id: p.invoiceId },
      include: { customer: true, tenant: true, project: true },
    });
    if (!i || i.status === 'draft' || i.deliveryStatus) return;
    const label = labelOf(i.type);

    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: i.type === 'credit_note' ? 'credit_note.issued' : 'invoice.issued',
        title: `${label} ${i.number} émise`,
        body: i.title,
        customerId: i.customerId,
        projectId: i.projectId,
        amount: i.type === 'credit_note' ? -i.totalGross : i.totalGross,
        visibleToClient: true,
        actorLabel: (event.actor as { label?: string } | null)?.label ?? null,
        occurredAt: event.occurredAt,
      },
    });

    // 1. Peppol : client assujetti, inscrit dans l'annuaire, et entreprise inscrite chez le fournisseur d'accès.
    let peppolError: string | null = null;
    if (i.customer.enterpriseNumber) {
      const connection = await tx.integrationConnection.findFirst({
        where: { kind: 'peppol', status: 'active', externalId: { not: null } },
      });
      try {
        const lookup = await deps.integrations.peppol.lookupParticipant('0208', i.customer.enterpriseNumber);
        await tx.customer.update({
          where: { id: i.customerId },
          data: {
            peppolReachable: lookup.reachable,
            peppolCheckedAt: new Date(),
            peppolId: lookup.participantId,
          },
        });
        if (lookup.reachable && connection?.externalId && i.ublKey) {
          const ubl = Buffer.from(await deps.integrations.storage.get('legal', i.ublKey)).toString('utf8');
          const sent = await deps.integrations.peppol.sendInvoice({
            legalEntityId: connection.externalId,
            ubl,
            documentId: i.id,
          });
          await tx.invoice.update({
            where: { id: i.id },
            data: {
              deliveryChannel: 'peppol',
              deliveryStatus: 'sent',
              deliveryMessage: null,
              peppolDocumentId: sent.id,
              sentTo: lookup.participantId,
              sentAt: new Date(),
              ...(i.status === 'issued' ? { status: 'sent' } : {}),
            },
          });
          await publish(ctx, i.projectId);
          return;
        }
        if (lookup.reachable && !connection)
          peppolError = 'Peppol n’est pas encore activé pour votre entreprise : facture envoyée par e-mail.';
      } catch (err) {
        peppolError = `Envoi Peppol impossible (${(err as Error).message}) : facture envoyée par e-mail.`;
      }
    }

    // 2. E-mail avec le PDF (et l'UBL pour une entreprise), vouvoiement, lien vers le portail.
    const email = i.customer.email;
    if (!email) {
      await tx.invoice.update({
        where: { id: i.id },
        data: {
          deliveryStatus: 'failed',
          deliveryMessage: 'Le client n’a pas d’adresse e-mail : téléchargez le PDF et envoyez-le vous-même.',
        },
      });
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'invoice.delivery_failed',
          title: `${label} ${i.number} non envoyée`,
          body: 'Le client n’a pas d’adresse e-mail.',
          link: `/facturation/${i.id}`,
        },
      );
      await publish(ctx, i.projectId);
      return;
    }
    const t = i.tenant;
    const pdf = i.pdfKey ? await deps.integrations.storage.get('legal', i.pdfKey).catch(() => null) : null;
    const ubl =
      i.customer.kind === 'company' && i.ublKey
        ? await deps.integrations.storage.get('legal', i.ublKey).catch(() => null)
        : null;
    const link = await portalLink(ctx, i, email);
    const credit = i.type === 'credit_note';
    const due = balance(i);
    await deps.integrations.mailer.send({
      ...buildEmail({
        to: email,
        subject: `${t.name} — ${label.toLowerCase()} ${i.number}`,
        title: `${label} ${i.number}`,
        paragraphs: [
          await greeting(tx, i.customerId),
          credit
            ? `Veuillez trouver ci-joint notre note de crédit ${i.number} de ${formatEuros(i.totalGross)} TVAC : ${i.title}.`
            : `Veuillez trouver ci-joint notre ${label.toLowerCase()} ${i.number}${i.project ? ` pour le chantier « ${i.project.name} »` : ''} : ${i.title}.`,
          ...(credit
            ? []
            : [
                `Montant à payer : ${formatEuros(due)}${i.dueDate ? ` au plus tard le ${day(i.dueDate)}` : ''}${
                  t.iban ? `, sur le compte ${t.iban}` : ''
                }${
                  i.structuredCommunication
                    ? ` avec la communication structurée ${formatStructuredCommunication(i.structuredCommunication)}`
                    : ''
                }. Le QR code du PDF permet de payer avec votre application bancaire.`,
              ]),
          ...(link
            ? ['Vous retrouvez toutes vos factures et pouvez payer en ligne sur votre espace chantier.']
            : []),
        ],
        ...(link
          ? { cta: { label: credit ? 'Voir sur mon espace' : 'Voir et payer en ligne', href: link } }
          : {}),
        footer: footerOf(t),
        brandName: t.name,
        ...(t.email ? { replyTo: t.email } : {}),
      }),
      attachments: [
        ...(pdf
          ? [{ filename: `${i.number}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' }]
          : []),
        ...(ubl
          ? [{ filename: `${i.number}.xml`, content: Buffer.from(ubl), contentType: 'application/xml' }]
          : []),
      ],
      headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `invoice:${i.id}` },
    });
    await tx.invoice.update({
      where: { id: i.id },
      data: {
        deliveryChannel: 'email',
        deliveryStatus: 'sent',
        deliveryMessage: peppolError,
        sentTo: email,
        sentAt: new Date(),
        ...(i.status === 'issued' ? { status: 'sent' } : {}),
      },
    });
    await publish(ctx, i.projectId);
  },
};

export const invoiceDeliveryUpdate: Consumer = {
  name: 'invoice-delivery-update',
  events: ['invoice.delivery_updated.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('invoice.delivery_updated.v1', event.payload);
    const i = await tx.invoice.findUnique({ where: { id: p.invoiceId } });
    if (!i || i.deliveryStatus === p.status) return;
    await tx.invoice.update({
      where: { id: i.id },
      data: {
        deliveryStatus: p.status,
        deliveryMessage: p.message,
        ...(p.status === 'delivered' ? { deliveredAt: new Date() } : {}),
        ...(p.status === 'delivered' && i.status === 'sent' ? { status: 'delivered' } : {}),
      },
    });
    if (p.status === 'delivered')
      await tx.timelineEntry.create({
        data: {
          tenantId: event.tenantId,
          eventId: event.id,
          type: 'invoice.delivered',
          title: `${labelOf(i.type)} ${i.number} livrée via Peppol`,
          body: p.message,
          customerId: i.customerId,
          projectId: i.projectId,
          visibleToClient: false,
          occurredAt: event.occurredAt,
        },
      });
    if (p.status === 'failed')
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'invoice.delivery_failed',
          title: `${labelOf(i.type)} ${i.number} : livraison Peppol en échec`,
          body: p.message ?? 'Renvoyez-la par e-mail depuis la facture.',
          link: `/facturation/${i.id}`,
        },
      );
    await publish(ctx, i.projectId);
  },
};

// ---------------------------------------------------------------------------
// Paiements
// ---------------------------------------------------------------------------

export const paymentReceived: Consumer = {
  name: 'payment-received',
  events: ['payment.received.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('payment.received.v1', event.payload);
    const pay = await tx.payment.findUnique({ where: { id: p.paymentId } });
    const i = await tx.invoice.findUnique({ where: { id: p.invoiceId } });
    if (!pay || !i) return;
    const rest = balance(i);
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'payment.received',
        title: rest === 0n ? `Facture ${i.number} payée` : `Paiement reçu sur la facture ${i.number}`,
        body: `${formatEuros(pay.amount)}${p.source === 'payment_link' ? ' en ligne' : ''}${
          rest > 0n ? ` · reste ${formatEuros(rest)}` : ''
        }`,
        customerId: i.customerId,
        projectId: i.projectId,
        amount: pay.amount,
        visibleToClient: true,
        occurredAt: event.occurredAt,
      },
    });
    // Liens de paiement devenus inutiles.
    if (rest === 0n)
      await tx.paymentLink.updateMany({
        where: { invoiceId: i.id, status: 'open' },
        data: { status: 'canceled' },
      });
    if (p.source === 'payment_link')
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'payment.received',
          title: `Paiement en ligne reçu : ${formatEuros(pay.amount)}`,
          body: `Facture ${i.number}${rest === 0n ? ' soldée' : ` · reste ${formatEuros(rest)}`}`,
          link: `/facturation/${i.id}`,
        },
      );
    await publish(ctx, i.projectId);
  },
};

// ---------------------------------------------------------------------------
// États d'avancement (P7.2)
// ---------------------------------------------------------------------------

async function statementWithProject(tx: Tx, id: string) {
  return tx.progressStatement.findUnique({
    where: { id },
    include: { project: { include: { tenant: true, customer: true } } },
  });
}

const pctLabel = (a: bigint, c: bigint) =>
  c === 0n
    ? '0 %'
    : `${((Number(a) * 1000) / Number(c) / 10).toFixed(1).replace('.0', '').replace('.', ',')} %`;

export const progressStatementSubmitted: Consumer = {
  name: 'progress-statement-submitted',
  events: ['progress_statement.submitted.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('progress_statement.submitted.v1', event.payload);
    const st = await statementWithProject(tx, p.statementId);
    if (!st || st.status !== 'submitted') return;
    const project = st.project;
    const t = project.tenant;
    const pct = pctLabel(st.cumulativeAmount, st.contractAmount);
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'progress_statement.submitted',
        title: `État d’avancement n°${st.ordinal} à approuver (${pct})`,
        body: `${formatEuros(st.cumulativeAmount - st.previousAmount)} HTVA pour la période`,
        customerId: project.customerId,
        projectId: project.id,
        amount: st.cumulativeAmount - st.previousAmount,
        visibleToClient: true,
        occurredAt: event.occurredAt,
      },
    });
    const email = project.customer.email;
    if (email) {
      const link = await portalLink(ctx, { projectId: project.id, customerId: project.customerId }, email);
      await deps.integrations.mailer.send({
        ...buildEmail({
          to: email,
          subject: `${t.name} — état d’avancement n°${st.ordinal} à approuver`,
          title: `État d’avancement n°${st.ordinal}`,
          paragraphs: [
            await greeting(tx, project.customerId),
            `Votre chantier « ${project.name} » avance : ${pct} des travaux sont réalisés au ${day(st.periodEnd)}.`,
            `Nous vous proposons de facturer ${formatEuros(st.cumulativeAmount - st.previousAmount)} HTVA pour cette période, acompte déduit sur la facture.`,
            'Vous pouvez consulter le détail par poste, l’approuver ou nous signaler un désaccord en ligne.',
          ],
          ...(link ? { cta: { label: 'Voir et approuver l’état', href: link } } : {}),
          footer: footerOf(t),
          brandName: t.name,
          ...(t.email ? { replyTo: t.email } : {}),
        }),
        headers: {
          'X-Batimint-Tenant': event.tenantId,
          'X-Batimint-Document': `progress_statement:${st.id}`,
        },
      });
    }
    await publish(ctx, project.id);
  },
};

export const progressStatementApproved: Consumer = {
  name: 'progress-statement-approved',
  events: ['progress_statement.approved.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('progress_statement.approved.v1', event.payload);
    const st = await statementWithProject(tx, p.statementId);
    if (!st) return;
    const { id: invoiceId } = await createProgressInvoiceDraft(tx, st.id, null);
    const pct = pctLabel(st.cumulativeAmount, st.contractAmount);
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'progress_statement.approved',
        title: p.byClient
          ? `État d’avancement n°${st.ordinal} approuvé par ${st.approvedByName ?? 'le client'}`
          : `État d’avancement n°${st.ordinal} validé (${pct})`,
        body: `${formatEuros(st.cumulativeAmount - st.previousAmount)} HTVA · facture prête à émettre`,
        customerId: st.project.customerId,
        projectId: st.projectId,
        amount: st.cumulativeAmount - st.previousAmount,
        visibleToClient: p.byClient,
        actorLabel: p.byClient ? st.approvedByName : null,
        occurredAt: event.occurredAt,
      },
    });
    if (p.byClient)
      await notify(
        ctx,
        [
          ...(st.project.managerUserId ? [st.project.managerUserId] : []),
          ...(await office(tx, event.tenantId)).map((m) => m.userId),
        ],
        {
          type: 'progress_statement.approved',
          title: `État n°${st.ordinal} approuvé : facture prête`,
          body: `${st.project.name} · ${formatEuros(st.cumulativeAmount - st.previousAmount)} HTVA`,
          link: `/facturation/${invoiceId}`,
        },
      );
    await publish(ctx, st.projectId);
  },
};

export const progressStatementDisputed: Consumer = {
  name: 'progress-statement-disputed',
  events: ['progress_statement.disputed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('progress_statement.disputed.v1', event.payload);
    const st = await statementWithProject(tx, p.statementId);
    if (!st) return;
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'progress_statement.disputed',
        title: `État d’avancement n°${st.ordinal} contesté par le client`,
        body: p.reason,
        customerId: st.project.customerId,
        projectId: st.projectId,
        visibleToClient: true,
        occurredAt: event.occurredAt,
      },
    });
    await notify(
      ctx,
      [
        ...(st.project.managerUserId ? [st.project.managerUserId] : []),
        ...(await office(tx, event.tenantId)).map((m) => m.userId),
      ],
      {
        type: 'progress_statement.disputed',
        title: `État n°${st.ordinal} contesté : ${st.project.name}`,
        body: p.reason,
        link: `/chantiers/${st.projectId}?onglet=facturation`,
      },
    );
    await publish(ctx, st.projectId);
  },
};

// ---------------------------------------------------------------------------
// Relances (05 §6)
// ---------------------------------------------------------------------------

export const invoiceReminder: Consumer = {
  name: 'invoice-reminder',
  events: ['invoice.reminder_due.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('invoice.reminder_due.v1', event.payload);
    const i = await tx.invoice.findUnique({
      where: { id: p.invoiceId },
      include: { customer: true, tenant: true, dunning: true },
    });
    if (!i || i.remindersPaused || !i.dueDate || i.dunning.some((d) => d.step === p.step)) return;
    const rest = balance(i);
    const settings = parseTenantSettings(i.tenant.settings);
    const step = dueDunningStep({
      dueDate: i.dueDate.toISOString().slice(0, 10),
      today: brusselsDate(new Date()),
      stepsSent: i.dunning.length,
      balance: rest,
      customerKind: i.customer.kind,
      policy: dunningPolicy(settings),
    });
    if (!step || step.step !== p.step) return;
    const email = i.customer.email;
    await tx.dunningStep.create({
      data: {
        tenantId: event.tenantId,
        invoiceId: i.id,
        step: step.step,
        kind: step.kind,
        daysLate: step.daysLate,
        balance: rest,
        fee: step.fee,
        interest: step.interest,
        sentTo: email,
      },
    });
    const t = i.tenant;
    const formal = step.kind === 'formal_notice';
    const company = i.customer.kind === 'company';
    if (email) {
      const link = await portalLink(ctx, i, email);
      const extra = step.fee + step.interest;
      await deps.integrations.mailer.send({
        ...buildEmail({
          to: email,
          subject: `${t.name} — ${formal ? 'mise en demeure' : `rappel`} : facture ${i.number}`,
          title: formal ? `Mise en demeure — facture ${i.number}` : `Rappel — facture ${i.number}`,
          paragraphs: [
            await greeting(tx, i.customerId),
            step.step === 1
              ? `Sauf erreur de notre part, la facture ${i.number} arrivée à échéance le ${day(i.dueDate)} n’a pas encore été réglée. Il s’agit peut-être d’un oubli.`
              : `Malgré notre précédent rappel, la facture ${i.number} échue le ${day(i.dueDate)} reste impayée (${step.daysLate} jours de retard).`,
            `Montant restant dû : ${formatEuros(rest)}${t.iban ? ` sur le compte ${t.iban}` : ''}${
              i.structuredCommunication
                ? ` avec la communication ${formatStructuredCommunication(i.structuredCommunication)}`
                : ''
            }.`,
            ...(extra > 0n
              ? [
                  company
                    ? `Conformément à la loi du 2 août 2002, une indemnité forfaitaire de ${formatEuros(step.fee)} et des intérêts de retard de ${formatEuros(step.interest)} sont dus.`
                    : `Des frais de ${formatEuros(step.fee)} et des intérêts de ${formatEuros(step.interest)} peuvent être réclamés conformément au Code de droit économique.`,
                ]
              : []),
            formal
              ? 'Sans paiement de votre part dans les 15 jours, nous serons contraints de transmettre le dossier pour recouvrement.'
              : 'Si vous avez déjà effectué le paiement, merci de ne pas tenir compte de ce message.',
          ],
          ...(link ? { cta: { label: 'Payer en ligne', href: link } } : {}),
          footer: footerOf(t),
          brandName: t.name,
          ...(t.email ? { replyTo: t.email } : {}),
        }),
        headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `invoice:${i.id}` },
      });
    }
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'invoice.reminder_sent',
        title: `${formal ? 'Mise en demeure' : `Rappel n°${step.step}`} envoyé${formal ? 'e' : ''} : facture ${i.number}`,
        body: `${step.daysLate} jours de retard · reste ${formatEuros(rest)}${email ? '' : ' · client sans e-mail'}`,
        customerId: i.customerId,
        projectId: i.projectId,
        visibleToClient: false,
        occurredAt: event.occurredAt,
      },
    });
    if (!email)
      await notify(
        ctx,
        (await office(tx, event.tenantId)).map((m) => m.userId),
        {
          type: 'invoice.reminder_manual',
          title: `Rappel à faire à la main : facture ${i.number}`,
          body: 'Le client n’a pas d’adresse e-mail.',
          link: `/facturation/${i.id}`,
        },
      );
    await publish(ctx, i.projectId);
  },
};

export const invoicingConsumers: Consumer[] = [
  invoiceDelivery,
  invoiceDeliveryUpdate,
  paymentReceived,
  progressStatementSubmitted,
  progressStatementApproved,
  progressStatementDisputed,
  invoiceReminder,
];
