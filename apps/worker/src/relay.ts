/**
 * Relais outbox → pg-boss (06 « Transactional outbox »). Réveillé par NOTIFY outbox_new au commit
 * (trigger SQL), avec un balayage périodique de secours. Les jobs sont créés dans la même
 * transaction que le marquage published_at (adaptateur Prisma de pg-boss) : pas de perte, et un
 * doublon éventuel est absorbé par l'idempotence des consommateurs.
 */
import { withSystem } from '@batimint/db';
import pg from 'pg';
import { fromPrisma, type PgBoss } from 'pg-boss';
import { queueName } from './consumer';
import { consumersFor } from './consumers';
import type { WorkerDeps } from './consumer';

interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export class OutboxRelay {
  private listener: pg.Client | null = null;
  private timer: NodeJS.Timeout | null = null;
  private draining = false;
  private pending = false;
  private stopped = false;

  constructor(
    private readonly deps: WorkerDeps,
    private readonly boss: PgBoss,
    private readonly connectionString: string,
    private readonly logger: Logger,
    private readonly pollMs = 2000,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.listen();
    this.timer = setInterval(() => void this.drain(), this.pollMs);
    await this.drain();
  }

  private async listen(): Promise<void> {
    if (this.stopped) return;
    const client = new pg.Client({ connectionString: this.connectionString, application_name: 'batimint-relay' });
    client.on('notification', () => void this.drain());
    client.on('error', (err) => {
      this.logger.warn({ err }, 'LISTEN outbox perdu, reconnexion');
      this.listener = null;
      setTimeout(() => void this.listen(), 2000);
    });
    try {
      await client.connect();
      await client.query('LISTEN outbox_new');
      this.listener = client;
    } catch (err) {
      this.logger.warn({ err }, 'LISTEN outbox impossible, balayage seul');
      await client.end().catch(() => undefined);
      setTimeout(() => void this.listen(), 5000);
    }
  }

  /** Publie tous les événements en attente. Sûr en concurrence (SKIP LOCKED). */
  async drain(): Promise<number> {
    if (this.stopped) return 0;
    if (this.draining) {
      this.pending = true;
      return 0;
    }
    this.draining = true;
    let total = 0;
    try {
      for (;;) {
        this.pending = false;
        const n = await this.publishBatch();
        total += n;
        if (n === 0 && !this.pending) break;
      }
    } catch (err) {
      this.logger.error({ err }, 'relais outbox en erreur');
    } finally {
      this.draining = false;
    }
    return total;
  }

  private async publishBatch(limit = 100): Promise<number> {
    return withSystem(this.deps.prisma, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; tenant_id: string; type: string }[]>`
        SELECT id, tenant_id, type FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY occurred_at, id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const db = fromPrisma(tx);
      for (const row of rows) {
        for (const consumer of consumersFor(row.type)) {
          await this.boss.send(
            queueName(consumer),
            { eventId: row.id, tenantId: row.tenant_id, type: row.type },
            { db, singletonKey: row.id },
          );
        }
      }
      await tx.$executeRaw`UPDATE outbox_events SET published_at = now() WHERE id = ANY(${rows.map((r) => r.id)}::uuid[])`;
      return rows.length;
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
    this.listener = null;
  }
}
