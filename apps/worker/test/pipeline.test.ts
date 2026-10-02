/**
 * Chaîne complète côté worker : outbox → relais → pg-boss → consommateur → pg_notify.
 * Vérifie aussi l'idempotence (rejeu = aucun double effet).
 */
import { REALTIME_PG_CHANNEL } from '@batimint/contracts';
import {
  createPrismaClient,
  emitEvent,
  FieldCipher,
  type PrismaClient,
  withSystem,
  withTenant,
} from '@batimint/db';
import { testDatabaseUrls } from '@batimint/db/testing';
import { createMockIntegrations, MockMailer } from '@batimint/integrations';
import { addDays, brusselsDate, isWorkingDay } from '@batimint/domain';
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
import type { WorkerDeps } from '../src/consumer';
import { runDunning, runPeppolDelivery, runSubcontractorDocumentAlerts } from '../src/schedules';

loadDotEnv();
const urls = testDatabaseUrls('worker');
let prisma: PrismaClient;
let boss: PgBoss;
let relay: OutboxRelay;
let listener: pg.Client;
const received: { channel: string; topic: string; tenantId: string; ref?: string }[] = [];
const tenantId = uuidv7();
const userId = uuidv7();
/** E-mails envoyés par le worker de fond (relais + pg-boss). */
const bgMailer = new MockMailer();
const cipher = new FieldCipher('worker-test-field-key');
const integrations = createMockIntegrations({ mailer: bgMailer });
let deps: WorkerDeps;
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
  deps = {
    prisma,
    integrations,
    appUrl: 'https://app.test',
    cipher,
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
    const deps = { prisma, integrations: createMockIntegrations(), appUrl: 'https://app.test' };
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
    // L'événement est traité par le worker de fond (relais + pg-boss), une seule fois.
    const mail = await waitFor(() => bgMailer.lastTo('relance@example.be'));
    expect(mail.subject).toMatch(/Rappel : votre devis/);
    expect(mail.text).toMatch(/https:\/\/app\.test\/p\//);
  });
});

describe('chantier : avenant signé, dérive, photos (03 §5)', () => {
  async function project() {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          kind: 'individual',
          status: 'customer',
          displayName: 'Jean Dupont',
          email: 'jd-m4@example.be',
        },
      });
      const p = await tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Salle de bain Dupont',
          customerId: customer.id,
          status: 'in_progress',
          contractAmount: 1_000_000n,
          managerUserId: userId,
          endDate: new Date('2026-10-09T00:00:00Z'),
        },
      });
      const carrelage = await tx.budgetLine.create({
        data: {
          tenantId,
          projectId: p.id,
          position: 0,
          label: 'Carrelage',
          saleAmount: 500_000n,
          budgetedCost: 300_000n,
          laborHours: '10',
        },
      });
      return { p, carrelage };
    });
  }

  it('avenant signé : poste existant et nouveau poste, contrat, tâches, date de fin, fil ; rejeu sans double', async () => {
    const { changeOrderSignedProject } = await import('../src/consumers/projects');
    const { p, carrelage } = await project();
    const event = await withTenant(prisma, tenantId, userId, async (tx) => {
      const co = await tx.changeOrder.create({
        data: {
          tenantId,
          projectId: p.id,
          ordinal: 1,
          title: 'Niche et éclairage',
          status: 'signed',
          signedAt: new Date(),
          delayDays: 2,
          totalNet: 125_000n,
          totalVat: 7_500n,
          totalGross: 132_500n,
          lines: {
            create: [
              {
                tenantId,
                position: 0,
                budgetLineId: carrelage.id,
                description: 'Niche murale',
                unit: 'u',
                quantity: '1',
                unitPrice: 95_000n,
                unitCost: 60_000n,
                laborHours: '4',
                vatRegime: 'reduced_6',
              },
              {
                tenantId,
                position: 1,
                newPostLabel: 'Éclairage',
                description: 'Spot LED',
                unit: 'u',
                quantity: '2',
                unitPrice: 15_000n,
                unitCost: 8_000n,
                vatRegime: 'reduced_6',
              },
            ],
          },
        },
      });
      return emitEvent(tx, {
        tenantId,
        type: 'change_order.signed.v1',
        aggregateType: 'project',
        aggregateId: p.id,
        payload: { projectId: p.id, changeOrderId: co.id, signatureId: uuidv7() },
        actor: { type: 'portal', id: uuidv7(), label: 'Jean Dupont' },
      });
    });
    const deps = { prisma, integrations: createMockIntegrations(), appUrl: '' };
    await runConsumer(deps, changeOrderSignedProject, event.id);
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { eventId: event.id } }),
      ),
    );
    // Rejeu forcé (sans la garde ProcessedEvent) : la garde métier évite tout double effet.
    await withTenant(prisma, tenantId, userId, (tx) =>
      tx.processedEvent.deleteMany({ where: { consumer: 'change-order-signed-project', eventId: event.id } }),
    );
    await runConsumer(deps, changeOrderSignedProject, event.id);
    const state = await withTenant(prisma, tenantId, userId, async (tx) => ({
      project: await tx.project.findUniqueOrThrow({ where: { id: p.id } }),
      lines: await tx.budgetLine.findMany({ where: { projectId: p.id }, orderBy: { position: 'asc' } }),
      tasks: await tx.task.findMany({ where: { projectId: p.id } }),
      timeline: await tx.timelineEntry.findMany({ where: { projectId: p.id, type: 'change_order.signed' } }),
      notifications: await tx.notification.findMany({ where: { eventId: event.id } }),
    }));
    expect(state.project.contractAmount).toBe(1_125_000n);
    expect(state.project.endDate?.toISOString().slice(0, 10)).toBe('2026-10-13');
    expect(state.lines.map((l) => [l.label, l.saleAmount, l.budgetedCost, l.laborHours.toString()])).toEqual([
      ['Carrelage', 595_000n, 360_000n, '14'],
      ['Éclairage', 30_000n, 16_000n, '0'],
    ]);
    expect(state.lines[1]!.changeOrderId).toBeTruthy();
    expect(state.tasks.map((t) => [t.title, t.amount]).sort()).toEqual([
      ['Niche murale', 95_000n],
      ['Spot LED', 30_000n],
    ]);
    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0]).toMatchObject({
      title: 'Avenant n°1 signé par Jean Dupont',
      amount: 125_000n,
      visibleToClient: true,
    });
    expect(state.notifications.map((n) => n.userId)).toEqual([userId]);
    expect(received.some((m) => m.channel === `project:${p.id}`)).toBe(true);
    expect(received.some((m) => m.channel === `portal:project:${p.id}`)).toBe(true);
  });

  it('un coût qui fait dériver un poste alerte une seule fois', async () => {
    const { p, carrelage } = await project();
    const record = (amount: bigint) =>
      withTenant(prisma, tenantId, userId, async (tx) => {
        const cost = await tx.projectCost.create({
          data: {
            tenantId,
            projectId: p.id,
            budgetLineId: carrelage.id,
            category: 'other',
            sourceType: 'manual',
            sourceId: uuidv7(),
            label: 'Faïence',
            amount,
          },
        });
        await emitEvent(tx, {
          tenantId,
          type: 'project.cost_recorded.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: {
            projectId: p.id,
            costId: cost.id,
            budgetLineId: carrelage.id,
            category: 'other',
            amount: String(amount),
          },
        });
      });
    await record(200_000n); // 67 % du budget : rien
    await record(140_000n); // 340 000 > 300 000 × 1,10 → dérive
    const drift = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { projectId: p.id, type: 'budget.drift_detected' } }),
      ),
    );
    expect(drift.title).toBe('Le poste Carrelage dépasse son budget de 13 %');
    await record(10_000n);
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry
          .count({ where: { projectId: p.id, type: 'project.cost_recorded' } })
          .then((n) => n === 3),
      ),
    );
    await new Promise((r) => setTimeout(r, 1500));
    const alerts = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.outboxEvent.count({ where: { aggregateId: p.id, type: 'budget.drift_detected.v1' } }),
    );
    expect(alerts).toBe(1);
  });

  it('les photos envoyées d’affilée forment une seule entrée « 2 photos »', async () => {
    const { p } = await project();
    for (const visible of [true, false])
      await withTenant(prisma, tenantId, userId, async (tx) => {
        const a = await tx.attachment.create({
          data: {
            tenantId,
            ownerType: 'project',
            ownerId: p.id,
            kind: 'photo',
            storageKey: `k/${uuidv7()}`,
            fileName: 'photo.jpg',
            contentType: 'image/jpeg',
            sizeBytes: 10,
            visibleToClient: visible,
          },
        });
        await emitEvent(tx, {
          tenantId,
          type: 'attachment.added.v1',
          aggregateType: 'project',
          aggregateId: p.id,
          payload: { attachmentId: a.id, ownerType: 'project', ownerId: p.id, kind: 'photo' },
          actor: { type: 'user', id: userId, label: 'Karim' },
        });
        // Laisse le worker traiter la première photo avant la seconde (ordre réel d'envoi).
        await new Promise((r) => setTimeout(r, 800));
      });
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({
          where: { projectId: p.id, type: 'photo.added', title: { contains: '2 photos' } },
        }),
      ),
    );
    expect(entry).toMatchObject({ title: 'Karim a ajouté 2 photos', visibleToClient: true });
    expect((entry.data as { photoIds: string[] }).photoIds).toHaveLength(2);
    const count = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.timelineEntry.count({ where: { projectId: p.id, type: 'photo.added' } }),
    );
    expect(count).toBe(1);
  });
});

describe('terrain : arrivée de l’équipe, main-d’œuvre, Check In and Out, signalements (03 §7)', () => {
  const DAY = '2026-09-15';
  async function fieldProject() {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const customer = await tx.customer.create({
        data: { tenantId, kind: 'individual', status: 'customer', displayName: 'Jean Dupont' },
      });
      const team = await tx.team.create({ data: { tenantId, name: 'Équipe 1' } });
      const karim = await tx.employee.create({
        data: {
          tenantId,
          firstName: 'Karim',
          lastName: 'Benali',
          teamId: team.id,
          hourlyCost: 4800n,
          inssEnc: cipher.encrypt('85073003328'),
          inssLast4: '3328',
        },
      });
      const luca = await tx.employee.create({
        data: { tenantId, firstName: 'Luca', lastName: 'Rossi', teamId: team.id, hourlyCost: 4200n },
      });
      await tx.team.update({ where: { id: team.id }, data: { leaderEmployeeId: karim.id } });
      const p = await tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Salle de bain Dupont',
          customerId: customer.id,
          status: 'in_progress',
          contractAmount: 1_000_000n,
          managerUserId: userId,
          teamId: team.id,
          checkInOutForced: true,
        },
      });
      const line = await tx.budgetLine.create({
        data: {
          tenantId,
          projectId: p.id,
          position: 0,
          label: 'Carrelage',
          saleAmount: 500_000n,
          budgetedCost: 300_000n,
          laborHours: '10',
        },
      });
      return { p, karim, luca, line };
    });
  }

  async function clock(projectId: string, employeeId: string, kind: 'in' | 'out', at: string) {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const e = await tx.timeEntry.create({
        data: {
          id: uuidv7(),
          tenantId,
          projectId,
          employeeId,
          kind,
          at: new Date(at),
          day: new Date(`${DAY}T00:00:00Z`),
          geofence: 'ok',
          onssStatus: 'pending',
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'time_entry.recorded.v1',
        aggregateType: 'project',
        aggregateId: projectId,
        payload: { timeEntryId: e.id, projectId, employeeId, kind, day: DAY },
        actor: { type: 'user', id: userId, label: 'Karim Benali' },
      });
      return e;
    });
  }

  it('une seule entrée « Équipe de Karim arrivée », coût main-d’œuvre au départ, présences ONSS', async () => {
    const { p, karim, luca, line } = await fieldProject();
    await clock(p.id, karim.id, 'in', `${DAY}T06:02:00Z`);
    await clock(p.id, luca.id, 'in', `${DAY}T06:05:00Z`);
    const arrival = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({
          where: { projectId: p.id, type: 'team.arrived', body: '2 personnes sur place' },
        }),
      ),
    );
    expect(arrival).toMatchObject({ title: 'Équipe de Karim arrivée sur chantier', visibleToClient: true });
    expect(arrival.occurredAt.toISOString()).toBe(`${DAY}T06:02:00.000Z`);

    const out = await clock(p.id, luca.id, 'out', `${DAY}T14:05:00Z`);
    const cost = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.projectCost.findFirst({ where: { projectId: p.id, category: 'labour' } }),
      ),
    );
    // 8 h brutes − 30 min de pause (paramètres par défaut) = 7 h 30 × 42 € = 315 €
    expect(cost).toMatchObject({ budgetLineId: line.id, amount: 31_500n, sourceType: 'time_entry' });
    expect(cost.label).toContain('Luca R.');

    // Présences : Karim (INSS connu) transmis, Luca (sans INSS) refusé, visible et notifié.
    const lucaOut = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timeEntry.findFirst({ where: { id: out.id, onssStatus: 'failed' } }),
      ),
    );
    expect(lucaOut.onssError).toContain('INSS');
    const karimIn = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.timeEntry.findFirstOrThrow({ where: { projectId: p.id, employeeId: karim.id } }),
    );
    expect(karimIn.onssStatus).toBe('sent');
    expect(karimIn.onssReference).toMatch(/^CIO-/);
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({ where: { type: 'onss.failed', link: { contains: p.id } } }),
      ),
    );
    const timeline = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.timelineEntry.count({ where: { projectId: p.id, type: 'project.cost_recorded' } }),
    );
    expect(timeline).toBe(0);
    await new Promise((r) => setTimeout(r, 800));
    const arrivals = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.timelineEntry.count({ where: { projectId: p.id, type: 'team.arrived' } }),
    );
    expect(arrivals).toBe(1);
  });

  it('un signalement urgent alerte le bureau ; ses photos rejoignent l’entrée du fil', async () => {
    const { p } = await fieldProject();
    const issueId = uuidv7();
    await withTenant(prisma, tenantId, userId, async (tx) => {
      await tx.issue.create({
        data: {
          id: issueId,
          tenantId,
          projectId: p.id,
          title: 'Fuite sous l’évier',
          urgent: true,
          reportedBy: userId,
          reporterLabel: 'Luca Rossi',
          reportedAt: new Date(),
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'issue.reported.v1',
        aggregateType: 'project',
        aggregateId: p.id,
        payload: { issueId, projectId: p.id, urgent: true },
      });
    });
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { projectId: p.id, type: 'issue.reported' } }),
      ),
    );
    await withTenant(prisma, tenantId, userId, async (tx) => {
      const a = await tx.attachment.create({
        data: {
          tenantId,
          ownerType: 'issue',
          ownerId: issueId,
          kind: 'photo',
          storageKey: `k/${uuidv7()}`,
          fileName: 'fuite.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 10,
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'attachment.added.v1',
        aggregateType: 'issue',
        aggregateId: issueId,
        payload: { attachmentId: a.id, ownerType: 'issue', ownerId: issueId, kind: 'photo' },
      });
    });
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry
          .findFirst({ where: { projectId: p.id, type: 'issue.reported' } })
          .then((e) => ((e?.data as { photoIds?: string[] })?.photoIds?.length ? e : null)),
      ),
    );
    expect(entry.title).toBe('Signalement urgent : Fuite sous l’évier');
    expect(entry.visibleToClient).toBe(false);
    const n = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.notification.findFirst({ where: { type: 'issue.urgent', link: { contains: p.id } } }),
    );
    expect(n?.title).toBe('Urgent — Luca Rossi signale un problème sur Salle de bain Dupont');
  });
});

describe('planning : date d’arrivée annoncée au client, planning du lendemain (03 §6)', () => {
  it('une date de début stable est annoncée une fois (fil, portail, e-mail)', async () => {
    const { runArrivalNotices } = await import('../src/schedules');
    const deps = { prisma, integrations: createMockIntegrations(), appUrl: 'https://app.test' };
    const email = `arrivee-${uuidv7().slice(-8)}@example.be`;
    const start = addDays(brusselsDate(new Date()), 10);
    const project = await withTenant(prisma, tenantId, userId, async (tx) => {
      const c = await tx.customer.create({
        data: {
          tenantId,
          kind: 'individual',
          displayName: 'Jean Arrivée',
          firstName: 'Jean',
          lastName: 'Arrivée',
          email,
        },
      });
      return tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Toiture Arrivée',
          customerId: c.id,
          status: 'preparation',
          contractAmount: 1_000_000n,
          startDate: new Date(`${start}T00:00:00Z`),
        },
      });
    });
    // Date modifiée il y a moins de 10 minutes : on attend qu'elle se stabilise.
    expect((await runArrivalNotices(deps, new Date())).sent).toBe(0);
    const later = new Date(Date.now() + 11 * 60_000);
    expect((await runArrivalNotices(deps, later)).sent).toBeGreaterThanOrEqual(1);
    expect((await runArrivalNotices(deps, later)).sent).toBe(0);
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { projectId: project.id, type: 'project.start_scheduled' } }),
      ),
    );
    expect(entry.visibleToClient).toBe(true);
    expect(entry.title).toMatch(/^Début des travaux prévu le \w+ \d+ \w+$/);
    const mail = await waitFor(() => bgMailer.sent.find((m) => m.to === email));
    expect(mail.subject).toContain('vos travaux commencent le');
  });

  it('à 18 h : une notification et un e-mail par personne pour le prochain jour ouvré, une seule fois', async () => {
    const { runDayAhead } = await import('../src/schedules');
    const deps = { prisma, integrations: createMockIntegrations(), appUrl: 'https://app.test' };
    const workerUser = uuidv7();
    const workerEmail = `luca-${workerUser.slice(-8)}@example.test`;
    let next = addDays(brusselsDate(new Date()), 1);
    while (!isWorkingDay(next)) next = addDays(next, 1);
    await withSystem(prisma, async (tx) => {
      await tx.user.create({ data: { id: workerUser, email: workerEmail, name: 'Luca Demain' } });
      await tx.membership.create({ data: { tenantId, userId: workerUser, role: 'worker' } });
    });
    await withTenant(prisma, tenantId, userId, async (tx) => {
      const c = await tx.customer.create({ data: { tenantId, kind: 'individual', displayName: 'Demain' } });
      const team = await tx.team.create({ data: { tenantId, name: `Équipe ${uuidv7().slice(-4)}` } });
      await tx.employee.create({
        data: { tenantId, firstName: 'Luca', lastName: 'Demain', teamId: team.id, userId: workerUser },
      });
      const p = await tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Façade Demain',
          customerId: c.id,
          status: 'in_progress',
          contractAmount: 1_000_000n,
        },
      });
      await tx.scheduleSlot.create({
        data: {
          id: uuidv7(),
          tenantId,
          projectId: p.id,
          teamId: team.id,
          startDay: new Date(`${next}T00:00:00Z`),
          startHalf: 'am',
          endDay: new Date(`${next}T00:00:00Z`),
          endHalf: 'am',
        },
      });
    });
    await runDayAhead(deps);
    await runDayAhead(deps);
    const n = await waitFor(() =>
      withTenant(prisma, tenantId, workerUser, (tx) =>
        tx.notification.findFirst({ where: { userId: workerUser, type: 'planning.day_ahead' } }),
      ),
    );
    expect(n.title).toContain('Façade Demain');
    expect(n.body).toBe('Façade Demain (matin)');
    const mail = await waitFor(() => bgMailer.sent.find((m) => m.to === workerEmail));
    expect(mail.subject).toMatch(/^Ton planning de demain/);
    await new Promise((r) => setTimeout(r, 800));
    const count = await withSystem(prisma, (tx) =>
      tx.notification.count({ where: { userId: workerUser, type: 'planning.day_ahead' } }),
    );
    expect(count).toBe(1);
  });
});

describe('achats : rapprochement des factures fournisseurs (02 P6)', () => {
  async function setup(street = `Rue des Achats ${uuidv7().slice(-5)}`) {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const customer = await tx.customer.create({
        data: { tenantId, kind: 'individual', displayName: 'Jean Achat' },
      });
      const site = await tx.site.create({
        data: {
          tenantId,
          customerId: customer.id,
          street,
          postalCode: '6040',
          city: 'Jumet',
        },
      });
      const supplier = await tx.supplier.create({
        data: { tenantId, name: 'Brico Pro SA', vatNumber: 'BE0412345614' },
      });
      const project = await tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Salle de bain Achat',
          customerId: customer.id,
          siteId: site.id,
          status: 'in_progress',
          contractAmount: 1_000_000n,
        },
      });
      const carrelage = await tx.budgetLine.create({
        data: {
          tenantId,
          projectId: project.id,
          position: 0,
          label: 'Carrelage',
          budgetedCost: 300_000n,
          saleAmount: 500_000n,
        },
      });
      const po = await tx.purchaseOrder.create({
        data: {
          id: uuidv7(),
          tenantId,
          projectId: project.id,
          supplierId: supplier.id,
          number: `BC2026-${uuidv7().slice(-4)}`,
          status: 'sent',
          totalNet: 60_800n,
          lines: {
            create: [
              {
                tenantId,
                position: 0,
                description: 'Faïence murale 30x60',
                supplierCode: 'FAI-3060',
                unit: 'm²',
                quantity: '20',
                unitPrice: 2_500n,
                budgetLineId: carrelage.id,
              },
              {
                tenantId,
                position: 1,
                description: 'Colle carrelage C2TE',
                unit: 'sac',
                quantity: '6',
                unitPrice: 1_800n,
                budgetLineId: carrelage.id,
              },
            ],
          },
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'purchase_order.sent.v1',
        aggregateType: 'project',
        aggregateId: project.id,
        payload: { purchaseOrderId: po.id, projectId: project.id, email: 'commandes@brico.example.be' },
      });
      return { project, supplier, po, carrelage };
    });
  }

  async function receive(
    supplierId: string | null,
    patch: { orderReference?: string | null; notes?: string | null },
    lines: { description: string; supplierCode?: string; quantity: string; unitPrice: bigint }[],
  ) {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const net = lines.reduce((s, l) => s + BigInt(Number(l.quantity)) * l.unitPrice, 0n);
      const inv = await tx.supplierInvoice.create({
        data: {
          id: uuidv7(),
          tenantId,
          source: 'peppol',
          externalId: uuidv7(),
          supplierId,
          supplierName: 'Brico Pro SA',
          totalNet: net,
          totalVat: (net * 21n) / 100n,
          totalGross: net + (net * 21n) / 100n,
          orderReference: patch.orderReference ?? null,
          notes: patch.notes ?? null,
          lines: {
            create: lines.map((l, position) => ({
              tenantId,
              position,
              description: l.description,
              supplierCode: l.supplierCode ?? null,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              net: BigInt(Number(l.quantity)) * l.unitPrice,
            })),
          },
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'supplier_invoice.received.v1',
        aggregateType: 'supplier_invoice',
        aggregateId: inv.id,
        payload: { invoiceId: inv.id, source: 'peppol' },
      });
      return inv;
    });
  }

  it('BC envoyé : engagement ; facture avec le n° de BC : imputée sans saisie, écart signalé, engagement soldé', async () => {
    const { project, supplier, po, carrelage } = await setup();
    const commitment = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.projectCost.findFirst({ where: { projectId: project.id, category: 'purchase_order' } }),
      ),
    );
    expect(commitment).toMatchObject({ amount: 60_800n, budgetLineId: carrelage.id });
    const inv = await receive(supplier.id, { orderReference: po.number }, [
      { description: 'Faïence 30x60', supplierCode: 'FAI-3060', quantity: '20', unitPrice: 2_700n },
      { description: 'Colle C2TE carrelage', quantity: '6', unitPrice: 1_800n },
    ]);
    const done = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.supplierInvoice.findFirst({
          where: { id: inv.id, status: 'allocated' },
          include: { allocations: true },
        }),
      ),
    );
    expect(done).toMatchObject({
      matchMethod: 'purchase_order',
      purchaseOrderId: po.id,
      projectId: project.id,
    });
    expect(done.allocations).toEqual([
      expect.objectContaining({ budgetLineId: carrelage.id, amount: 64_800n }),
    ]);
    expect((done.discrepancies as { kind: string }[]).map((d) => d.kind)).toEqual(['price', 'total']);
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { projectId: project.id, type: 'supplier_invoice.allocated' } }),
      ),
    );
    expect(entry.title).toBe('Facture Brico Pro SA reçue via Peppol');
    expect(entry.body).toBe(
      `Rapprochée du bon de commande ${po.number} · imputée au poste Carrelage, sans saisie`,
    );
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, async (tx) =>
        (await tx.projectCost.count({ where: { projectId: project.id, category: 'purchase_order' } })) === 0
          ? true
          : null,
      ),
    );
    const costs = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.projectCost.findMany({ where: { projectId: project.id, category: 'supplier_invoice' } }),
    );
    expect(costs.map((c) => c.amount)).toEqual([64_800n]);
  });

  it('par l’adresse de livraison ; sinon boîte « À imputer » avec suggestions et alerte au bureau', async () => {
    const { project } = await setup('Rue des Livraisons 77');
    const byAddress = await receive(null, { notes: 'Livraison : rue des Livraisons 77, 6040 Jumet' }, [
      { description: 'Silicone sanitaire', quantity: '4', unitPrice: 900n },
    ]);
    const a = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.supplierInvoice.findFirst({ where: { id: byAddress.id, status: 'allocated' } }),
      ),
    );
    expect(a).toMatchObject({ matchMethod: 'address', projectId: project.id });
    const unknown = await receive(null, {}, [
      { description: 'Location nacelle', quantity: '1', unitPrice: 45_000n },
    ]);
    const u = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.supplierInvoice.findFirst({ where: { id: unknown.id, status: 'to_allocate' } }),
      ),
    );
    expect(Array.isArray(u.suggestions)).toBe(true);
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({
          where: { type: 'supplier_invoice.to_allocate', link: { contains: unknown.id } },
        }),
      ),
    );
  });
});

describe('facturation : envoi, livraison Peppol, paiements, états, relances (02 P7)', () => {
  const today = brusselsDate(new Date());
  async function issuedInvoice(opts: {
    kind: 'individual' | 'company';
    email?: string | null;
    dueDate?: string;
    status?: 'issued' | 'sent';
  }) {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          kind: opts.kind,
          displayName: opts.kind === 'company' ? 'Immo Charleroi SA' : 'Jean Facture',
          email: opts.email === undefined ? `client-${uuidv7().slice(-6)}@example.be` : opts.email,
          ...(opts.kind === 'company' ? { enterpriseNumber: '0417497106', vatNumber: 'BE0417497106' } : {}),
        },
      });
      const project = await tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Chantier facturé',
          customerId: customer.id,
          status: 'in_progress',
          contractAmount: 1_000_000n,
        },
      });
      const id = uuidv7();
      const number = `2026-${uuidv7().slice(-5)}`;
      await integrations.storage.put({
        bucket: 'legal',
        key: `t/${tenantId}/invoices/${number}.xml`,
        body: Buffer.from(
          '<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
        ),
        contentType: 'application/xml',
      });
      const invoice = await tx.invoice.create({
        data: {
          id,
          tenantId,
          projectId: project.id,
          customerId: customer.id,
          type: 'progress',
          status: opts.status ?? 'issued',
          number,
          title: 'État d’avancement n°1 — 40 %',
          issueDate: new Date(`${today}T00:00:00Z`),
          dueDate: new Date(`${opts.dueDate ?? addDays(today, 30)}T00:00:00Z`),
          totalNet: 100_000n,
          totalVat: 6_000n,
          totalGross: 106_000n,
          structuredCommunication: '104260011893',
          ublKey: `t/${tenantId}/invoices/${number}.xml`,
          ...(opts.status === 'sent'
            ? { deliveryChannel: 'email', deliveryStatus: 'sent', sentAt: new Date() }
            : {}),
        },
      });
      return { invoice, customer, project };
    });
  }
  const issueEvent = (i: { id: string; projectId: string | null; number: string | null }) =>
    withTenant(prisma, tenantId, userId, (tx) =>
      emitEvent(tx, {
        tenantId,
        type: 'invoice.issued.v1',
        aggregateType: 'invoice',
        aggregateId: i.id,
        payload: { invoiceId: i.id, projectId: i.projectId, type: 'progress', number: i.number! },
      }),
    );

  it('particulier : e-mail avec PDF et lien du portail, statut « envoyée », fil visible du client', async () => {
    const { invoice, customer } = await issuedInvoice({ kind: 'individual' });
    await issueEvent(invoice);
    const sent = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.invoice.findFirst({ where: { id: invoice.id, deliveryStatus: 'sent' } }),
      ),
    );
    expect(sent).toMatchObject({ status: 'sent', deliveryChannel: 'email', sentTo: customer.email });
    const mail = bgMailer.sent.find((m) => m.to === customer.email)!;
    expect(mail.subject).toContain(`facture ${invoice.number}`);
    expect(mail.text).toContain('+++104/2600/11893+++');
    expect(mail.text).toContain('https://app.test/p/');
    const entry = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.timelineEntry.findFirst({ where: { projectId: invoice.projectId, type: 'invoice.issued' } }),
    );
    expect(entry).toMatchObject({ visibleToClient: true, title: `Facture ${invoice.number} émise` });
  });

  it('entreprise inscrite sur Peppol : envoi Peppol, puis livraison suivie par la tâche planifiée', async () => {
    await withTenant(prisma, tenantId, userId, (tx) =>
      tx.integrationConnection.upsert({
        where: { tenantId_kind: { tenantId, kind: 'peppol' } },
        update: { status: 'active', externalId: 'le_test' },
        create: { tenantId, kind: 'peppol', provider: 'mock', status: 'active', externalId: 'le_test' },
      }),
    );
    const { invoice } = await issuedInvoice({ kind: 'company' });
    await issueEvent(invoice);
    const sent = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.invoice.findFirst({ where: { id: invoice.id, deliveryChannel: 'peppol' } }),
      ),
    );
    expect(sent).toMatchObject({ status: 'sent', deliveryStatus: 'sent', sentTo: '0208:0417497106' });
    expect(sent.peppolDocumentId).toMatch(/^doc_/);
    expect(await runPeppolDelivery(deps)).toMatchObject({ updated: 1 });
    const delivered = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.invoice.findFirst({ where: { id: invoice.id, status: 'delivered' } }),
      ),
    );
    expect(delivered.deliveredAt).not.toBeNull();
    await withTenant(prisma, tenantId, userId, (tx) =>
      tx.integrationConnection.update({
        where: { tenantId_kind: { tenantId, kind: 'peppol' } },
        data: { status: 'not_connected' },
      }),
    );
  });

  it('relances : rappel à J+3 une seule fois, frais B2C absents au premier rappel, arrêt dès le paiement', async () => {
    const { invoice, customer } = await issuedInvoice({
      kind: 'individual',
      dueDate: addDays(today, -4),
      status: 'sent',
    });
    expect((await runDunning(deps)).due).toBeGreaterThanOrEqual(1);
    const step = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.dunningStep.findFirst({ where: { invoiceId: invoice.id } }),
      ),
    );
    expect(step).toMatchObject({
      step: 1,
      kind: 'reminder',
      fee: 0n,
      balance: 106_000n,
      sentTo: customer.email,
    });
    const mail = await waitFor(() =>
      bgMailer.sent.find((m) => m.to === customer.email && /rappel/.test(m.subject)),
    );
    expect(mail.text).toContain('Il s’agit peut-être d’un oubli.');
    // Rejouée le même jour : aucune seconde relance.
    await runDunning(deps);
    await new Promise((r) => setTimeout(r, 1_500));
    const steps = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.dunningStep.count({ where: { invoiceId: invoice.id } }),
    );
    expect(steps).toBe(1);
    // Payée : plus aucune relance, même au-delà de J+15.
    await withTenant(prisma, tenantId, userId, (tx) =>
      tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: 106_000n, status: 'paid' } }),
    );
    const later = await runDunning(deps, new Date(Date.now() + 20 * 86_400_000));
    const events = await withSystem(prisma, (tx) =>
      tx.outboxEvent.count({ where: { type: 'invoice.reminder_due.v1', aggregateId: invoice.id } }),
    );
    expect(events).toBe(1);
    expect(later.due).toBeGreaterThanOrEqual(0);
  });

  it('paiement reçu : fil du chantier, liens de paiement clos, notification si payé en ligne', async () => {
    const { invoice } = await issuedInvoice({ kind: 'individual', status: 'sent' });
    const paymentId = uuidv7();
    await withTenant(prisma, tenantId, userId, async (tx) => {
      await tx.paymentLink.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          provider: 'mock',
          externalId: `tr_${uuidv7().slice(-8)}`,
          url: 'https://x',
          amount: 106_000n,
        },
      });
      await tx.payment.create({
        data: {
          id: paymentId,
          tenantId,
          invoiceId: invoice.id,
          amount: 106_000n,
          receivedOn: new Date(`${today}T00:00:00Z`),
          method: 'bancontact',
          source: 'payment_link',
        },
      });
      await tx.invoice.update({ where: { id: invoice.id }, data: { amountPaid: 106_000n, status: 'paid' } });
      await emitEvent(tx, {
        tenantId,
        type: 'payment.received.v1',
        aggregateType: 'invoice',
        aggregateId: invoice.id,
        payload: { paymentId, invoiceId: invoice.id, amount: '106000', source: 'payment_link' },
      });
    });
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { projectId: invoice.projectId, type: 'payment.received' } }),
      ),
    );
    expect(entry.title).toBe(`Facture ${invoice.number} payée`);
    const links = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.paymentLink.findMany({ where: { invoiceId: invoice.id } }),
    );
    expect(links.every((l) => l.status === 'canceled')).toBe(true);
    const notif = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.notification.findFirst({
        where: { userId, type: 'payment.received', link: `/facturation/${invoice.id}` },
      }),
    );
    expect(notif?.title).toMatch(/Paiement en ligne reçu/);
  });

  it('état soumis : e-mail au client avec le lien du portail ; approuvé : brouillon de facture et notification', async () => {
    const { project, customer } = await issuedInvoice({ kind: 'individual' });
    const bl = uuidv7();
    const statementId = uuidv7();
    await withTenant(prisma, tenantId, userId, async (tx) => {
      await tx.budgetLine.create({
        data: {
          id: bl,
          tenantId,
          projectId: project.id,
          position: 0,
          label: 'Gros œuvre',
          saleAmount: 1_000_000n,
        },
      });
      await tx.progressStatement.create({
        data: {
          id: statementId,
          tenantId,
          projectId: project.id,
          ordinal: 1,
          status: 'submitted',
          periodEnd: new Date(`${today}T00:00:00Z`),
          contractAmount: 1_000_000n,
          previousAmount: 0n,
          cumulativeAmount: 400_000n,
          submittedAt: new Date(),
          lines: {
            create: [
              {
                tenantId,
                budgetLineId: bl,
                position: 0,
                label: 'Gros œuvre',
                contractAmount: 1_000_000n,
                previousAmount: 0n,
                cumulativeAmount: 400_000n,
                cumulativePercent: '40',
              },
            ],
          },
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'progress_statement.submitted.v1',
        aggregateType: 'project',
        aggregateId: project.id,
        payload: { statementId, projectId: project.id },
      });
    });
    const mail = await waitFor(() =>
      bgMailer.sent.find((m) => m.to === customer.email && /à approuver/.test(m.subject)),
    );
    expect(mail.text).toContain('40 %');
    expect(mail.text).toContain('https://app.test/p/');
    await withTenant(prisma, tenantId, userId, async (tx) => {
      await tx.progressStatement.update({
        where: { id: statementId },
        data: { status: 'approved', approvedAt: new Date(), approvedByName: 'Jean Facture' },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'progress_statement.approved.v1',
        aggregateType: 'project',
        aggregateId: project.id,
        payload: { statementId, projectId: project.id, byClient: true },
      });
    });
    const draft = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.invoice.findFirst({ where: { progressStatementId: statementId }, include: { lines: true } }),
      ),
    );
    expect(draft).toMatchObject({
      status: 'draft',
      type: 'progress',
      totalNet: 400_000n,
      title: 'État d’avancement n°1 — 40 %',
    });
    const notif = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({ where: { userId, type: 'progress_statement.approved' } }),
      ),
    );
    expect(notif.link).toBe(`/facturation/${draft.id}`);
  });
});

describe('M9 — sous-traitance', () => {
  async function contract(enterpriseNumber: string, amount: bigint) {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const customer = await tx.customer.create({
        data: { tenantId, kind: 'individual', displayName: 'Jean Sous-traité' },
      });
      const project = await tx.project.create({
        data: {
          tenantId,
          number: `CH-${uuidv7().slice(-6)}`,
          name: 'Rénovation sous-traitée',
          customerId: customer.id,
          status: 'in_progress',
          contractAmount: 5_000_000n,
        },
      });
      const post = await tx.budgetLine.create({
        data: {
          tenantId,
          projectId: project.id,
          position: 0,
          label: 'Électricité',
          budgetedCost: 2_000_000n,
        },
      });
      const supplier = await tx.supplier.create({
        data: {
          tenantId,
          name: `Électro ${uuidv7().slice(-4)}`,
          enterpriseNumber,
          email: `st-${uuidv7().slice(-6)}@example.be`,
          isSubcontractor: true,
        },
      });
      const sc = await tx.subcontract.create({
        data: {
          id: uuidv7(),
          tenantId,
          number: `ST2026-${uuidv7().slice(-3)}`,
          projectId: project.id,
          budgetLineId: post.id,
          supplierId: supplier.id,
          title: 'Électricité complète',
          amount,
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'subcontract.created.v1',
        aggregateType: 'subcontract',
        aggregateId: sc.id,
        payload: { subcontractId: sc.id, projectId: project.id, checkId: null },
      });
      return { project, post, supplier, sc };
    });
  }

  async function portalInvoice(supplierId: string, subcontractId: string, net: bigint) {
    return withTenant(prisma, tenantId, userId, async (tx) => {
      const inv = await tx.supplierInvoice.create({
        data: {
          id: uuidv7(),
          tenantId,
          source: 'upload',
          supplierId,
          supplierName: 'Électro',
          subcontractId,
          number: 'F-2026-12',
          totalNet: net,
          totalVat: (net * 21n) / 100n,
          totalGross: net + (net * 21n) / 100n,
          extraction: {},
        },
      });
      await emitEvent(tx, {
        tenantId,
        type: 'supplier_invoice.received.v1',
        aggregateType: 'supplier_invoice',
        aggregateId: inv.id,
        payload: { invoiceId: inv.id, source: 'upload' },
      });
      return inv;
    });
  }

  it('contrat : engagé sur le poste et fil ; facture du sous-traitant imputée au poste, 30bis à la réception', async () => {
    const { project, post, supplier, sc } = await contract('0456789034', 1_240_000n);
    const commitment = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.projectCost.findFirst({ where: { projectId: project.id, category: 'subcontract' } }),
      ),
    );
    expect(commitment).toMatchObject({ amount: 1_240_000n, budgetLineId: post.id });
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({ where: { projectId: project.id, type: 'subcontract.created' } }),
      ),
    );
    expect(entry.title).toBe(`Contrat de sous-traitance ${sc.number} avec ${supplier.name}`);

    const inv = await portalInvoice(supplier.id, sc.id, 372_000n);
    const done = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.supplierInvoice.findFirst({
          where: { id: inv.id, status: 'allocated', thirtyBisCheckId: { not: null } },
          include: { allocations: true },
        }),
      ),
    );
    expect(done).toMatchObject({ matchMethod: 'subcontract', projectId: project.id, withholdingSocial: 0n });
    expect(done.allocations).toEqual([expect.objectContaining({ budgetLineId: post.id, amount: 372_000n })]);
    const check = await withTenant(prisma, tenantId, userId, (tx) =>
      tx.thirtyBisCheck.findUniqueOrThrow({ where: { id: done.thirtyBisCheckId! } }),
    );
    expect(check).toMatchObject({ context: 'invoice_received', hasSocialDebt: false });
    expect(check.proofSha256).toMatch(/^[0-9a-f]{64}$/);
    // L'engagé du contrat diminue de ce qui est facturé.
    await waitFor(() =>
      withTenant(prisma, tenantId, userId, async (tx) =>
        (await tx.projectCost.findFirst({ where: { projectId: project.id, category: 'subcontract' } }))
          ?.amount === 868_000n
          ? true
          : null,
      ),
    );
  });

  it('dette à la réception : retenue calculée ; au paiement : alerte au bureau et fil', async () => {
    const { project, supplier, sc } = await contract('0712349984', 2_000_000n);
    const inv = await portalInvoice(supplier.id, sc.id, 1_000_000n);
    const done = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.supplierInvoice.findFirst({ where: { id: inv.id, thirtyBisCheckId: { not: null } } }),
      ),
    );
    expect(done).toMatchObject({
      withholdingSocial: 350_000n,
      withholdingTax: 0n,
      withholdingAppliedAt: null,
    });
    await withTenant(prisma, tenantId, userId, async (tx) => {
      await tx.supplierInvoice.update({ where: { id: inv.id }, data: { status: 'blocked' } });
      await emitEvent(tx, {
        tenantId,
        type: 'supplier_invoice.blocked_thirty_bis.v1',
        aggregateType: 'supplier_invoice',
        aggregateId: inv.id,
        payload: { invoiceId: inv.id, checkId: done.thirtyBisCheckId!, social: '350000', tax: '0' },
      });
    });
    const notif = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({
          where: { userId, type: 'supplier_invoice.blocked_thirty_bis', link: { contains: inv.id } },
        }),
      ),
    );
    expect(notif.body).toMatch(/Dette sociale : retenue de 3\s500,00\s€/);
    const entry = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.timelineEntry.findFirst({
          where: { projectId: project.id, type: 'supplier_invoice.blocked_thirty_bis' },
        }),
      ),
    );
    expect(entry.title).toMatch(/bloqué : dette sociale/);
  });

  it('invitation : un lien /s/ par e-mail ; documents : une alerte par état, e-mail au sous-traitant', async () => {
    const { supplier, sc } = await contract('0456789034', 500_000n);
    await withTenant(prisma, tenantId, userId, (tx) =>
      emitEvent(tx, {
        tenantId,
        type: 'subcontractor.invited.v1',
        aggregateType: 'supplier',
        aggregateId: supplier.id,
        payload: { supplierId: supplier.id, email: supplier.email!, subcontractId: sc.id },
      }),
    );
    const mail = await waitFor(() => bgMailer.sent.find((m) => m.to === supplier.email));
    expect(mail.subject).toContain(sc.number);
    expect(mail.text).toContain('https://app.test/s/');
    const token = /\/s\/([^\s]+)/.exec(mail.text)![1]!;
    const stored = await withSystem(prisma, (tx) =>
      tx.portalToken.findFirst({ where: { supplierId: supplier.id, kind: 'subcontractor' } }),
    );
    expect(stored?.tokenHash).not.toBe(token);

    const docId = uuidv7();
    await withTenant(prisma, tenantId, userId, (tx) =>
      tx.subcontractorDocument.create({
        data: {
          id: docId,
          tenantId,
          supplierId: supplier.id,
          kind: 'rc_insurance',
          expiresOn: new Date(`${addDays(brusselsDate(new Date()), 10)}T00:00:00Z`),
          fileKey: 'x',
          fileName: 'rc.pdf',
          contentType: 'application/pdf',
          size: 1,
          sha256: 'x',
        },
      }),
    );
    expect((await runSubcontractorDocumentAlerts(deps)).alerts).toBeGreaterThanOrEqual(1);
    expect((await runSubcontractorDocumentAlerts(deps)).alerts, 'une seule alerte par état').toBe(0);
    const notif = await waitFor(() =>
      withTenant(prisma, tenantId, userId, (tx) =>
        tx.notification.findFirst({
          where: { userId, type: 'subcontractor.document_expiring', link: `/sous-traitance/${supplier.id}` },
        }),
      ),
    );
    expect(notif.title).toMatch(/Assurance responsabilité civile de .* expire le/);
    const renew = await waitFor(() =>
      bgMailer.sent.find((m) => m.to === supplier.email && /à renouveler/.test(m.subject)),
    );
    expect(renew.text).toContain('https://app.test/s/');
    // Expiré plus tard : nouvelle alerte (nouvel état).
    expect(
      (await runSubcontractorDocumentAlerts(deps, new Date(Date.now() + 20 * 86_400_000))).alerts,
    ).toBeGreaterThanOrEqual(1);
  });
});
