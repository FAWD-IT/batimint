import { REALTIME_PG_CHANNEL } from '@batimint/contracts';
import { withSystem, withTenant } from '@batimint/db';
import type { Consumer, ConsumedEvent, WorkerDeps } from './consumer';

export type RunResult = 'done' | 'skipped' | 'missing';

async function loadEvent(deps: WorkerDeps, eventId: string): Promise<ConsumedEvent | null> {
  return withSystem(deps.prisma, (tx) => tx.outboxEvent.findUnique({ where: { id: eventId } }));
}

/**
 * Exécute un consommateur pour un événement, dans le contexte tenant de l'événement.
 * L'insertion de ProcessedEvent et l'effet partagent la transaction : rejouer ne double rien,
 * et un échec n'enregistre rien (le job sera retenté par pg-boss).
 */
export async function runConsumer(deps: WorkerDeps, consumer: Consumer, eventId: string): Promise<RunResult> {
  const event = await loadEvent(deps, eventId);
  if (!event) return 'missing';
  return withTenant(deps.prisma, event.tenantId, null, async (tx) => {
    const inserted = await tx.$queryRaw<{ event_id: string }[]>`
      INSERT INTO processed_events (consumer, event_id, tenant_id)
      VALUES (${consumer.name}, ${event.id}::uuid, ${event.tenantId}::uuid)
      ON CONFLICT DO NOTHING
      RETURNING event_id`;
    if (inserted.length === 0) return 'skipped';
    await consumer.handle({
      tx,
      event,
      deps,
      publish: async (message) => {
        const payload = JSON.stringify({
          ...message,
          tenantId: event.tenantId,
          at: new Date().toISOString(),
        });
        await tx.$executeRaw`SELECT pg_notify(${REALTIME_PG_CHANNEL}, ${payload})`;
      },
    });
    return 'done';
  });
}
