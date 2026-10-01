/**
 * Tâches planifiées (pg-boss) : elles ne font qu'émettre des événements ; les effets (e-mails,
 * fil chronologique) restent dans les consommateurs (règle n°3).
 */
import { emitEvent, withSystem } from '@batimint/db';
import { isQuoteExpired, isQuoteReminderDue } from '@batimint/domain';
import type { PgBoss } from 'pg-boss';
import type { WorkerDeps } from './consumer';

export const QUOTE_MAINTENANCE_QUEUE = 'schedule.quote-maintenance';

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
}
