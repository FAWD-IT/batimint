/**
 * Réception et clôture (03 §5, 02 P10) — effets idempotents :
 *  - PV signé : fil (visible du client), e-mail du PV au client, notification ;
 *    provisoire : chaque réserve devient une tâche, sans réserve la facture finale est préparée ;
 *    définitive : la retenue de garantie est libérée (avis au client, solde rouvert) ;
 *  - tâche d'une réserve terminée → réserve levée ; dernière réserve levée → facture finale ;
 *  - chantier clôturé : rapport de rentabilité signalé au gérant.
 */
import { parseEventPayload, projectChannel, projectPortalChannel, tenantChannel } from '@batimint/contracts';
import { createFinalInvoiceDraft, createPortalToken, emitEvent, portalUrl } from '@batimint/db';
import { renderRetentionReleasePdf, sha256 } from '@batimint/documents';
import { brusselsDate, formatEuros, formatStructuredCommunication, retentionRelease } from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer, ConsumerContext } from '../consumer';
import { footerOf, greeting } from './projects';
import { dateFr, notify, office } from './shared';

const SYSTEM = { type: 'system' as const, label: 'Batimint' };

async function publish(ctx: ConsumerContext, projectId: string, topics: string[]) {
  for (const topic of topics)
    await ctx.publish({ channel: projectChannel(projectId), topic, ref: projectId });
  await ctx.publish({ channel: projectPortalChannel(projectId), topic: 'portal', ref: projectId });
  await ctx.publish({ channel: tenantChannel(ctx.event.tenantId), topic: 'projects', ref: projectId });
}

async function recipients(ctx: ConsumerContext, managerUserId: string | null) {
  const ids = (await office(ctx.tx, ctx.event.tenantId)).map((m) => m.userId);
  return managerUserId ? [managerUserId, ...ids] : ids;
}

async function requestFinalInvoice(ctx: ConsumerContext, projectId: string) {
  await emitEvent(ctx.tx, {
    tenantId: ctx.event.tenantId,
    type: 'project.final_invoice_requested.v1',
    aggregateType: 'project',
    aggregateId: projectId,
    payload: { projectId },
    actor: SYSTEM,
  });
}

/** Libère les retenues de garantie du chantier (réception définitive) et prévient le client. */
async function releaseRetention(ctx: ConsumerContext, projectId: string) {
  const { tx, event, deps } = ctx;
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    include: { customer: true, tenant: true },
  });
  const invoices = await tx.invoice.findMany({
    where: {
      projectId,
      status: { notIn: ['draft', 'cancelled'] },
      type: { not: 'credit_note' },
      retentionAmount: { gt: 0 },
      retentionReleasedAt: null,
    },
    orderBy: { issueDate: 'asc' },
  });
  if (!invoices.length) return;
  const today = brusselsDate(event.occurredAt);
  const terms = Number((p.tenant.settings as { paymentTermsDays?: number } | null)?.paymentTermsDays ?? 30);
  const r = retentionRelease(
    invoices.map((i) => ({ retentionAmount: i.retentionAmount, released: false })),
    today,
    Number.isFinite(terms) ? terms : 30,
  );
  const now = new Date();
  for (const i of invoices)
    await tx.invoice.update({
      where: { id: i.id },
      data: {
        retentionReleasedAt: now,
        retentionDueDate: new Date(`${r.dueDate}T00:00:00Z`),
        ...(i.status === 'paid' ? { status: 'partially_paid', paidAt: null } : {}),
      },
    });
  const t = p.tenant;
  const pdf = await renderRetentionReleasePdf({
    tenant: { name: t.legalName ?? t.name, lines: [], brandColor: t.brandColor, iban: t.iban },
    customer: { name: p.customer.displayName, lines: [] },
    project: { number: p.number, name: p.name },
    date: now,
    dueDate: new Date(`${r.dueDate}T00:00:00Z`),
    invoices: invoices.map((i) => ({
      number: i.number ?? '',
      issueDate: i.issueDate,
      amount: i.retentionAmount,
      communication: i.structuredCommunication
        ? formatStructuredCommunication(i.structuredCommunication)
        : null,
    })),
    total: r.amount,
  });
  const key = `t/${event.tenantId}/projects/${projectId}/liberation-retenue-${event.id}.pdf`;
  await deps.integrations.storage.put({
    bucket: 'legal',
    key,
    body: pdf,
    contentType: 'application/pdf',
    metadata: { sha256: sha256(pdf) },
  });
  await tx.timelineEntry.create({
    data: {
      tenantId: event.tenantId,
      // L'entrée du PV porte déjà l'événement ; celle-ci est unique par le filtre « non libérée ».
      projectId,
      customerId: p.customerId,
      type: 'retention.released',
      title: `Retenue de garantie libérée : ${formatEuros(r.amount)}`,
      body: `${r.count} facture${r.count > 1 ? 's' : ''} · à payer au plus tard le ${dateFr(new Date(`${r.dueDate}T00:00:00Z`))}`,
      amount: r.amount,
      visibleToClient: true,
      occurredAt: event.occurredAt,
      data: { documentKey: key },
    },
  });
  const email = p.customer.email;
  if (email) {
    const { token } = await createPortalToken(tx, {
      tenantId: event.tenantId,
      kind: 'project',
      projectId,
      customerId: p.customerId,
      email,
    });
    await deps.integrations.mailer.send({
      ...buildEmail({
        to: email,
        subject: `${t.name} — libération de la retenue de garantie`,
        title: 'Libération de la retenue de garantie',
        paragraphs: [
          await greeting(tx, p.customerId),
          `La réception définitive du chantier « ${p.name} » est signée : la retenue de garantie de ${formatEuros(r.amount)} devient payable, au plus tard le ${dateFr(new Date(`${r.dueDate}T00:00:00Z`))}.`,
          'Le détail par facture et les communications structurées figurent dans l’avis joint.',
        ],
        cta: { label: 'Voir mon espace chantier', href: portalUrl(deps.appUrl, token) },
        footer: footerOf(t),
        brandName: t.name,
        ...(t.email ? { replyTo: t.email } : {}),
      }),
      attachments: [
        {
          filename: 'liberation-retenue-garantie.pdf',
          content: Buffer.from(pdf),
          contentType: 'application/pdf',
        },
      ],
      headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `retention:${projectId}` },
    });
  }
  for (const topic of ['invoices'])
    await ctx.publish({ channel: tenantChannel(event.tenantId), topic, ref: projectId });
}

export const receptionSigned: Consumer = {
  name: 'reception-signed',
  events: ['reception.signed.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('reception.signed.v1', event.payload);
    const r = await tx.reception.findUnique({
      where: { id: p.receptionId },
      include: {
        reserves: { orderBy: { position: 'asc' } },
        project: { include: { customer: true, tenant: true } },
      },
    });
    if (!r || r.status !== 'signed') return;
    const project = r.project;
    const provisional = r.kind === 'provisional';
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        projectId: project.id,
        customerId: project.customerId,
        type: 'reception.signed',
        title: `${provisional ? 'Réception provisoire' : 'Réception définitive'} signée par ${r.signerName ?? 'le client'}`,
        body: provisional
          ? r.reserves.length
            ? `${r.reserves.length} réserve${r.reserves.length > 1 ? 's' : ''} à lever`
            : 'Sans réserve'
          : 'Fin du délai de garantie',
        visibleToClient: true,
        actorLabel: r.signerName,
        occurredAt: event.occurredAt,
        data: { receptionId: r.id },
      },
    });
    if (provisional) {
      // Chaque réserve devient une tâche du chantier (03 §5) ; elle est levée quand la tâche est faite.
      const last = await tx.task.findFirst({
        where: { projectId: project.id },
        orderBy: { position: 'desc' },
      });
      let position = (last?.position ?? 0) + 1;
      for (const reserve of r.reserves) {
        if (reserve.taskId) continue;
        const task = await tx.task.create({
          data: {
            tenantId: event.tenantId,
            projectId: project.id,
            budgetLineId: reserve.budgetLineId,
            position: position++,
            title: `Réserve : ${reserve.description}`.slice(0, 200),
            description: reserve.location ? `Emplacement : ${reserve.location}` : null,
            dueDate: r.plannedFinalDate,
          },
        });
        await tx.reserve.update({ where: { id: reserve.id }, data: { taskId: task.id } });
        if (reserve.photoIds.length)
          await tx.attachment.updateMany({
            where: { id: { in: reserve.photoIds }, taskId: null },
            data: { taskId: task.id },
          });
      }
      if (!r.reserves.length) await requestFinalInvoice(ctx, project.id);
    } else {
      await releaseRetention(ctx, project.id);
    }
    await notify(ctx, await recipients(ctx, project.managerUserId), {
      type: 'reception.signed',
      title: `${provisional ? 'Réception provisoire' : 'Réception définitive'} signée : ${project.name}`,
      body: provisional
        ? r.reserves.length
          ? `${r.reserves.length} réserve${r.reserves.length > 1 ? 's' : ''} devenue${r.reserves.length > 1 ? 's' : ''} des tâches`
          : 'Sans réserve : la facture finale est prête à émettre'
        : 'Retenue de garantie libérée',
      link: `/chantiers/${project.id}?onglet=reception`,
    });
    // Le PV signé part au client (vouvoiement).
    const email = project.customer.email;
    if (email && r.pdfKey) {
      const pdf = await deps.integrations.storage.get('legal', r.pdfKey).catch(() => null);
      const t = project.tenant;
      await deps.integrations.mailer.send({
        ...buildEmail({
          to: email,
          subject: `${t.name} — ${provisional ? 'réception provisoire' : 'réception définitive'} ${r.number}`,
          title: provisional ? 'Réception provisoire signée' : 'Réception définitive signée',
          paragraphs: [
            await greeting(tx, project.customerId),
            `Veuillez trouver ci-joint le procès-verbal ${r.number} de ${provisional ? 'réception provisoire' : 'réception définitive'} du chantier « ${project.name} », signé le ${dateFr(r.signedAt ?? new Date())}.`,
            ...(provisional && r.reserves.length
              ? [
                  `Nous levons les ${r.reserves.length} réserves notées et vous tenons informé sur votre espace chantier.`,
                ]
              : []),
            ...(provisional && r.plannedFinalDate
              ? [`La réception définitive est prévue le ${dateFr(r.plannedFinalDate)}.`]
              : []),
          ],
          footer: footerOf(t),
          brandName: t.name,
          ...(t.email ? { replyTo: t.email } : {}),
        }),
        ...(pdf
          ? {
              attachments: [
                { filename: `${r.number}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' },
              ],
            }
          : {}),
        headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `reception:${r.id}` },
      });
    }
    await publish(ctx, project.id, ['timeline', 'project', 'tasks', 'reception', 'invoices']);
  },
};

/** Tâche d'une réserve terminée (terrain ou bureau) : la réserve est levée. */
export const reserveTaskDone: Consumer = {
  name: 'reserve-task-done',
  events: ['task.completed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('task.completed.v1', event.payload);
    const reserve = await tx.reserve.findUnique({ where: { taskId: p.taskId } });
    if (!reserve || reserve.liftedAt) return;
    await tx.reserve.update({ where: { id: reserve.id }, data: { liftedAt: event.occurredAt } });
    await emitEvent(tx, {
      tenantId: event.tenantId,
      type: 'reserve.lifted.v1',
      aggregateType: 'project',
      aggregateId: reserve.projectId,
      payload: { reserveId: reserve.id, projectId: reserve.projectId, receptionId: reserve.receptionId },
      actor: event.actor as never,
    });
  },
};

export const reserveLifted: Consumer = {
  name: 'reserve-lifted',
  events: ['reserve.lifted.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('reserve.lifted.v1', event.payload);
    const reserve = await tx.reserve.findUnique({ where: { id: p.reserveId } });
    const project = await tx.project.findUnique({ where: { id: p.projectId } });
    if (!reserve || !project) return;
    const open = await tx.reserve.count({ where: { projectId: project.id, liftedAt: null } });
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        projectId: project.id,
        customerId: project.customerId,
        type: 'reserve.lifted',
        title: `Réserve levée : ${reserve.description}`,
        body: open
          ? `${open} réserve${open > 1 ? 's' : ''} encore à lever`
          : 'Toutes les réserves sont levées',
        visibleToClient: true,
        actorLabel: (event.actor as { label?: string } | null)?.label ?? null,
        occurredAt: event.occurredAt,
        data: { reserveId: reserve.id },
      },
    });
    if (open === 0 && project.status === 'provisional_acceptance') await requestFinalInvoice(ctx, project.id);
    await publish(ctx, project.id, ['timeline', 'reception', 'tasks']);
  },
};

export const finalInvoiceRequested: Consumer = {
  name: 'final-invoice-requested',
  events: ['project.final_invoice_requested.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('project.final_invoice_requested.v1', event.payload);
    const project = await tx.project.findUnique({ where: { id: p.projectId } });
    if (!project) return;
    const r = await createFinalInvoiceDraft(tx, project.id, null);
    if (!r?.created) return;
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: r.id } });
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        projectId: project.id,
        customerId: project.customerId,
        type: 'invoice.final_drafted',
        title: 'Facture finale prête à émettre',
        body: `${formatEuros(invoice.totalGross)} TVAC · solde du contrat, acompte et états déduits`,
        amount: invoice.totalNet,
        occurredAt: event.occurredAt,
        data: { invoiceId: invoice.id },
      },
    });
    await notify(ctx, await recipients(ctx, project.managerUserId), {
      type: 'invoice.final_drafted',
      title: `Facture finale prête : ${project.name}`,
      body: `${formatEuros(invoice.totalGross)} TVAC à vérifier puis émettre`,
      link: `/facturation/${invoice.id}`,
    });
    await publish(ctx, project.id, ['timeline', 'reception', 'invoices', 'progress_statements']);
  },
};

export const projectClosed: Consumer = {
  name: 'project-closed',
  events: ['project.closed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('project.closed.v1', event.payload);
    const project = await tx.project.findUnique({ where: { id: p.projectId } });
    if (!project) return;
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        projectId: project.id,
        customerId: project.customerId,
        type: 'project.closed',
        title: 'Chantier clôturé',
        body: 'Rapport de rentabilité disponible',
        actorLabel: (event.actor as { label?: string } | null)?.label ?? null,
        occurredAt: event.occurredAt,
      },
    });
    const owners = (await office(tx, event.tenantId, ['owner'])).map((m) => m.userId);
    await notify(ctx, owners, {
      type: 'project.closed',
      title: `Chantier clôturé : ${project.name}`,
      body: 'Le rapport de rentabilité et les ajustements de prix proposés vous attendent.',
      link: `/chantiers/${project.id}?onglet=reception`,
    });
    await publish(ctx, project.id, ['timeline', 'project', 'reception']);
  },
};

export const receptionConsumers: Consumer[] = [
  receptionSigned,
  reserveTaskDone,
  reserveLifted,
  finalInvoiceRequested,
  projectClosed,
];
