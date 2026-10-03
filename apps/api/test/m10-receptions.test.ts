/**
 * M10 — Réception et clôture (03 §5, 02 P10) contre un vrai Postgres : PV provisoire avec
 * réserves signé (numéro, PDF, statut et garantie du chantier), PV signé immuable, réserves
 * levées, facture finale (solde du contrat), PV définitif, clôture, rapport de rentabilité et
 * ajustement des prix de la bibliothèque, isolation.
 */
import type { InvoiceDto, ProfitabilityDto, ProjectReceptionDto, ReceptionDto } from '@batimint/contracts';
import { withSystem } from '@batimint/db';
import { addMonths, brusselsDate } from '@batimint/domain';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let projectId: string;
let itemId: string;
const posts = { carrelage: uuidv7(), plomberie: uuidv7() };
const sections = { carrelage: uuidv7(), plomberie: uuidv7() };
const provisionalId = uuidv7();
const finalId = uuidv7();
const reserves = [uuidv7(), uuidv7()];
const today = brusselsDate(new Date());

const inject = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
const outbox = (type: string) =>
  withSystem(t.prisma, (tx) => tx.outboxEvent.findMany({ where: { tenantId, type } }));
const reception = async () =>
  (await inject('GET', `/v1/projects/${projectId}/reception`)).json() as ProjectReceptionDto;

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Réception');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const customer = (
    await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont.m10@example.be',
    })
  ).json();
  projectId = uuidv7();
  await withSystem(t.prisma, async (tx) => {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        legalName: "Rénov'Habitat SRL",
        enterpriseNumber: '0123456749',
        vatNumber: 'BE0123456749',
        street: 'Rue de Montigny 112',
        postalCode: '6000',
        city: 'Charleroi',
        iban: 'BE71096123456769',
        bic: 'GKCCBEBB',
        settings: { retentionMonths: 12 },
      },
    });
    const item = await tx.item.create({
      data: {
        tenantId,
        code: 'FAI3060',
        kind: 'material',
        name: 'Faïence 30x60',
        unit: 'm²',
        purchasePrice: 2_500n,
      },
    });
    itemId = item.id;
    const quote = await tx.quote.create({
      data: {
        tenantId,
        customerId: customer.id,
        title: 'Salle de bain',
        status: 'signed',
        number: 'D2026-010',
      },
    });
    const version = await tx.quoteVersion.create({
      data: { tenantId, quoteId: quote.id, version: 1, status: 'signed' },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
    for (const [k, title, price] of [
      ['carrelage', 'Carrelage', 3_000_000n],
      ['plomberie', 'Plomberie', 2_000_000n],
    ] as const) {
      const s = await tx.quoteSection.create({
        data: {
          tenantId,
          versionId: version.id,
          key: sections[k],
          position: k === 'carrelage' ? 0 : 1,
          title,
        },
      });
      await tx.quoteLine.create({
        data: {
          tenantId,
          versionId: version.id,
          sectionId: s.id,
          key: uuidv7(),
          position: 0,
          kind: 'item',
          itemId: k === 'carrelage' ? item.id : null,
          description: title,
          unit: 'forfait',
          quantity: '1',
          unitPrice: price,
          vatRegime: 'standard_21',
          vatSuggested: 'standard_21',
        },
      });
    }
    await tx.project.create({
      data: {
        id: projectId,
        tenantId,
        number: 'CH2026-010',
        name: 'Salle de bain Dupont',
        customerId: customer.id,
        quoteId: quote.id,
        status: 'in_progress',
        contractAmount: 5_000_000n,
        retentionPercent: '5',
        startDate: new Date('2026-09-01T00:00:00Z'),
      },
    });
    await tx.budgetLine.createMany({
      data: [
        {
          id: posts.carrelage,
          tenantId,
          projectId,
          quoteSectionKey: sections.carrelage,
          position: 0,
          label: 'Carrelage',
          saleAmount: 3_000_000n,
          budgetedCost: 2_000_000n,
        },
        {
          id: posts.plomberie,
          tenantId,
          projectId,
          quoteSectionKey: sections.plomberie,
          position: 1,
          label: 'Plomberie',
          saleAmount: 2_000_000n,
          budgetedCost: 1_500_000n,
        },
      ],
    });
    // Le carrelage a coûté 15 % de plus que prévu ; la plomberie est dans le budget.
    await tx.projectCost.createMany({
      data: [
        {
          tenantId,
          projectId,
          budgetLineId: posts.carrelage,
          category: 'supplier_invoice',
          sourceType: 'test',
          sourceId: 'c1',
          label: 'Faïence',
          amount: 2_300_000n,
        },
        {
          tenantId,
          projectId,
          budgetLineId: posts.plomberie,
          category: 'supplier_invoice',
          sourceType: 'test',
          sourceId: 'p1',
          label: 'Sanitaires',
          amount: 1_450_000n,
        },
      ],
    });
  });
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe('M10 — réception provisoire', () => {
  it('prépare un PV avec réserves ; refuse une photo d’un autre chantier', async () => {
    const bad = await inject('PUT', `/v1/projects/${projectId}/receptions/${provisionalId}`, {
      kind: 'provisional',
      receptionDate: today,
      reserves: [{ id: uuidv7(), description: 'Joint', photoIds: [uuidv7()] }],
    });
    expect(bad.statusCode).toBe(400);
    const res = await inject('PUT', `/v1/projects/${projectId}/receptions/${provisionalId}`, {
      kind: 'provisional',
      receptionDate: today,
      attendees: 'M. Dupont, Karim Benali',
      reserves: [
        {
          id: reserves[0],
          description: 'Joint silicone de la baignoire à refaire',
          location: 'Salle de bain',
          budgetLineId: posts.carrelage,
        },
        { id: reserves[1], description: 'Carreau fêlé derrière la porte', budgetLineId: posts.carrelage },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json() as ReceptionDto;
    expect(r).toMatchObject({ status: 'draft', number: null, blockers: [] });
    expect(r.reserves.map((x) => x.description)).toEqual([
      'Joint silicone de la baignoire à refaire',
      'Carreau fêlé derrière la porte',
    ]);
    expect((await reception()).can).toMatchObject({ provisional: true, final: false, close: false });
  });

  it('signé : numéro, PDF, chantier en réception provisoire, garantie de 12 mois', async () => {
    const res = await inject('POST', `/v1/receptions/${provisionalId}/sign`, {
      signerName: 'Jean Dupont',
      acceptTerms: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json() as ReceptionDto;
    expect(r.number).toMatch(/^PV\d{4}-001$/);
    expect(r.signerName).toBe('Jean Dupont');
    expect(r.plannedFinalDate).toBe(addMonths(today, 12));
    const pdf = await inject('GET', r.pdfUrl!.replace('/api', ''));
    expect(pdf.statusCode).toBe(200);
    expect(pdf.payload.slice(0, 5)).toBe('%PDF-');
    const s = await reception();
    expect(s).toMatchObject({
      projectStatus: 'provisional_acceptance',
      provisionalAcceptedOn: today,
      finalAcceptancePlannedOn: addMonths(today, 12),
      openReserves: 2,
    });
    expect(s.can).toMatchObject({ final: false, finalInvoice: false });
    expect((await outbox('reception.signed.v1')).length).toBe(1);
    const sig = await withSystem(t.prisma, (tx) =>
      tx.signature.findFirst({ where: { subjectType: 'reception', subjectId: provisionalId } }),
    );
    expect(sig?.documentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un PV signé ne se modifie plus', async () => {
    const res = await inject('PUT', `/v1/projects/${projectId}/receptions/${provisionalId}`, {
      kind: 'provisional',
      receptionDate: today,
      reserves: [],
    });
    expect(res.statusCode).toBe(409);
    await expect(
      withSystem(t.prisma, (tx) =>
        tx.reception.update({ where: { id: provisionalId }, data: { notes: 'x' } }),
      ),
    ).rejects.toThrow(/ne se modifie pas/);
    expect(
      (await inject('POST', `/v1/receptions/${provisionalId}/sign`, { signerName: 'X Y', acceptTerms: true }))
        .statusCode,
    ).toBe(409);
  });

  it('la facture finale attend la levée des réserves', async () => {
    expect((await inject('POST', `/v1/projects/${projectId}/final-invoice`)).statusCode).toBe(409);
    for (const id of reserves) {
      const res = await inject('POST', `/v1/reserves/${id}/lift`);
      expect(res.statusCode, res.body).toBe(200);
    }
    const s = await reception();
    expect(s.openReserves).toBe(0);
    expect(s.can).toMatchObject({ final: true, finalInvoice: true });
    expect((await outbox('reserve.lifted.v1')).length).toBe(2);
    // Lever deux fois ne produit rien de plus.
    await inject('POST', `/v1/reserves/${reserves[0]}/lift`);
    expect((await outbox('reserve.lifted.v1')).length).toBe(2);
  });
});

describe('M10 — facture finale et réception définitive', () => {
  let finalInvoiceId: string;

  it('génère la facture finale : le solde du contrat, une seule fois', async () => {
    const res = await inject('POST', `/v1/projects/${projectId}/final-invoice`);
    expect(res.statusCode, res.body).toBe(200);
    finalInvoiceId = res.json().invoiceId;
    const again = await inject('POST', `/v1/projects/${projectId}/final-invoice`);
    expect(again.json().invoiceId).toBe(finalInvoiceId);
    const inv = (await inject('GET', `/v1/invoices/${finalInvoiceId}`)).json() as InvoiceDto;
    expect(inv).toMatchObject({ type: 'final', status: 'draft', totalNet: 5_000_000, totalGross: 6_050_000 });
    expect(inv.title).toMatch(/Facture finale/);
  });

  it('émise, la retenue de garantie de 5 % est retenue du paiement', async () => {
    const issued = await inject('POST', `/v1/invoices/${finalInvoiceId}/issue`);
    expect(issued.statusCode, issued.body).toBe(200);
    const inv = issued.json() as InvoiceDto;
    expect(inv.retentionAmount).toBe(302_500);
    expect(inv.balance).toBe(5_747_500);
    const pay = await inject('POST', `/v1/invoices/${finalInvoiceId}/payments`, {
      id: uuidv7(),
      amount: 5_747_500,
      receivedOn: today,
      method: 'transfer',
    });
    expect(pay.statusCode, pay.body).toBe(200);
    expect(pay.json().status).toBe('paid');
    expect((await reception()).retention).toMatchObject({ held: 302_500, released: 0 });
  });

  it('PV définitif : sans réserve, signé, chantier en réception définitive', async () => {
    const withReserve = await inject('PUT', `/v1/projects/${projectId}/receptions/${finalId}`, {
      kind: 'final',
      receptionDate: today,
      reserves: [{ id: uuidv7(), description: 'x' }],
    });
    expect(withReserve.statusCode).toBe(400);
    await inject('PUT', `/v1/projects/${projectId}/receptions/${finalId}`, {
      kind: 'final',
      receptionDate: today,
    });
    const res = await inject('POST', `/v1/receptions/${finalId}/sign`, {
      signerName: 'Jean Dupont',
      acceptTerms: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().number).toMatch(/^PV\d{4}-002$/);
    const s = await reception();
    expect(s).toMatchObject({ projectStatus: 'final_acceptance', finalAcceptedOn: today });
    expect(s.can.close).toBe(true);
  });

  it('clôture, rapport de rentabilité et ajustement de la bibliothèque', async () => {
    const closed = await inject('POST', `/v1/projects/${projectId}/close`);
    expect(closed.statusCode, closed.body).toBe(200);
    expect(closed.json().status).toBe('closed');
    expect((await outbox('project.closed.v1')).length).toBe(1);
    const r = (await inject('GET', `/v1/projects/${projectId}/profitability`)).json() as ProfitabilityDto;
    expect(r).toMatchObject({ revenue: 5_000_000, budgetedCost: 3_500_000, actualCost: 3_750_000 });
    expect(r.plannedMargin).toBe('0.3');
    expect(r.actualMargin).toBe('0.25');
    const carrelage = r.posts.find((p) => p.label === 'Carrelage')!;
    expect(carrelage).toMatchObject({
      actualCost: 2_300_000,
      costVariance: 300_000,
      costVarianceRatio: '0.15',
    });
    expect(r.suggestions).toEqual([
      expect.objectContaining({
        itemId,
        field: 'unitCost',
        current: '2500',
        suggested: '2875',
        itemCode: 'FAI3060',
      }),
    ]);
    const applied = await inject('POST', `/v1/projects/${projectId}/price-suggestions/apply`, {
      items: [{ itemId, field: 'unitCost', value: '2875' }],
    });
    expect(applied.json()).toEqual({ updated: 1 });
    const item = await withSystem(t.prisma, (tx) => tx.item.findUniqueOrThrow({ where: { id: itemId } }));
    expect(item.purchasePrice).toBe(2_875n);
    const history = await withSystem(t.prisma, (tx) => tx.priceHistory.count({ where: { itemId } }));
    expect(history).toBe(1);
  });

  it('un autre tenant ne voit rien', async () => {
    const other = await signupCompany(t.app, 'Autre Réception');
    expect((await inject('GET', `/v1/projects/${projectId}/reception`, undefined, other)).statusCode).toBe(
      404,
    );
    expect((await inject('GET', `/v1/receptions/${provisionalId}/pdf`, undefined, other)).statusCode).toBe(
      404,
    );
  });
});
