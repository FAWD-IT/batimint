import { type JobResult, PgBoss } from 'pg-boss';
import { type Consumer, queueName } from './consumer';
import { CONSUMERS } from './consumers';
import { runConsumer } from './runner';
import type { WorkerDeps } from './consumer';

export const DEAD_LETTER_QUEUE = 'dead-letter';

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss({
    connectionString,
    schema: 'pgboss',
    application_name: 'batimint-worker',
    useListenNotify: true,
    max: 5,
    // Le schéma pgboss est créé par la migration (rôle propriétaire) et appartient au rôle applicatif.
    createSchema: false,
  });
}

/** Crée les files (retries à backoff exponentiel, file morte) et branche les consommateurs. */
export async function registerConsumers(
  boss: PgBoss,
  deps: WorkerDeps,
  logger: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void },
  consumers: readonly Consumer[] = CONSUMERS,
): Promise<void> {
  await boss.createQueue(DEAD_LETTER_QUEUE, { retentionSeconds: 30 * 86400 }).catch(() => undefined);
  for (const consumer of consumers) {
    const name = queueName(consumer);
    await boss
      .createQueue(name, {
        retryLimit: 10,
        retryDelay: 2,
        retryBackoff: true,
        retryDelayMax: 900,
        deadLetter: DEAD_LETTER_QUEUE,
        notify: true,
      })
      .catch(() => undefined);
    await boss.work<{ eventId: string; type: string }>(
      name,
      {
        batchSize: 10,
        burstWhenBatchFull: true,
        perJobResults: true,
        pollingIntervalSeconds: 1,
        notifyPollingIntervalSeconds: 5,
      },
      async (jobs) => {
        const results: JobResult[] = [];
        for (const job of jobs) {
          const started = Date.now();
          try {
            const result = await runConsumer(deps, consumer, job.data.eventId);
            logger.info(
              {
                consumer: consumer.name,
                eventId: job.data.eventId,
                type: job.data.type,
                result,
                ms: Date.now() - started,
              },
              'événement traité',
            );
            results.push({ id: job.id, status: 'completed', output: { result } });
          } catch (err) {
            logger.error(
              { err, consumer: consumer.name, eventId: job.data.eventId },
              'échec du consommateur (nouvel essai programmé)',
            );
            results.push({
              id: job.id,
              status: 'failed',
              output: { message: err instanceof Error ? err.message : String(err) },
            });
          }
        }
        return results;
      },
    );
  }
}
