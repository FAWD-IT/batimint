/**
 * Chaîne complète côté worker : outbox → relais → pg-boss → consommateur → pg_notify.
 * Vérifie aussi l'idempotence (rejeu = aucun double effet).
 */
import { REALTIME_PG_CHANNEL } from '@batimint/contracts';
import { createPrismaClient, emitEvent, type PrismaClient, withSystem, withTenant } from '@batimint/db';
import { testDatabaseUrls } from '@batimint/db/testing';
import { createMockIntegrations, MockMailer } from '@batimint/integrations';
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
const urls = testDatabaseUrls('worker');
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
    await tx.tenant.create({
      data: { id: tenantId, name: 'Worker test', slug: `worker-${tenantId.slice(-8)}` },
    });
    await tx.user.create({ data: { id: userId, email: `w-${userId.slice(-8)}@example.test`, name: 'W' } });
    await tx.membership.create({ data: { tenantId, userId, role: 'owner' } });
  });
  const deps = {
    prisma,
    integrations: createMockIntegrations(),
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

async function waitFor<T>(
  fn: () => Promise<T | null | undefined> | T | null | undefined,
  timeoutMs = 15_000,
): Promise<T> {
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
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({ where: { eventId: event.id } }),
      ),
    );
    expect(notif.title).toBe('Bonjour du worker');
    const msg = await waitFor(() => received.find((m) => m.ref === notif.id));
    expect(msg).toMatchObject({ channel: `user:${userId}`, topic: 'notifications', tenantId });
    const published = await withSystem(prisma, (tx) =>
      tx.outboxEvent.findUnique({ where: { id: event.id } }),
    );
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
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({ where: { eventId: event.id } }),
      ),
    );
    const deps = {
      prisma,
      integrations: createMockIntegrations(),
      appUrl: '',
    };
    expect(await runConsumer(deps, diagnosticNotification, event.id)).toBe('skipped');
    expect(await runConsumer(deps, diagnosticNotification, event.id)).toBe('skipped');
    const count = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.notification.count({ where: { eventId: event.id } }),
    );
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
    const deps = {
      prisma,
      integrations: createMockIntegrations(),
      appUrl: '',
    };
    const failing = {
      ...diagnosticNotification,
      name: 'failing-test',
      handle: async () => {
        throw new Error('boom');
      },
    };
    await expect(runConsumer(deps, failing, event.id)).rejects.toThrow('boom');
    const processed = await withSystem(prisma, (tx) =>
      tx.processedEvent.count({ where: { consumer: 'failing-test', eventId: event.id } }),
    );
    expect(processed).toBe(0);
  });
});

describe('invitations', () => {
  it('user.invited envoie un e-mail avec un jeton dont seule l’empreinte est stockée', async () => {
    const { createHash } = await import('node:crypto');
    const { sendInvitation } = await import('../src/consumers/invitations');
    const mailer = new MockMailer();
    const deps = {
      prisma,
      integrations: createMockIntegrations({ mailer }),
      appUrl: 'https://app.test',
    };
    const inv = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.invitation.create({
        data: {
          tenantId,
          email: 'sophie@example.test',
          name: 'Sophie',
          role: 'office',
          tokenHash: `placeholder-${uuidv7()}`,
          invitedBy: userId,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    );
    const event = await withTenant(prisma, tenantId, userId, (tx) =>
      emitEvent(tx, {
        tenantId,
        type: 'user.invited.v1',
        aggregateType: 'invitation',
        aggregateId: inv.id,
        payload: { invitationId: inv.id, email: inv.email, role: inv.role, invitedBy: userId },
      }),
    );
    expect(await runConsumer(deps, sendInvitation, event.id)).toBe('done');
    const mail = mailer.lastTo('sophie@example.test')!;
    expect(mail.subject).toMatch(/vous invite sur Batimint/);
    expect(mail.text).toMatch(/« Bureau »/);
    const token = decodeURIComponent(/token=([^\s"]+)/.exec(mail.text)![1]!);
    const stored = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.invitation.findUniqueOrThrow({ where: { id: inv.id } }),
    );
    expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    // Rejeu : aucun second e-mail.
    expect(await runConsumer(deps, sendInvitation, event.id)).toBe('skipped');
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('demandes entrantes', () => {
  it('lead.received crée le prospect, l’adresse, l’opportunité et notifie le bureau ; un client connu est retrouvé', async () => {
    const { leadIntake } = await import('../src/consumers/leads');
    const deps = { prisma, integrations: createMockIntegrations(), appUrl: '' };
    const emit = async (email: string) => {
      const lead = await withTenant(prisma, tenantId, userId, (tx) =>
        tx.lead.create({
          data: {
            tenantId,
            source: 'web_form',
            name: 'Jean Dupont',
            email,
            street: 'Rue de la Station 42',
            postalCode: '6040',
            city: 'Jumet',
            message: 'Rénovation salle de bain\nMerci',
          },
        }),
      );
      const event = await withTenant(prisma, tenantId, userId, (tx) =>
        emitEvent(tx, {
          tenantId,
          type: 'lead.received.v1',
          aggregateType: 'lead',
          aggregateId: lead.id,
          payload: { leadId: lead.id, source: 'web_form' },
        }),
      );
      expect(await runConsumer(deps, leadIntake, event.id)).toBe('done');
      return withTenant(prisma, tenantId, userId, (tx) =>
        tx.lead.findUniqueOrThrow({ where: { id: lead.id } }),
      );
    };
    const first = await emit(`jean-${uuidv7().slice(-6)}@example.be`);
    expect(first.status).toBe('converted');
    const opp = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.opportunity.findUniqueOrThrow({
        where: { id: first.opportunityId! },
        include: { customer: true, site: true },
      }),
    );
    expect(opp).toMatchObject({ title: 'Rénovation salle de bain', stage: 'new' });
    expect(opp.customer).toMatchObject({
      displayName: 'Jean Dupont',
      status: 'prospect',
      firstName: 'Jean',
      lastName: 'Dupont',
    });
    expect(opp.site?.city).toBe('Jumet');
    const notif = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.notification.findFirst({ where: { type: 'lead.received', userId } }),
    );
    expect(notif?.title).toBe('Nouvelle demande : Jean Dupont');
    const second = await emit(first.email!);
    expect(second.customerId).toBe(first.customerId);
  });
});

describe('devis signé → chantier (03 §4 acceptation)', () => {
  async function signedQuote() {
    const { replaceVersionContent } = await import('@batimint/db');
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          kind: 'individual',
          status: 'prospect',
          displayName: 'Jean Dupont',
          email: 'jd@example.be',
        },
      });
      const opp = await tx.opportunity.create({
        data: { tenantId, customerId: customer.id, title: 'Salle de bain', stage: 'sent' },
      });
      const q = await tx.quote.create({
        data: {
          tenantId,
          number: `D-${uuidv7().slice(-6)}`,
          title: 'Rénovation salle de bain',
          customerId: customer.id,
          opportunityId: opp.id,
          status: 'signed',
          signedAt: new Date(),
        },
      });
      const v = await tx.quoteVersion.create({
        data: {
          tenantId,
          quoteId: q.id,
          version: 1,
          status: 'signed',
          depositKind: 'percent',
          depositValue: '30',
        },
      });
      await tx.quote.update({ where: { id: q.id }, data: { currentVersionId: v.id } });
      const line = (
        description: string,
        quantity: string,
        unitPrice: bigint,
        unitCost: bigint,
        vatRegime: string,
        laborHours = '0',
      ) => ({
        key: uuidv7(),
        kind: 'item',
        description,
        unit: 'm²',
        quantity,
        unitPrice,
        unitCost,
        laborHours,
        vatRegime,
        vatSuggested: vatRegime,
        discountPercent: '0',
      });
      await replaceVersionContent(tx, tenantId, v.id, {
        sections: [
          {
            key: uuidv7(),
            title: 'Carrelage',
            optional: false,
            selected: false,
            lines: [
              line('Faïence murale 30x60', '18.5', 3986n, 2899n, 'reduced_6'),
              line('Pose de faïence', '18.5', 4400n, 3200n, 'reduced_6', '1'),
            ],
          },
          {
            key: uuidv7(),
            title: 'Douche',
            optional: true,
            selected: true,
            lines: [line('Douche', '1', 140_000n, 100_000n, 'standard_21')],
          },
          {
            key: uuidv7(),
            title: 'Option refusée',
            optional: true,
            selected: false,
            lines: [line('Sèche-serviettes', '1', 50_000n, 30_000n, 'reduced_6')],
          },
        ],
      });
      const event = await emitEvent(tx, {
        tenantId,
        type: 'quote.signed.v1',
        aggregateType: 'quote',
        aggregateId: q.id,
        payload: { quoteId: q.id, versionId: v.id, signatureId: uuidv7(), certificateSigned: true },
      });
      return { q, v, customer, opp, event };
    });
  }

  it('crée exactement un chantier, ses postes, ses tâches, l’acompte en brouillon ; rejouer ne double rien', async () => {
    const { quoteSignedProject } = await import('../src/consumers/quotes');
    const { q, customer, opp, event } = await signedQuote();
    const deps = { prisma, integrations: createMockIntegrations(), appUrl: '' };
    // Un rejeu direct (sans la garde ProcessedEvent) ne crée pas de second chantier non plus.
    expect(await runConsumer(deps, quoteSignedProject, event.id)).toBe('done');
    await withTenant(prisma, tenantId, userId, (tx) =>
      tx.processedEvent.deleteMany({ where: { consumer: 'quote-signed-project', eventId: event.id } }),
    ).catch(() => undefined);
    await runConsumer(deps, quoteSignedProject, event.id).catch(() => 'skipped');
    const state = await withTenant(prisma, tenantId, userId, async (tx) => ({
      projects: await tx.project.findMany({
        where: { quoteId: q.id },
        include: { budgetLines: { orderBy: { position: 'asc' } }, tasks: true },
      }),
      invoices: await tx.invoice.findMany({ where: { quoteId: q.id }, include: { lines: true } }),
      customer: await tx.customer.findUniqueOrThrow({ where: { id: customer.id } }),
      opp: await tx.opportunity.findUniqueOrThrow({ where: { id: opp.id } }),
    }));
    expect(state.projects).toHaveLength(1);
    const p = state.projects[0]!;
    // 737,41 + 814,00 + 1 400,00 (option retenue) ; l'option refusée n'entre pas au contrat.
    expect(p.contractAmount).toBe(295_141n);
    expect(p.budgetLines.map((b) => [b.label, b.saleAmount, b.budgetedCost])).toEqual([
      ['Carrelage', 155_141n, 112_832n],
      ['Douche', 140_000n, 100_000n],
    ]);
    expect(p.tasks.map((t) => t.title).sort()).toEqual(['Douche', 'Faïence murale 30x60', 'Pose de faïence']);
    expect(p.tasks.find((t) => t.title === 'Pose de faïence')!.plannedHours.toString()).toBe('18.5');
    expect(state.invoices).toHaveLength(1);
    const inv = state.invoices[0]!;
    expect(inv).toMatchObject({ type: 'deposit', status: 'draft', number: null });
    // Total TVAC du devis : 1 551,41 + 93,08 + 1 400 + 294 = 3 338,49 ; acompte 30 % = 1 001,55
    expect(inv.totalGross).toBe(100_155n);
    expect(inv.lines.map((l) => l.vatRegime).sort()).toEqual(['reduced_6', 'standard_21']);
    expect(state.customer.status).toBe('customer');
    expect(state.opp.stage).toBe('won');
  });
});

describe('relances et échéances des devis', () => {
  it('J+7 sans signature → une relance (une seule) ; validité dépassée → expiré', async () => {
    const { runQuoteMaintenance } = await import('../src/schedules');
    const { quoteReminder } = await import('../src/consumers/quotes');
    const mailer = new MockMailer();
    const deps = { prisma, integrations: createMockIntegrations({ mailer }), appUrl: 'https://app.test' };
    const now = new Date();
    const [due, old] = await withTenant(prisma, tenantId, userId, async (tx) => {
      const c = await tx.customer.create({
        data: { tenantId, kind: 'individual', displayName: 'Relance', email: 'relance@example.be' },
      });
      const mk = (sentDaysAgo: number, validDays: number) =>
        tx.quote.create({
          data: {
            tenantId,
            number: `D-${uuidv7().slice(-6)}`,
            title: 'Toiture',
            customerId: c.id,
            status: 'sent',
            sentAt: new Date(now.getTime() - sentDaysAgo * 86_400_000),
            validUntil: new Date(now.getTime() + validDays * 86_400_000),
          },
        });
      return [await mk(8, 22), await mk(40, -10)];
    });
    await runQuoteMaintenance(deps, now);
    await runQuoteMaintenance(deps, now);
    const state = await withSystem(prisma, async (tx) => ({
      due: await tx.quote.findUniqueOrThrow({ where: { id: due.id } }),
      old: await tx.quote.findUniqueOrThrow({ where: { id: old.id } }),
      reminders: await tx.outboxEvent.findMany({
        where: { aggregateId: due.id, type: 'quote.reminder_due.v1' },
      }),
    }));
    expect(state.reminders).toHaveLength(1);
    expect(state.due.reminderSentAt).not.toBeNull();
    expect(state.old.status).toBe('expired');
    expect(await runConsumer(deps, quoteReminder, state.reminders[0]!.id)).toBe('done');
    const mail = mailer.lastTo('relance@example.be')!;
    expect(mail.subject).toMatch(/Rappel : votre devis/);
    expect(mail.text).toMatch(/https:\/\/app\.test\/p\//);
  });
});
