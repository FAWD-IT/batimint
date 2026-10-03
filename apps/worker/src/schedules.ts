/**
 * Tâches planifiées (pg-boss) : elles ne font qu'émettre des événements ; les effets (e-mails,
 * fil chronologique) restent dans les consommateurs (règle n°3).
 */
import { parseTenantSettings } from '@batimint/contracts';
import { emitEvent, withSystem } from '@batimint/db';
import {
  addDays,
  brusselsDate,
  documentCompliance,
  dueDunningStep,
  heldRetention,
  invoiceBalance,
  isQuoteExpired,
  isQuoteReminderDue,
  isWorkingDay,
  slotHalfDays,
  type Half,
} from '@batimint/domain';
import type { PgBoss } from 'pg-boss';
import type { WorkerDeps } from './consumer';
import { dunningPolicy } from './consumers/invoicing';

export const QUOTE_MAINTENANCE_QUEUE = 'schedule.quote-maintenance';
export const ARRIVAL_NOTICE_QUEUE = 'schedule.arrival-notice';
export const DAY_AHEAD_QUEUE = 'schedule.planning-day-ahead';
export const DUNNING_QUEUE = 'schedule.invoice-dunning';
export const PEPPOL_DELIVERY_QUEUE = 'schedule.peppol-delivery';
export const SUBCONTRACTOR_DOCUMENTS_QUEUE = 'schedule.subcontractor-documents';

/** Une date de début n'est annoncée au client qu'une fois stable (glisser-déposer successifs). */
export const ARRIVAL_SETTLE_MS = 10 * 60_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Devis échus → « expiré » ; devis envoyés depuis 7 jours sans signature → relance (une fois). */
export async function runQuoteMaintenance(deps: WorkerDeps, now: Date = new Date()) {
  return withSystem(deps.prisma, async (tx) => {
    const quotes = await tx.quote.findMany({
      where: { status: { in: ['sent', 'viewed'] }, isTemplate: false, archivedAt: null },
      select: {
        id: true,
        tenantId: true,
        status: true,
        sentAt: true,
        validUntil: true,
        reminderSentAt: true,
        currentVersionId: true,
      },
      take: 1000,
    });
    let expired = 0;
    let reminders = 0;
    for (const q of quotes) {
      if (isQuoteExpired(q, now)) {
        await tx.quote.update({ where: { id: q.id }, data: { status: 'expired' } });
        if (q.currentVersionId)
          await tx.quoteVersion.update({ where: { id: q.currentVersionId }, data: { status: 'expired' } });
        await emitEvent(tx, {
          tenantId: q.tenantId,
          type: 'quote.expired.v1',
          aggregateType: 'quote',
          aggregateId: q.id,
          payload: { quoteId: q.id },
          actor: { type: 'system', label: 'Échéance du devis' },
        });
        expired++;
      } else if (isQuoteReminderDue(q, now)) {
        await tx.quote.update({ where: { id: q.id }, data: { reminderSentAt: now } });
        await emitEvent(tx, {
          tenantId: q.tenantId,
          type: 'quote.reminder_due.v1',
          aggregateType: 'quote',
          aggregateId: q.id,
          payload: { quoteId: q.id },
          actor: { type: 'system', label: 'Relance automatique' },
        });
        reminders++;
      }
    }
    return { expired, reminders };
  });
}

/** Chantiers en préparation dont la date de début (tenue par le planning) n'est pas encore annoncée. */
export async function runArrivalNotices(deps: WorkerDeps, now: Date = new Date()) {
  return withSystem(deps.prisma, async (tx) => {
    const today = brusselsDate(now);
    const projects = await tx.project.findMany({
      where: {
        status: 'preparation',
        startDate: { not: null, gte: new Date(`${today}T00:00:00Z`) },
        updatedAt: { lt: new Date(now.getTime() - ARRIVAL_SETTLE_MS) },
      },
      select: { id: true, tenantId: true, startDate: true, arrivalNotifiedOn: true },
      take: 500,
    });
    let sent = 0;
    for (const p of projects) {
      const start = iso(p.startDate!);
      if (p.arrivalNotifiedOn && iso(p.arrivalNotifiedOn) === start) continue;
      await tx.project.update({ where: { id: p.id }, data: { arrivalNotifiedOn: p.startDate } });
      await emitEvent(tx, {
        tenantId: p.tenantId,
        type: 'project.arrival_scheduled.v1',
        aggregateType: 'project',
        aggregateId: p.id,
        payload: { projectId: p.id, startDate: start },
        actor: { type: 'system', label: 'Planning' },
      });
      sent++;
    }
    return { sent };
  });
}

/** À 18 h : le planning du prochain jour ouvré pour chaque personne qui a un compte. */
export async function runDayAhead(deps: WorkerDeps, now: Date = new Date()) {
  return withSystem(deps.prisma, async (tx) => {
    let day = addDays(brusselsDate(now), 1);
    while (!isWorkingDay(day)) day = addDays(day, 1);
    const date = new Date(`${day}T00:00:00Z`);
    const slots = await tx.scheduleSlot.findMany({
      where: { startDay: { lte: date }, endDay: { gte: date } },
    });
    const working = slots.filter((s) =>
      slotHalfDays({
        startDay: iso(s.startDay),
        startHalf: s.startHalf as Half,
        endDay: iso(s.endDay),
        endHalf: s.endHalf as Half,
      }).some((h) => h.day === day),
    );
    if (!working.length) return { sent: 0 };
    const teamIds = [...new Set(working.flatMap((s) => (s.teamId ? [s.teamId] : [])))];
    const employees = await tx.employee.findMany({
      where: {
        active: true,
        userId: { not: null },
        OR: [
          { id: { in: working.flatMap((s) => (s.employeeId ? [s.employeeId] : [])) } },
          { teamId: { in: teamIds } },
        ],
      },
      select: { id: true, tenantId: true, userId: true },
    });
    let sent = 0;
    for (const e of employees) {
      // Une seule fois par personne et par jour, même si la tâche tourne deux fois.
      const already = await tx.outboxEvent.findFirst({
        where: {
          type: 'planning.day_ahead.v1',
          aggregateId: e.id,
          payload: { path: ['day'], equals: day },
        },
        select: { id: true },
      });
      if (already) continue;
      await emitEvent(tx, {
        tenantId: e.tenantId,
        type: 'planning.day_ahead.v1',
        aggregateType: 'employee',
        aggregateId: e.id,
        payload: { employeeId: e.id, userId: e.userId!, day },
        actor: { type: 'system', label: 'Planning' },
      });
      sent++;
    }
    return { sent };
  });
}

/** Relances dues ce jour (05 §6) : une étape à la fois, jamais deux fois la même. */
export async function runDunning(deps: WorkerDeps, now: Date = new Date()) {
  return withSystem(deps.prisma, async (tx) => {
    const today = brusselsDate(now);
    const invoices = await tx.invoice.findMany({
      where: {
        status: { in: ['issued', 'sent', 'delivered', 'partially_paid'] },
        type: { not: 'credit_note' },
        remindersPaused: false,
        dueDate: { lt: new Date(`${today}T00:00:00Z`) },
      },
      include: {
        customer: { select: { kind: true } },
        tenant: { select: { settings: true } },
        dunning: { select: { step: true } },
      },
      take: 5000,
    });
    let due = 0;
    for (const i of invoices) {
      // Retenue libérée, le reste payé : seule la retenue est due, à sa propre échéance.
      const onlyRetention =
        i.retentionReleasedAt !== null &&
        i.retentionDueDate !== null &&
        i.amountPaid + i.amountCredited >= i.totalGross - i.retentionAmount;
      const dueDate = onlyRetention ? i.retentionDueDate! : i.dueDate!;
      if (iso(dueDate) >= today) continue;
      const step = dueDunningStep({
        dueDate: iso(dueDate),
        today,
        stepsSent: i.dunning.length,
        balance: invoiceBalance({
          totalGross: i.totalGross,
          retentionAmount: heldRetention(i),
          paid: i.amountPaid,
          credited: i.amountCredited,
        }),
        customerKind: i.customer.kind,
        policy: dunningPolicy(parseTenantSettings(i.tenant.settings)),
      });
      if (!step) continue;
      const already = await tx.outboxEvent.findFirst({
        where: {
          type: 'invoice.reminder_due.v1',
          aggregateId: i.id,
          payload: { path: ['step'], equals: step.step },
        },
        select: { id: true },
      });
      if (already) continue;
      await emitEvent(tx, {
        tenantId: i.tenantId,
        type: 'invoice.reminder_due.v1',
        aggregateType: 'invoice',
        aggregateId: i.id,
        payload: { invoiceId: i.id, step: step.step },
        actor: { type: 'system', label: 'Relance automatique' },
      });
      due++;
    }
    return { due };
  });
}

/** Suivi des factures envoyées par Peppol : statut de livraison chez le fournisseur d'accès. */
export async function runPeppolDelivery(deps: WorkerDeps) {
  return withSystem(deps.prisma, async (tx) => {
    const invoices = await tx.invoice.findMany({
      where: { deliveryChannel: 'peppol', deliveryStatus: 'sent', peppolDocumentId: { not: null } },
      select: { id: true, tenantId: true, peppolDocumentId: true },
      take: 500,
    });
    let updated = 0;
    for (const i of invoices) {
      const s = await deps.integrations.peppol.getDeliveryStatus(i.peppolDocumentId!).catch(() => null);
      if (!s || s.status === 'sent' || s.status === 'queued') continue;
      await emitEvent(tx, {
        tenantId: i.tenantId,
        type: 'invoice.delivery_updated.v1',
        aggregateType: 'invoice',
        aggregateId: i.id,
        payload: { invoiceId: i.id, status: s.status, message: s.message ?? null },
        actor: { type: 'system', label: 'Peppol' },
      });
      updated++;
    }
    return { updated };
  });
}

/**
 * Échéances des documents des sous-traitants (03 §9) : une alerte quand le document en vigueur
 * expire dans 30 jours, une autre quand il a expiré ; jamais deux fois pour le même état.
 */
export async function runSubcontractorDocumentAlerts(deps: WorkerDeps, now: Date = new Date()) {
  const today = brusselsDate(now);
  return withSystem(deps.prisma, async (tx) => {
    const docs = await tx.subcontractorDocument.findMany({
      where: { supplier: { archivedAt: null } },
      select: { id: true, tenantId: true, supplierId: true, kind: true, expiresOn: true, alertState: true },
    });
    const bySupplier = new Map<string, typeof docs>();
    for (const d of docs) bySupplier.set(d.supplierId, [...(bySupplier.get(d.supplierId) ?? []), d]);
    let alerts = 0;
    for (const list of bySupplier.values()) {
      const kinds = [...new Set(list.map((d) => d.kind))] as never[];
      const { requirements } = documentCompliance(
        list.map((d) => ({
          id: d.id,
          kind: d.kind as never,
          expiresOn: d.expiresOn ? iso(d.expiresOn) : null,
        })),
        today,
        kinds,
      );
      for (const r of requirements) {
        if (r.status !== 'expiring' && r.status !== 'expired') continue;
        const d = list.find((x) => x.id === r.documentId)!;
        if (d.alertState === r.status) continue;
        await tx.subcontractorDocument.update({ where: { id: d.id }, data: { alertState: r.status } });
        await emitEvent(tx, {
          tenantId: d.tenantId,
          type: 'subcontractor.document_expiring.v1',
          aggregateType: 'supplier',
          aggregateId: d.supplierId,
          payload: { supplierId: d.supplierId, documentId: d.id, state: r.status },
          actor: { type: 'system', label: 'Batimint' },
        });
        alerts++;
      }
    }
    return { alerts };
  });
}

export async function registerSchedules(
  boss: PgBoss,
  deps: WorkerDeps,
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void },
): Promise<void> {
  await boss.createQueue(QUOTE_MAINTENANCE_QUEUE, { retryLimit: 2 }).catch(() => undefined);
  await boss.schedule(QUOTE_MAINTENANCE_QUEUE, '*/15 * * * *', {}, { tz: 'Europe/Brussels' });
  await boss.work(QUOTE_MAINTENANCE_QUEUE, async () => {
    const r = await runQuoteMaintenance(deps);
    if (r.expired || r.reminders) logger.info(r, 'devis : relances et échéances');
  });
  await boss.createQueue(ARRIVAL_NOTICE_QUEUE, { retryLimit: 2 }).catch(() => undefined);
  await boss.schedule(ARRIVAL_NOTICE_QUEUE, '*/5 * * * *', {}, { tz: 'Europe/Brussels' });
  await boss.work(ARRIVAL_NOTICE_QUEUE, async () => {
    const r = await runArrivalNotices(deps);
    if (r.sent) logger.info(r, 'planning : dates de début annoncées aux clients');
  });
  await boss.createQueue(DAY_AHEAD_QUEUE, { retryLimit: 2 }).catch(() => undefined);
  await boss.schedule(DAY_AHEAD_QUEUE, '0 18 * * *', {}, { tz: 'Europe/Brussels' });
  await boss.work(DAY_AHEAD_QUEUE, async () => {
    const r = await runDayAhead(deps);
    if (r.sent) logger.info(r, 'planning du lendemain envoyé');
  });
  await boss.createQueue(DUNNING_QUEUE, { retryLimit: 2 }).catch(() => undefined);
  await boss.schedule(DUNNING_QUEUE, '0 9 * * *', {}, { tz: 'Europe/Brussels' });
  await boss.work(DUNNING_QUEUE, async () => {
    const r = await runDunning(deps);
    if (r.due) logger.info(r, 'factures : relances dues');
  });
  await boss.createQueue(PEPPOL_DELIVERY_QUEUE, { retryLimit: 2 }).catch(() => undefined);
  await boss.schedule(PEPPOL_DELIVERY_QUEUE, '*/15 * * * *', {}, { tz: 'Europe/Brussels' });
  await boss.work(PEPPOL_DELIVERY_QUEUE, async () => {
    const r = await runPeppolDelivery(deps);
    if (r.updated) logger.info(r, 'factures : livraisons Peppol');
  });
  await boss.createQueue(SUBCONTRACTOR_DOCUMENTS_QUEUE, { retryLimit: 2 }).catch(() => undefined);
  await boss.schedule(SUBCONTRACTOR_DOCUMENTS_QUEUE, '30 7 * * *', {}, { tz: 'Europe/Brussels' });
  await boss.work(SUBCONTRACTOR_DOCUMENTS_QUEUE, async () => {
    const r = await runSubcontractorDocumentAlerts(deps);
    if (r.alerts) logger.info(r, 'sous-traitants : documents à renouveler');
  });
}
