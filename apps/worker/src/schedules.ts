/**
 * Tâches planifiées (pg-boss) : elles ne font qu'émettre des événements ; les effets (e-mails,
 * fil chronologique) restent dans les consommateurs (règle n°3).
 */
import { emitEvent, withSystem } from '@batimint/db';
import {
  addDays,
  brusselsDate,
  isQuoteExpired,
  isQuoteReminderDue,
  isWorkingDay,
  slotHalfDays,
  type Half,
} from '@batimint/domain';
import type { PgBoss } from 'pg-boss';
import type { WorkerDeps } from './consumer';

export const QUOTE_MAINTENANCE_QUEUE = 'schedule.quote-maintenance';
export const ARRIVAL_NOTICE_QUEUE = 'schedule.arrival-notice';
export const DAY_AHEAD_QUEUE = 'schedule.planning-day-ahead';

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
}
