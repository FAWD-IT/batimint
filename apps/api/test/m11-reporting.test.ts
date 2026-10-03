/**
 * M11 — Pilotage et comptabilité (03 §12–13, 02 P11–P12) contre un vrai Postgres : Aujourd'hui
 * (qui est où, ce qui a bougé, alertes), tableau de bord recalculé depuis les données, trésorerie à
 * 90 jours, rapports et exports CSV/Excel, connexion comptable avec rattrapage, exports du
 * comptable par période, droits du Comptable, isolation.
 */
import type {
  AccountingOverviewDto,
  AccountingSyncDto,
  CashForecastDto,
  DashboardDto,
  ProfitabilityReportDto,
  TodayDto,
} from '@batimint/contracts';
import { withSystem } from '@batimint/db';
import { addDays, brusselsDate, isWorkingDay } from '@batimint/domain';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, sessionCookie, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
const today = brusselsDate(new Date());
const day = (d: string) => new Date(`${d}T00:00:00Z`);
const ids = {
  dupont: uuidv7(),
  lemaire: uuidv7(),
  projectA: uuidv7(),
  projectB: uuidv7(),
  postA: uuidv7(),
  postB: uuidv7(),
  karim: uuidv7(),
  luca: uuidv7(),
  team: uuidv7(),
  invOverdue: uuidv7(),
  invOpen: uuidv7(),
  supplierInv: uuidv7(),
};

const inject = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: unknown,
  s: { cookie: string } = owner,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Pilotage');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  await withSystem(t.prisma, async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: { enterpriseNumber: '0123456749', legalName: 'Rénov Pilotage SRL' },
    });
    for (const [id, name] of [
      [ids.dupont, 'Jean Dupont'],
      [ids.lemaire, 'Lemaire SA'],
    ] as const)
      await tx.customer.create({
        data: { id, tenantId, kind: id === ids.dupont ? 'individual' : 'company', displayName: name },
      });
    await tx.team.create({ data: { id: ids.team, tenantId, name: 'Équipe Karim', color: '#2F4BFF' } });
    for (const [id, first] of [
      [ids.karim, 'Karim'],
      [ids.luca, 'Luca'],
    ] as const)
      await tx.employee.create({
        data: { id, tenantId, firstName: first, lastName: 'Test', hourlyCost: 4_000n, teamId: ids.team },
      });
    for (const [id, number, name, customerId, post] of [
      [ids.projectA, 'CH2026-101', 'Salle de bain Dupont', ids.dupont, ids.postA],
      [ids.projectB, 'CH2026-102', 'Bureaux Lemaire', ids.lemaire, ids.postB],
    ] as const) {
      await tx.project.create({
        data: {
          id,
          tenantId,
          number,
          name,
          customerId,
          status: 'in_progress',
          contractAmount: id === ids.projectA ? 2_000_000n : 5_000_000n,
          teamId: ids.team,
          startDate: day(addDays(today, -30)),
          endDate: day(id === ids.projectA ? addDays(today, -2) : addDays(today, 40)),
        },
      });
      await tx.budgetLine.create({
        data: {
          id: post,
          tenantId,
          projectId: id,
          position: 0,
          label: 'Gros œuvre',
          saleAmount: id === ids.projectA ? 2_000_000n : 5_000_000n,
          budgetedCost: id === ids.projectA ? 1_400_000n : 3_500_000n,
        },
      });
    }
    // Le chantier A dérive : 1,6 M€ engagés pour 1,4 M€ budgétés.
    await tx.projectCost.create({
      data: {
        tenantId,
        projectId: ids.projectA,
        budgetLineId: ids.postA,
        category: 'supplier_invoice',
        sourceType: 'test',
        sourceId: 'a',
        label: 'Achats',
        amount: 1_600_000n,
      },
    });
    // Factures : une échue (non payée), une payée partiellement, une émise le mois passé.
    const inv = (
      id: string,
      number: string,
      projectId: string,
      customerId: string,
      net: bigint,
      issue: string,
      due: string,
      paid = 0n,
    ) =>
      tx.invoice.create({
        data: {
          id,
          tenantId,
          projectId,
          customerId,
          type: 'progress',
          status: paid ? 'partially_paid' : 'sent',
          number,
          title: number,
          issueDate: day(issue),
          dueDate: day(due),
          totalNet: net,
          totalVat: (net * 21n) / 100n,
          totalGross: net + (net * 21n) / 100n,
          amountPaid: paid,
          vatBreakdown: [
            {
              category: 'S',
              ratePercent: '21',
              taxableAmount: Number(net),
              taxAmount: Number((net * 21n) / 100n),
            },
          ],
          buyer: {
            name: customerId === ids.dupont ? 'Jean Dupont' : 'Lemaire SA',
            vatNumber: null,
            enterpriseNumber: null,
          },
          lines: {
            create: {
              tenantId,
              position: 0,
              description: 'Avancement',
              quantity: '1',
              unitPrice: net,
              vatRegime: 'standard_21',
              budgetLineId: projectId === ids.projectA ? ids.postA : ids.postB,
            },
          },
        },
      });
    await inv(
      ids.invOverdue,
      '2026-501',
      ids.projectA,
      ids.dupont,
      1_000_000n,
      addDays(today, -40),
      addDays(today, -10),
    );
    await inv(
      ids.invOpen,
      '2026-502',
      ids.projectB,
      ids.lemaire,
      2_000_000n,
      today,
      addDays(today, 30),
      420_000n,
    );
    await tx.payment.create({
      data: {
        id: uuidv7(),
        tenantId,
        invoiceId: ids.invOpen,
        amount: 420_000n,
        receivedOn: day(today),
        method: 'transfer',
      },
    });
    await tx.supplierInvoice.create({
      data: {
        id: ids.supplierInv,
        tenantId,
        source: 'upload',
        supplierName: 'Gilson SA',
        supplierVat: 'BE0456789034',
        number: 'G-77',
        issueDate: day(addDays(today, -5)),
        dueDate: day(addDays(today, 25)),
        totalNet: 300_000n,
        totalVat: 63_000n,
        totalGross: 363_000n,
        status: 'to_pay',
        projectId: ids.projectB,
      },
    });
    // Planning du jour : l'équipe sur le chantier B ; Karim a pointé, Luca pas encore.
    await tx.scheduleSlot.create({
      data: {
        id: uuidv7(),
        tenantId,
        projectId: ids.projectB,
        teamId: ids.team,
        startDay: day(addDays(today, -3)),
        endDay: day(addDays(today, 3)),
      },
    });
    await tx.timeEntry.create({
      data: {
        id: uuidv7(),
        tenantId,
        projectId: ids.projectB,
        employeeId: ids.karim,
        kind: 'in',
        at: new Date(Date.now() - 2 * 3_600_000),
        day: day(today),
        geofence: 'ok',
      },
    });
    await tx.timelineEntry.create({
      data: {
        tenantId,
        projectId: ids.projectB,
        type: 'payment.received',
        title: 'Paiement reçu : 4 200,00 €',
        amount: 420_000n,
        occurredAt: new Date(),
      },
    });
    // Devis envoyés ce mois : 1 signé, 1 refusé, 1 en attente.
    for (const [status, amount] of [
      ['signed', 1_000_000n],
      ['refused', 500_000n],
      ['sent', 300_000n],
    ] as const) {
      const q = await tx.quote.create({
        data: { tenantId, customerId: ids.dupont, title: `Devis ${status}`, status, sentAt: new Date() },
      });
      const v = await tx.quoteVersion.create({
        data: { tenantId, quoteId: q.id, version: 1, status, totalNet: amount },
      });
      await tx.quote.update({ where: { id: q.id }, data: { currentVersionId: v.id } });
    }
  });
});

afterAll(async () => {
  await t?.close();
});

describe('M11 — pilotage', () => {
  it('Aujourd’hui : qui est où, ce qui a bougé, alertes triées, chiffres du mois', async () => {
    const res = await inject('GET', '/v1/today');
    expect(res.statusCode).toBe(200);
    const d = res.json() as TodayDto;
    const site = d.sites.find((s) => s.project.id === ids.projectB)!;
    // Le planning n'attend personne le week-end ou un jour férié ; Karim a pointé quand même.
    const workday = isWorkingDay(today);
    expect(site).toMatchObject({ present: 1, expected: workday ? 2 : 1 });
    expect(site.people.map((p) => [p.name, p.status])).toEqual([
      ['Karim Test', 'on_site'],
      ...(workday ? [['Luca Test', 'expected']] : []),
    ]);
    expect(d.changes.some((c) => c.title.startsWith('Paiement reçu'))).toBe(true);
    const kinds = d.alerts.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['budget_drift', 'invoice_overdue', 'project_late']));
    expect(d.alerts[0]!.severity).toBe('crit');
    expect(d.alerts.find((a) => a.kind === 'invoice_overdue')!.amount).toBe(1_210_000);
    expect(d.figures).toMatchObject({ collectedThisMonth: 420_000, overdue: 1_210_000 });
  });

  it('tableau de bord : chiffres recalculés, filtres, transformation des devis', async () => {
    const d = (await inject('GET', '/v1/dashboard?period=month')).json() as DashboardDto;
    expect(d.kpis.collected).toBe(420_000);
    expect(d.kpis.outstanding).toBe(1_210_000 + 2_420_000 - 420_000);
    expect(d.kpis.overdue).toBe(1_210_000);
    expect(d.kpis.orderBook).toBe(7_000_000 - 1_000_000 - 2_000_000);
    expect(d.kpis.quotes).toMatchObject({ sent: 3, signed: 1, refused: 1, open: 1, rate: '0.5' });
    expect(d.projects.map((p) => p.project.number).sort()).toEqual(['CH2026-101', 'CH2026-102']);
    expect(d.projects.find((p) => p.project.id === ids.projectA)!.drifting).toBe(true);
    expect(d.options.teams).toEqual([{ id: ids.team, name: 'Équipe Karim' }]);
    const custom = await inject('GET', `/v1/dashboard?period=custom&from=${today}&to=${addDays(today, -1)}`);
    expect(custom.statusCode).toBe(400);
    expect(custom.json().error.message).toMatch(/fin précède/);
  });

  it('trésorerie à 90 jours : retards attendus aujourd’hui, achats, salaires, solde de départ', async () => {
    let f = (await inject('GET', '/v1/reports/cash-forecast')).json() as CashForecastDto;
    expect(f.openingBalance).toBeNull();
    expect(f.weeks).toHaveLength(13);
    expect(f.overdue.inflow).toBe(1_210_000);
    expect(f.items.find((i) => i.label.startsWith('2026-502'))).toMatchObject({
      amount: 2_000_000,
      direction: 'in',
    });
    expect(f.items.find((i) => i.kind === 'payable')).toMatchObject({ amount: 363_000, direction: 'out' });
    // 2 personnes × 40 € × 38 h × 52 / 12
    expect(f.monthlyPayroll).toBe(2 * 658_667);
    expect(f.items.filter((i) => i.kind === 'payroll').length).toBeGreaterThanOrEqual(3);
    expect(
      (await inject('PUT', '/v1/dashboard/cash-balance', { amount: 5_000_000, on: today })).statusCode,
    ).toBe(200);
    f = (await inject('GET', '/v1/reports/cash-forecast')).json() as CashForecastDto;
    expect(f).toMatchObject({ openingBalance: 5_000_000, openingBalanceOn: today });
    expect(f.weeks[0]!.balance).toBe(5_000_000 + f.weeks[0]!.net);
  });

  it('rapports : rentabilité par client, heures, carnet ; exports CSV et Excel', async () => {
    const r = (
      await inject('GET', '/v1/reports/profitability?groupBy=customer&period=year')
    ).json() as ProfitabilityReportDto;
    expect(r.rows.map((x) => x.label)).toEqual(['Lemaire SA', 'Jean Dupont']);
    expect(r.totals.sold).toBe(7_000_000);
    const hours = (await inject('GET', '/v1/reports/hours?groupBy=person&period=month')).json();
    expect(hours.rows.find((x: { label: string }) => x.label === 'Luca Test').plannedMinutes).toBeGreaterThan(
      0,
    );
    const ob = (await inject('GET', '/v1/reports/order-book')).json();
    expect(ob.rows[0]).toMatchObject({
      project: { number: 'CH2026-102' },
      contract: 5_000_000,
      invoiced: 2_000_000,
      remaining: 3_000_000,
    });

    const csv = await inject(
      'GET',
      '/v1/reports/profitability/export?groupBy=customer&period=year&format=csv',
    );
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/rentabilite-customer-.*\.csv/);
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body).toContain('Client;Chantiers;Vendu HTVA;Coût projeté;Marge;Marge %');
    expect(csv.body).toContain('Lemaire SA;1;50000,00;');
    const xlsx = await inject('GET', '/v1/reports/cash-forecast/export?format=xlsx');
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
    const list = await inject('GET', '/v1/exports/invoices?format=csv');
    expect(list.body).toContain('2026-501;Facture;');
    expect(list.body).toContain(';10000,00;2100,00;12100,00;');
  });
});

describe('M11 — carte des chantiers', () => {
  it('chantiers actifs placés (code postal), personnes sur place, villes de repère', async () => {
    await withSystem(t.prisma, async (tx) => {
      const site = await tx.site.create({
        data: {
          tenantId,
          customerId: ids.lemaire,
          street: 'Rue de la Station 4',
          postalCode: '6041',
          city: 'Gosselies',
        },
      });
      await tx.project.update({ where: { id: ids.projectB }, data: { siteId: site.id } });
    });
    const res = await inject('GET', '/v1/projects/map');
    expect(res.statusCode).toBe(200);
    const b = res.json().items.find((i: { project: { id: string } }) => i.project.id === ids.projectB);
    expect(b).toMatchObject({
      approximate: true,
      present: 1,
      address: 'Rue de la Station 4, 6041 Gosselies',
    });
    expect(b.latitude).toBeGreaterThan(50.2);
    const a = res.json().items.find((i: { project: { id: string } }) => i.project.id === ids.projectA);
    expect(a).toMatchObject({ latitude: null, address: null });
    expect(res.json().references.map((r: { name: string }) => r.name)).toContain('Charleroi');
  });
});

describe('M11 — comptabilité', () => {
  it('non connectée, puis connexion : rattrapage des documents de l’exercice en attente', async () => {
    let o = (await inject('GET', '/v1/accounting')).json() as AccountingOverviewDto;
    expect(o.connection.status).toBe('not_connected');
    expect(o.mapping.accounts.sales).toBe('700000');
    const res = await inject('POST', '/v1/accounting/connect');
    expect(res.statusCode).toBe(200);
    o = res.json();
    expect(o.connection).toMatchObject({ status: 'active', software: 'WinBooks (simulation)' });
    expect(o.ledger.journals.map((j) => j.code)).toContain('VEN');
    // 2 factures + 1 paiement + 1 achat de l'exercice (le worker les enverra).
    expect(o.counts.waiting).toBe(4);
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: 'accounting.sync_requested.v1' } }),
    );
    expect((events[0]!.payload as { syncIds: string[] }).syncIds).toHaveLength(4);
    const docs = (await inject('GET', '/v1/accounting/documents?type=invoice')).json()
      .items as AccountingSyncDto[];
    expect(docs.map((x) => x.number).sort()).toEqual(['2026-501', '2026-502']);
    expect(docs[0]!.link).toMatch(/^\/facturation\//);
  });

  it('paramétrage : comptes et journaux modifiables par l’administrateur, validés', async () => {
    const o = (await inject('GET', '/v1/accounting')).json() as AccountingOverviewDto;
    const bad = await inject('PUT', '/v1/accounting/mapping', {
      ...o.mapping,
      accounts: { ...o.mapping.accounts, sales: '' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await inject('PUT', '/v1/accounting/mapping', {
      ...o.mapping,
      accounts: { ...o.mapping.accounts, sales: '705000' },
    });
    expect(ok.json().mapping.accounts.sales).toBe('705000');
  });

  it('le Comptable lit, exporte et relance, mais ne change pas le paramétrage', async () => {
    const email = `compta-m11-${Date.now()}@example.test`;
    const inv = await inject('POST', '/v1/invitations', {
      email,
      role: 'accountant',
      name: 'Isabelle Lambert',
    });
    const token = `test-token-${Math.random().toString(36).slice(2)}-abcdefghij`;
    await withSystem(t.prisma, (tx) =>
      tx.invitation.update({
        where: { id: inv.json().id },
        data: { tokenHash: createHash('sha256').update(token).digest('hex') },
      }),
    );
    const accepted = await t.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token, name: 'Isabelle Lambert', password: 'motdepasse-solide-42' },
    });
    const accountant = { cookie: sessionCookie(accepted) };
    const o = (await inject('GET', '/v1/accounting', undefined, accountant)).json() as AccountingOverviewDto;
    expect(o.connection.status).toBe('active');
    expect((await inject('PUT', '/v1/accounting/mapping', o.mapping, accountant)).statusCode).toBe(403);
    expect((await inject('POST', '/v1/accounting/connect', undefined, accountant)).statusCode).toBe(403);
    expect((await inject('POST', '/v1/accounting/retry', undefined, accountant)).json().queued).toBe(4);
    const from = `${today.slice(0, 4)}-01-01`;
    const sales = await inject(
      'GET',
      `/v1/accounting/exports/sales?from=${from}&to=${today}&format=csv`,
      undefined,
      accountant,
    );
    expect(sales.statusCode).toBe(200);
    expect(sales.body).toContain('Journal;Numéro;Date;Échéance;Client');
    expect(sales.body).toContain('VEN;2026-501;');
    const payments = await inject(
      'GET',
      `/v1/accounting/exports/payments?from=${from}&to=${today}&format=csv`,
      undefined,
      accountant,
    );
    expect(payments.body).toContain('Encaissement;Lemaire SA;2026-502;4200,00');
    const ubl = await inject(
      'GET',
      `/v1/accounting/exports/sales-ubl?from=${from}&to=${today}`,
      undefined,
      accountant,
    );
    expect(ubl.statusCode).toBe(404);
    expect(ubl.json().error.message).toMatch(/Aucune facture UBL/);
    expect((await inject('GET', '/v1/dashboard', undefined, accountant)).statusCode).toBe(200);
  });

  it('isolation : un autre tenant ne voit ni synchros ni chiffres', async () => {
    const other = await signupCompany(t.app, 'Autre Pilotage');
    expect((await inject('GET', '/v1/accounting/documents', undefined, other)).json().items).toEqual([]);
    const d = (await inject('GET', '/v1/dashboard', undefined, other)).json() as DashboardDto;
    expect(d.kpis).toMatchObject({ invoiced: 0, collected: 0, outstanding: 0 });
    expect(d.projects).toEqual([]);
    expect((await inject('GET', '/v1/today', undefined, other)).json().sites).toEqual([]);
  });
});
