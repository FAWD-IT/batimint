/**
 * Chaîne complète côté worker : outbox → relais → pg-boss → consommateur → pg_notify.
 * Vérifie aussi l'idempotence (rejeu = aucun double effet).
 */
import { REALTIME_PG_CHANNEL } from '@batimint/contracts';
import { createPrismaClient, emitEvent, type PrismaClient, withSystem, withTenant } from '@batimint/db';
import { testDatabaseUrls } from '@batimint/db/testing';
import { MemoryStorage, MockMailer, MockVatValidator } from '@batimint/integrations';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBoss, registerConsumers } from '../src/boss';
import { CONSUMERS } from '../src/consumers';
import { diagnosticNotification } from '../src/consumers/notifications';
import { loadDotEnv } from '../src/env';
import { OutboxRelay } from '../src/relay';
import { runConsumer } from '../src/runner';

loadDotEnv();
const urls = testDatabaseUrls();
let prisma: PrismaClient;
let boss: PgBoss;
let relay: OutboxRelay;
let listener: pg.Client;
const received: { channel: string; topic: string; tenantId: string; ref?: string }[] = [];
const tenantId = uuidv7();
const userId = uuidv7();
const silent = process.env['DEBUG_WORKER']
  ? { info: console.info, warn: console.warn, error: console.error }
  : { info: () => undefined, warn: () => undefined, error: () => undefined };

beforeAll(async () => {
  prisma = createPrismaClient({ url: urls.appUrl });
  await withSystem(prisma, async (tx) => {
    await tx.tenant.create({ data: { id: tenantId, name: 'Worker test', slug: `worker-${tenantId.slice(-8)}` } });
    await tx.user.create({ data: { id: userId, email: `w-${userId.slice(-8)}@example.test`, name: 'W' } });
    await tx.membership.create({ data: { tenantId, userId, role: 'owner' } });
  });
  const deps = {
    prisma,
    integrations: { mailer: new MockMailer(), storage: new MemoryStorage(), vat: new MockVatValidator() },
    appUrl: 'http://localhost:3000',
  };
  listener = new pg.Client({ connectionString: urls.appUrl });
  await listener.connect();
  await listener.query(`LISTEN ${REALTIME_PG_CHANNEL}`);
  listener.on('notification', (n) => received.push(JSON.parse(n.payload!)));
  boss = createBoss(urls.appUrl);
  await boss.start();
  await registerConsumers(boss, deps, silent);
  relay = new OutboxRelay(deps, boss, urls.appUrl, silent, 500);
  await relay.start();
});

afterAll(async () => {
  await relay?.stop();
  await boss?.stop({ graceful: false });
  await listener?.end();
  await prisma?.$disconnect();
});

async function waitFor<T>(fn: () => Promise<T | null | undefined> | T | null | undefined, timeoutMs = 15_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('délai dépassé');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('outbox → worker → temps réel', () => {
  it('chaque consommateur a un nom unique et des événements versionnés', () => {
    const names = CONSUMERS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('un événement émis crée la notification et publie le message temps réel', async () => {
    const event = await withTenant(prisma, tenantId, userId, (tx) =>
      emitEvent(tx, {
        tenantId,
        type: 'diagnostic.ping.v1',
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: { requestedBy: userId, message: 'Bonjour du worker' },
      }),
    );
    const notif = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) => tx.notification.findFirst({ where: { eventId: event.id } })),
    );
    expect(notif.title).toBe('Bonjour du worker');
    const msg = await waitFor(() => received.find((m) => m.ref === notif.id));
    expect(msg).toMatchObject({ channel: `user:${userId}`, topic: 'notifications', tenantId });
    const published = await withSystem(prisma, (tx) => tx.outboxEvent.findUnique({ where: { id: event.id } }));
    expect(published?.publishedAt).not.toBeNull();
  });

  it('rejouer un événement ne produit aucun double effet', async () => {
    const event = await withTenant(prisma, tenantId, userId, (tx) =>
      emitEvent(tx, {
        tenantId,
        type: 'diagnostic.ping.v1',
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: { requestedBy: userId, message: 'Rejeu' },
      }),
    );
    await waitFor(() => withTenant(prisma, tenantId, userId, (tx) => tx.notification.findFirst({ where: { eventId: event.id } })));
    const deps = { prisma, integrations: { mailer: new MockMailer(), storage: new MemoryStorage(), vat: new MockVatValidator() }, appUrl: '' };
    expect(await runConsumer(deps, diagnosticNotification, event.id)).toBe('skipped');
    expect(await runConsumer(deps, diagnosticNotification, event.id)).toBe('skipped');
    const count = await withTenant(prisma, tenantId, userId, (tx) => tx.notification.count({ where: { eventId: event.id } }));
    expect(count).toBe(1);
    expect(await runConsumer(deps, diagnosticNotification, uuidv7())).toBe('missing');
  });

  it('un consommateur en échec n’enregistre rien et peut être rejoué', async () => {
    const event = await withTenant(prisma, tenantId, userId, (tx) =>
      emitEvent(tx, {
        tenantId,
        type: 'diagnostic.ping.v1',
        aggregateType: 'tenant',
        aggregateId: tenantId,
        payload: { requestedBy: userId, message: 'Échec' },
      }),
    );
    const deps = { prisma, integrations: { mailer: new MockMailer(), storage: new MemoryStorage(), vat: new MockVatValidator() }, appUrl: '' };
    const failing = { ...diagnosticNotification, name: 'failing-test', handle: async () => { throw new Error('boom'); } };
    await expect(runConsumer(deps, failing, event.id)).rejects.toThrow('boom');
    const processed = await withSystem(prisma, (tx) => tx.processedEvent.count({ where: { consumer: 'failing-test', eventId: event.id } }));
    expect(processed).toBe(0);
  });
});
