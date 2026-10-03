/**
 * Chantier (04, catalogue d'événements) — effets secondaires idempotents :
 *  - change_order.sent → lien du portail chantier et e-mail au client (PDF joint) ;
 *  - change_order.signed → postes, contrat, tâches et date de fin mis à jour, fil, notification ;
 *  - project.portal_shared → e-mail avec un lien de suivi ;
 *  - fil du chantier (statut, avenants, tâches, photos, coûts, dérive) ;
 *  - commentaires : mentions @, questions du client, réponses envoyées au client ;
 *  - dérive budgétaire : alerte une fois par poste quand l'engagé dépasse le seuil ;
 *  - temps réel : cockpit (project:{id}), listes (tenant), portail (portal:project:{id}).
 */
import {
  parseEventPayload,
  parseTenantSettings,
  projectChannel,
  projectPortalChannel,
  tenantChannel,
} from '@batimint/contracts';
import { createPortalToken, emitEvent, loadProjectNumbers, portalUrl, type Tx } from '@batimint/db';
import {
  type ChangeOrderLineInput,
  computeChangeOrder,
  dec,
  formatEuros,
  mentionsToPlain,
  shiftEndDate,
  type VatRegime,
} from '@batimint/domain';
import { buildEmail } from '@batimint/integrations';
import type { Consumer, ConsumerContext } from '../consumer';
import { dateFr, notify, office } from './shared';

const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const firstLine = (s: string) => s.split('\n')[0]!.slice(0, 300);

function coInputs(
  lines: {
    id: string;
    description: string;
    unit: string;
    quantity: { toString(): string };
    unitPrice: bigint;
    unitCost: bigint;
    laborHours: { toString(): string };
    vatRegime: string;
    discountPercent: { toString(): string } | null;
    budgetLineId: string | null;
    newPostLabel: string | null;
  }[],
): ChangeOrderLineInput[] {
  return lines.map((l) => ({
    id: l.id,
    description: l.description,
    unit: l.unit,
    quantity: l.quantity.toString(),
    unitPrice: l.unitPrice,
    unitCost: l.unitCost,
    laborHours: l.laborHours.toString(),
    vatRegime: l.vatRegime as VatRegime,
    discountPercent: l.discountPercent?.toString() ?? '0',
    budgetLineId: l.budgetLineId,
    newPostLabel: l.newPostLabel,
  }));
}

export async function greeting(tx: Tx, customerId: string | null): Promise<string> {
  const c = customerId ? await tx.customer.findUnique({ where: { id: customerId } }) : null;
  const name = c?.firstName ? `${c.firstName} ${c.lastName ?? ''}`.trim() : c?.displayName;
  return name ? `Bonjour ${name},` : 'Bonjour,';
}

export function footerOf(t: { name: string; phone: string | null; email: string | null }): string {
  return `${t.name}${t.phone ? ` · ${t.phone}` : ''}${t.email ? ` · ${t.email}` : ''}`;
}

/** Destinataires internes d'un événement de chantier : le responsable, sinon le bureau. */
async function projectRecipients(tx: Tx, tenantId: string, managerUserId: string | null): Promise<string[]> {
  const ids = (await office(tx, tenantId)).map((m) => m.userId);
  return managerUserId ? [managerUserId, ...ids] : ids;
}

async function publishProject(
  ctx: ConsumerContext,
  projectId: string,
  topics: string[],
  options: { portal?: boolean; list?: boolean } = {},
): Promise<void> {
  for (const topic of topics)
    await ctx.publish({ channel: projectChannel(projectId), topic, ref: projectId });
  if (options.list !== false)
    await ctx.publish({ channel: tenantChannel(ctx.event.tenantId), topic: 'projects', ref: projectId });
  if (options.portal)
    await ctx.publish({ channel: projectPortalChannel(projectId), topic: 'project', ref: projectId });
}

// ---------------------------------------------------------------------------
// E-mails au client
// ---------------------------------------------------------------------------

export const changeOrderEmail: Consumer = {
  name: 'change-order-email',
  events: ['change_order.sent.v1'],
  async handle({ tx, event, deps }) {
    const p = parseEventPayload('change_order.sent.v1', event.payload);
    const co = await tx.changeOrder.findUnique({
      where: { id: p.changeOrderId },
      include: { project: { include: { tenant: true } } },
    });
    if (!co || co.status !== 'sent') return;
    const project = co.project;
    const t = project.tenant;
    const { token } = await createPortalToken(tx, {
      tenantId: event.tenantId,
      kind: 'project',
      projectId: project.id,
      customerId: project.customerId,
      email: p.email,
    });
    const pdf = co.pdfKey
      ? await deps.integrations.storage.get('uploads', co.pdfKey).catch(() => null)
      : null;
    const newEnd = co.delayDays > 0 ? shiftEndDate(isoDay(project.endDate), co.delayDays) : null;
    await deps.integrations.mailer.send({
      ...buildEmail({
        to: p.email,
        subject: `${t.name} — avenant n°${co.ordinal} à valider : ${co.title}`,
        title: `Avenant n°${co.ordinal} à valider`,
        paragraphs: [
          await greeting(tx, project.customerId),
          p.message ?? `Nous vous proposons un avenant à votre chantier « ${project.name} » : ${co.title}.`,
          `Montant : ${formatEuros(co.totalNet)} HTVA, soit ${formatEuros(co.totalGross)} TVAC. ${
            co.delayDays > 0
              ? `Les travaux sont prolongés de ${co.delayDays} jour${co.delayDays > 1 ? 's' : ''} ouvrable${co.delayDays > 1 ? 's' : ''}${newEnd ? ` (fin prévue le ${dateFr(new Date(`${newEnd}T12:00:00Z`))})` : ''}.`
              : 'La date de fin prévue ne change pas.'
          }`,
          'Vous pouvez le consulter, nous poser une question ou le valider en ligne. Le PDF est joint à cet e-mail.',
        ],
        cta: { label: 'Voir et valider l’avenant', href: portalUrl(deps.appUrl, token) },
        footer: footerOf(t),
        ...(t.email ? { replyTo: t.email } : {}),
      }),
      ...(pdf
        ? {
            attachments: [
              {
                filename: `${co.number ?? `avenant-${co.ordinal}`}.pdf`,
                content: Buffer.from(pdf),
                contentType: 'application/pdf',
              },
            ],
          }
        : {}),
      headers: { 'X-Batimint-Tenant': event.tenantId, 'X-Batimint-Document': `change_order:${co.id}` },
    });
  },
};

export const projectPortalShare: Consumer = {
  name: 'project-portal-share',
  events: ['project.portal_shared.v1'],
  async handle({ tx, event, deps }) {
    const p = parseEventPayload('project.portal_shared.v1', event.payload);
    const project = await tx.project.findUnique({ where: { id: p.projectId }, include: { tenant: true } });
    if (!project) return;
    const { token } = await createPortalToken(tx, {
      tenantId: event.tenantId,
      kind: 'project',
      projectId: project.id,
      customerId: project.customerId,
      email: p.email,
    });
    const t = project.tenant;
    await deps.integrations.mailer.send(
      buildEmail({
        to: p.email,
        subject: `${t.name} — suivez votre chantier « ${project.name} »`,
        title: 'Suivez votre chantier en direct',
        paragraphs: [
          await greeting(tx, project.customerId),
          p.message ??
            'Retrouvez l’avancement de votre chantier, les photos, les documents et les avenants à valider sur votre espace.',
          'Ce lien vous est personnel : ne le transférez pas.',
        ],
        cta: { label: 'Suivre mon chantier', href: portalUrl(deps.appUrl, token) },
        footer: footerOf(t),
        ...(t.email ? { replyTo: t.email } : {}),
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// Avenant signé : budget, contrat, tâches, planning
// ---------------------------------------------------------------------------

export const changeOrderSignedProject: Consumer = {
  name: 'change-order-signed-project',
  events: ['change_order.signed.v1'],
  async handle(ctx) {
    const { tx, event } = ctx;
    const p = parseEventPayload('change_order.signed.v1', event.payload);
    const co = await tx.changeOrder.findUnique({
      where: { id: p.changeOrderId },
      include: { lines: { orderBy: { position: 'asc' } }, project: true },
    });
    if (!co || co.status !== 'signed') return;
    // Rejeu : les tâches de l'avenant existent déjà, tout a été appliqué dans la même transaction.
    if (co.lines.length && (await tx.task.findFirst({ where: { changeOrderLineId: co.lines[0]!.id } })))
      return;
    const project = co.project;
    const totals = computeChangeOrder(coInputs(co.lines));
    const lineNet = new Map(totals.lines.map((l) => [l.id, l]));
    const targetId = new Map<string, string>();
    let position =
      ((await tx.budgetLine.aggregate({ where: { projectId: project.id }, _max: { position: true } }))._max
        .position ?? -1) + 1;
    for (const target of totals.byTarget) {
      if (target.budgetLineId) {
        const bl = await tx.budgetLine.findFirst({
          where: { id: target.budgetLineId, projectId: project.id },
        });
        if (bl) {
          await tx.budgetLine.update({
            where: { id: bl.id },
            data: {
              saleAmount: { increment: target.sale },
              budgetedCost: { increment: target.cost },
              laborHours: dec(bl.laborHours.toString()).plus(target.laborHours).toString(),
            },
          });
          targetId.set(target.key, bl.id);
          continue;
        }
      }
      const created = await tx.budgetLine.create({
        data: {
          tenantId: event.tenantId,
          projectId: project.id,
          position: position++,
          label: target.label ?? co.title,
          budgetedCost: target.cost,
          saleAmount: target.sale,
          laborHours: target.laborHours.toString(),
          changeOrderId: co.id,
        },
      });
      targetId.set(target.key, created.id);
    }
    let taskPosition =
      ((await tx.task.aggregate({ where: { projectId: project.id }, _max: { position: true } }))._max
        .position ?? -1) + 1;
    for (const l of co.lines) {
      const key = l.budgetLineId ?? `new:${(l.newPostLabel ?? '').trim().toLowerCase() || 'avenant'}`;
      const lt = lineNet.get(l.id);
      await tx.task.create({
        data: {
          tenantId: event.tenantId,
          projectId: project.id,
          budgetLineId: targetId.get(key) ?? null,
          changeOrderLineId: l.id,
          position: taskPosition++,
          title: firstLine(l.description),
          quantity: l.quantity.toString(),
          unit: l.unit,
          plannedHours: lt?.laborHours.toDecimalPlaces(2).toString() ?? '0',
          amount: lt?.netAmount ?? 0n,
        },
      });
    }
    const newEnd = shiftEndDate(isoDay(project.endDate), co.delayDays);
    await tx.project.update({
      where: { id: project.id },
      data: {
        contractAmount: { increment: co.totalNet },
        ...(co.delayDays > 0 && newEnd ? { endDate: new Date(`${newEnd}T00:00:00Z`) } : {}),
      },
    });
    const signer = (event.actor as { label?: string } | null)?.label ?? 'le client';
    await tx.timelineEntry.create({
      data: {
        tenantId: event.tenantId,
        eventId: event.id,
        type: 'change_order.signed',
        title: `Avenant n°${co.ordinal} signé par ${signer}`,
        body: `${co.title} · ${co.delayDays > 0 ? 'budget et planning mis à jour' : 'budget mis à jour'}`,
        customerId: project.customerId,
        projectId: project.id,
        changeOrderId: co.id,
        amount: co.totalNet,
        visibleToClient: true,
        actorLabel: signer,
        occurredAt: event.occurredAt,
      },
    });
    await notify(ctx, await projectRecipients(tx, event.tenantId, project.managerUserId), {
      type: 'change_order.signed',
      title: `Avenant n°${co.ordinal} signé par ${signer}`,
      body: `${project.name} — ${co.title} : ${formatEuros(co.totalNet)} HTVA`,
      link: `/chantiers/${project.id}?avenant=${co.id}`,
    });
    await publishProject(ctx, project.id, ['project', 'timeline', 'tasks', 'change_orders'], {
      portal: true,
    });
  },
};

// ---------------------------------------------------------------------------
// Fil du chantier
// ---------------------------------------------------------------------------

const STATUS_TITLES: Record<string, (from: string) => string> = {
  in_progress: (from) => (from === 'suspended' ? 'Chantier repris' : 'Travaux démarrés'),
  suspended: () => 'Chantier suspendu',
  preparation: () => 'Chantier remis en préparation',
};

const PHOTO_GROUP_MS = 30 * 60_000;

export const projectTimeline: Consumer = {
  name: 'project-timeline',
  events: [
    'project.status_changed.v1',
    'change_order.sent.v1',
    'change_order.refused.v1',
    'task.completed.v1',
    'project.cost_recorded.v1',
    'budget.drift_detected.v1',
    'attachment.added.v1',
  ],
  async handle(ctx) {
    const { tx, event } = ctx;
    const actor = (event.actor as { label?: string } | null)?.label ?? null;
    const base = {
      tenantId: event.tenantId,
      eventId: event.id,
      actorLabel: actor,
      occurredAt: event.occurredAt,
    };

    if (event.type === 'attachment.added.v1') {
      const p = parseEventPayload('attachment.added.v1', event.payload);
      if (p.ownerType !== 'project') return;
      const a = await tx.attachment.findUnique({ where: { id: p.attachmentId } });
      const project = await tx.project.findUnique({ where: { id: p.ownerId } });
      if (!a || !project) return;
      const task = a.taskId ? await tx.task.findUnique({ where: { id: a.taskId } }) : null;
      if (a.kind === 'photo') {
        // Plusieurs photos envoyées d'affilée par la même personne : une seule entrée (« 4 photos »).
        const recent = await tx.timelineEntry.findFirst({
          where: {
            projectId: project.id,
            type: 'photo.added',
            actorLabel: actor,
            occurredAt: { gte: new Date(event.occurredAt.getTime() - PHOTO_GROUP_MS) },
          },
          orderBy: { occurredAt: 'desc' },
        });
        if (recent) {
          const ids = [...((recent.data as { photoIds?: string[] } | null)?.photoIds ?? []), a.id];
          const visible = recent.visibleToClient || a.visibleToClient;
          await tx.timelineEntry.update({
            where: { id: recent.id },
            data: {
              title: `${actor ?? 'Quelqu’un'} a ajouté ${ids.length} photos`,
              data: { photoIds: ids },
              visibleToClient: visible,
              body:
                [task?.title ?? a.caption, visible ? 'visibles par le client' : null]
                  .filter(Boolean)
                  .join(' · ') || null,
            },
          });
        } else {
          await tx.timelineEntry.create({
            data: {
              ...base,
              type: 'photo.added',
              title: `${actor ?? 'Quelqu’un'} a ajouté une photo`,
              body:
                [task?.title ?? a.caption, a.visibleToClient ? 'visible par le client' : null]
                  .filter(Boolean)
                  .join(' · ') || null,
              customerId: project.customerId,
              projectId: project.id,
              visibleToClient: a.visibleToClient,
              data: { photoIds: [a.id] },
            },
          });
        }
        await publishProject(ctx, project.id, ['timeline', 'attachments'], {
          portal: a.visibleToClient,
          list: false,
        });
        return;
      }
      if (a.kind === 'document') {
        await tx.timelineEntry.create({
          data: {
            ...base,
            type: 'document.added',
            title: `Document ajouté : ${a.caption ?? a.fileName}`,
            customerId: project.customerId,
            projectId: project.id,
            visibleToClient: a.visibleToClient,
          },
        });
        await publishProject(ctx, project.id, ['timeline', 'attachments'], {
          portal: a.visibleToClient,
          list: false,
        });
      }
      return;
    }

    const projectId = (event.payload as { projectId: string }).projectId;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    const common = { ...base, customerId: project.customerId, projectId };

    switch (event.type) {
      case 'project.status_changed.v1': {
        const p = parseEventPayload('project.status_changed.v1', event.payload);
        const title = STATUS_TITLES[p.to]?.(p.from);
        if (!title) return;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'project.status_changed',
            title,
            body: p.reason ?? null,
            visibleToClient: true,
          },
        });
        if (p.to === 'suspended')
          await notify(ctx, await projectRecipients(tx, event.tenantId, project.managerUserId), {
            type: 'project.suspended',
            title: `${project.name} suspendu`,
            ...(p.reason ? { body: p.reason } : {}),
            link: `/chantiers/${project.id}`,
          });
        await publishProject(ctx, projectId, ['timeline', 'project'], { portal: true });
        return;
      }
      case 'change_order.sent.v1': {
        const p = parseEventPayload('change_order.sent.v1', event.payload);
        const co = await tx.changeOrder.findUnique({ where: { id: p.changeOrderId } });
        if (!co) return;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'change_order.sent',
            title: `Avenant n°${co.ordinal} envoyé au client`,
            body: `${co.title} · ${p.email}`,
            changeOrderId: co.id,
            amount: co.totalNet,
          },
        });
        await publishProject(ctx, projectId, ['timeline', 'change_orders', 'project'], { portal: true });
        return;
      }
      case 'change_order.refused.v1': {
        const p = parseEventPayload('change_order.refused.v1', event.payload);
        const co = await tx.changeOrder.findUnique({ where: { id: p.changeOrderId } });
        if (!co) return;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'change_order.refused',
            title: `Avenant n°${co.ordinal} refusé`,
            body: [co.title, p.reason].filter(Boolean).join(' · '),
            changeOrderId: co.id,
          },
        });
        await notify(ctx, await projectRecipients(tx, event.tenantId, project.managerUserId), {
          type: 'change_order.refused',
          title: `Avenant n°${co.ordinal} refusé`,
          body: [project.name, p.reason].filter(Boolean).join(' — '),
          link: `/chantiers/${project.id}?avenant=${co.id}`,
        });
        await publishProject(ctx, projectId, ['timeline', 'change_orders', 'project'], { portal: true });
        return;
      }
      case 'task.completed.v1': {
        const p = parseEventPayload('task.completed.v1', event.payload);
        const task = await tx.task.findUnique({ where: { id: p.taskId } });
        if (!task) return;
        const post = task.budgetLineId
          ? await tx.budgetLine.findUnique({ where: { id: task.budgetLineId } })
          : null;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'task.completed',
            title: `Tâche terminée : ${task.title}`,
            body: [post?.label, actor ? `par ${actor}` : null].filter(Boolean).join(' · ') || null,
          },
        });
        await publishProject(ctx, projectId, ['timeline', 'tasks', 'project'], { portal: true });
        return;
      }
      case 'project.cost_recorded.v1': {
        const p = parseEventPayload('project.cost_recorded.v1', event.payload);
        // Main-d'œuvre, factures, BC et matériel ont leur propre entrée (pointage, facture rapprochée,
        // BC envoyé, matériel affecté ou rendu) : le coût d'usage est recalculé chaque jour.
        if (['labour', 'supplier_invoice', 'purchase_order', 'equipment'].includes(p.category)) {
          await publishProject(ctx, projectId, ['project', 'budget']);
          return;
        }
        const cost = await tx.projectCost.findUnique({ where: { id: p.costId } });
        if (!cost) return;
        const post = cost.budgetLineId
          ? await tx.budgetLine.findUnique({ where: { id: cost.budgetLineId } })
          : null;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'project.cost_recorded',
            title: `Coût imputé : ${cost.label}`,
            body: post ? `Poste ${post.label}` : 'Non ventilé',
            amount: -cost.amount,
          },
        });
        await publishProject(ctx, projectId, ['timeline', 'project']);
        return;
      }
      case 'budget.drift_detected.v1': {
        const p = parseEventPayload('budget.drift_detected.v1', event.payload);
        const post = await tx.budgetLine.findUnique({ where: { id: p.budgetLineId } });
        if (!post) return;
        const over = dec(p.committed).dividedBy(p.budgetedCost).minus(1).times(100).round().toNumber();
        const title = `Le poste ${post.label} dépasse son budget de ${over} %`;
        await tx.timelineEntry.create({
          data: {
            ...common,
            type: 'budget.drift_detected',
            title,
            body: 'Prévoir un avenant ?',
            data: { budgetLineId: post.id },
          },
        });
        await notify(ctx, await projectRecipients(tx, event.tenantId, project.managerUserId), {
          type: 'budget.drift',
          title,
          body: project.name,
          link: `/chantiers/${project.id}`,
        });
        await publishProject(ctx, projectId, ['timeline', 'project']);
        return;
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Dérive budgétaire (04 « Alerte de dérive »)
// ---------------------------------------------------------------------------

export const budgetDriftWatch: Consumer = {
  name: 'budget-drift-watch',
  events: ['project.cost_recorded.v1'],
  async handle({ tx, event }) {
    const projectId = (event.payload as { projectId: string }).projectId;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: event.tenantId },
      select: { settings: true },
    });
    const threshold = dec(parseTenantSettings(t.settings).driftThresholdPercent).dividedBy(100).toString();
    const n = (await loadProjectNumbers(tx, [project], threshold)).get(project.id);
    if (!n) return;
    if (!n.fin.driftingLineIds.length) return;
    // Deux coûts traités en parallèle ne doivent pas lever deux alertes : verrou par chantier, puis
    // vérification dans l'outbox (conservée), qui est écrite dans la même transaction que l'alerte.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`drift:${projectId}`}))`;
    for (const id of n.fin.driftingLineIds) {
      // Une alerte par poste : on ne relance pas tant que le poste reste en dérive.
      const already = await tx.outboxEvent.findFirst({
        where: {
          aggregateId: projectId,
          type: 'budget.drift_detected.v1',
          payload: { path: ['budgetLineId'], equals: id },
        },
        select: { id: true },
      });
      if (already) continue;
      const r = n.fin.lines.find((l) => l.id === id)!;
      await emitEvent(tx, {
        tenantId: event.tenantId,
        type: 'budget.drift_detected.v1',
        aggregateType: 'project',
        aggregateId: projectId,
        payload: {
          projectId,
          budgetLineId: id,
          committed: r.committedTotal.toString(),
          budgetedCost: r.budgetedCost.toString(),
        },
        actor: { type: 'system', label: 'Batimint' },
      });
    }
  },
};

// ---------------------------------------------------------------------------
// Commentaires : mentions, questions du client, réponses
// ---------------------------------------------------------------------------

export const commentNotifications: Consumer = {
  name: 'comment-notifications',
  events: ['comment.added.v1'],
  async handle(ctx) {
    const { tx, event, deps } = ctx;
    const p = parseEventPayload('comment.added.v1', event.payload);
    const c = await tx.comment.findUnique({ where: { id: p.commentId } });
    if (!c || c.deletedAt) return;
    const project = p.projectId
      ? await tx.project.findUnique({ where: { id: p.projectId }, include: { tenant: true } })
      : null;
    const co =
      p.subjectType === 'change_order'
        ? await tx.changeOrder.findUnique({ where: { id: p.subjectId } })
        : null;
    const subject = co ? `l’avenant n°${co.ordinal}` : project ? project.name : 'un élément';
    const link = project ? `/chantiers/${project.id}${co ? `?avenant=${co.id}` : ''}` : '/';
    const text = mentionsToPlain(c.body).slice(0, 280);

    if (p.mentions.length)
      await notify(ctx, p.mentions, {
        type: 'comment.mention',
        title: `${c.authorLabel} vous a mentionné sur ${subject}`,
        body: text,
        link,
      });
    if (p.fromClient && project) {
      await notify(ctx, await projectRecipients(tx, event.tenantId, project.managerUserId), {
        type: 'comment.client_question',
        title: `Question de ${c.authorLabel} sur ${subject}`,
        body: text,
        link,
      });
    }
    // Réponse partagée avec le client : il est prévenu par e-mail avec un lien vers son portail.
    if (!p.fromClient && c.visibleToClient && project) {
      const customer = await tx.customer.findUnique({ where: { id: project.customerId } });
      if (customer?.email) {
        const { token } = await createPortalToken(tx, {
          tenantId: event.tenantId,
          kind: 'project',
          projectId: project.id,
          customerId: customer.id,
          email: customer.email,
        });
        await deps.integrations.mailer.send(
          buildEmail({
            to: customer.email,
            subject: `${project.tenant.name} — réponse à votre question sur ${subject}`,
            title: 'Vous avez une réponse',
            paragraphs: [await greeting(tx, customer.id), `${c.authorLabel} vous a répondu :`, text],
            cta: { label: 'Voir sur mon espace', href: portalUrl(deps.appUrl, token) },
            footer: footerOf(project.tenant),
            ...(project.tenant.email ? { replyTo: project.tenant.email } : {}),
          }),
        );
      }
    }
    if (project)
      await publishProject(ctx, project.id, ['timeline', 'comments', 'project'], {
        portal: c.visibleToClient,
        list: false,
      });
  },
};

// ---------------------------------------------------------------------------
// Temps réel pour les mutations faites par l'API (déjà commitées avec l'événement)
// ---------------------------------------------------------------------------

export const projectRealtime: Consumer = {
  name: 'project-realtime',
  events: ['project.updated.v1', 'task.updated.v1', 'change_order.created.v1', 'project.portal_shared.v1'],
  async handle(ctx) {
    const projectId = (ctx.event.payload as { projectId: string }).projectId;
    const fields = (ctx.event.payload as { fields?: string[] }).fields ?? [];
    const topics =
      ctx.event.type === 'task.updated.v1'
        ? ['tasks', 'project']
        : ctx.event.type === 'change_order.created.v1'
          ? ['change_orders', 'project']
          : [
              'project',
              ...(fields.includes('attachments') ? ['attachments'] : []),
              ...(fields.includes('change_orders') ? ['change_orders'] : []),
              ...(fields.includes('comments') ? ['comments', 'timeline'] : []),
            ];
    await publishProject(ctx, projectId, topics, {
      portal: ['attachments', 'startDate', 'endDate', 'name', 'managerUserId'].some((f) =>
        fields.includes(f),
      ),
    });
  },
};
