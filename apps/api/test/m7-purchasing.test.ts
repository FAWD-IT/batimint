/**
 * M7 — Achats et Peppol entrant (03 §8, 02 P3.3, P6) contre un vrai Postgres : proposition de
 * commande depuis le devis, BC numéroté à l'envoi, réception, facture reçue par Peppol (webhook
 * et simulation), dépôt UBL, ventilation manuelle multi-chantiers, statuts, droits, isolation.
 */
import { withSystem } from '@batimint/db';
import { buildSimpleUbl } from '@batimint/documents';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let supplierId: string;
const projectId = uuidv7();
const otherProjectId = uuidv7();
const posts = { carrelage: uuidv7(), plomberie: uuidv7() };
const sectionKeys = { carrelage: uuidv7(), plomberie: uuidv7() };

const inject = (
  method: 'GET' | 'POST' | 'DELETE',
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
  withSystem(t.prisma, (tx) =>
    tx.outboxEvent.findMany({ where: { tenantId, type }, orderBy: { occurredAt: 'asc' } }),
  );

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Achats');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const customer = (
    await inject('POST', '/v1/customers', { kind: 'individual', firstName: 'Jean', lastName: 'Dupont' })
  ).json();
  const site = (
    await inject('POST', `/v1/customers/${customer.id}/sites`, {
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      isPrivateDwelling: true,
      firstOccupancyYear: 1975,
    })
  ).json();
  const supplier = (
    await inject('POST', '/v1/suppliers', {
      name: 'Brico Pro SA',
      enterpriseNumber: '0412.345.614',
      orderEmail: 'commandes@brico-pro.example.be',
    })
  ).json();
  supplierId = supplier.id;
  await withSystem(t.prisma, async (tx) => {
    await tx.supplier.update({ where: { id: supplierId }, data: { vatNumber: 'BE0412345614' } });
    const item = await tx.item.create({
      data: {
        tenantId,
        code: 'FAI3060',
        kind: 'material',
        name: 'Faïence 30x60',
        unit: 'm²',
        supplierId,
        purchasePrice: 2_500n,
        salePrice: 4_000n,
      },
    });
    await tx.supplierPrice.create({
      data: {
        tenantId,
        supplierId,
        supplierCode: 'FAI-3060',
        label: 'Faïence',
        price: 2_500n,
        itemId: item.id,
      },
    });
    // Devis signé : une section carrelage (faïence + pose), une section plomberie (ligne libre de fourniture).
    const quote = await tx.quote.create({
      data: {
        tenantId,
        number: 'D2026-050',
        title: 'Salle de bain',
        customerId: customer.id,
        status: 'signed',
      },
    });
    const version = await tx.quoteVersion.create({
      data: { tenantId, quoteId: quote.id, version: 1, status: 'signed' },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
    const s1 = await tx.quoteSection.create({
      data: {
        tenantId,
        versionId: version.id,
        key: sectionKeys.carrelage,
        position: 0,
        title: 'Carrelage',
        // Section obligatoire : « selected » ne concerne que les options (comme dans l'éditeur).
        selected: false,
      },
    });
    const s2 = await tx.quoteSection.create({
      data: {
        tenantId,
        versionId: version.id,
        key: sectionKeys.plomberie,
        position: 1,
        title: 'Plomberie',
        selected: true,
      },
    });
    await tx.quoteLine.createMany({
      data: [
        {
          tenantId,
          versionId: version.id,
          sectionId: s1.id,
          key: uuidv7(),
          position: 0,
          kind: 'item',
          itemId: item.id,
          description: 'Faïence 30x60',
          unit: 'm²',
          quantity: '20',
          unitPrice: 4_000n,
          unitCost: 2_500n,
          laborHours: '0',
          vatRegime: 'reduced_6',
          vatSuggested: 'reduced_6',
        },
        {
          tenantId,
          versionId: version.id,
          sectionId: s1.id,
          key: uuidv7(),
          position: 1,
          kind: 'item',
          description: 'Pose faïence',
          unit: 'm²',
          quantity: '20',
          unitPrice: 3_500n,
          unitCost: 2_000n,
          laborHours: '0.8',
          vatRegime: 'reduced_6',
          vatSuggested: 'reduced_6',
        },
        {
          tenantId,
          versionId: version.id,
          sectionId: s2.id,
          key: uuidv7(),
          position: 0,
          kind: 'item',
          description: 'Mitigeur thermostatique',
          unit: 'pce',
          quantity: '1',
          unitPrice: 30_000n,
          unitCost: 18_000n,
          laborHours: '0',
          vatRegime: 'reduced_6',
          vatSuggested: 'reduced_6',
        },
      ],
    });
    for (const [id, number, name] of [
      [projectId, 'CH2026-050', 'Salle de bain Dupont'],
      [otherProjectId, 'CH2026-051', 'Cuisine Lemaire'],
    ] as const)
      await tx.project.create({
        data: {
          id,
          tenantId,
          number,
          name,
          customerId: customer.id,
          siteId: id === projectId ? site.id : null,
          status: 'in_progress',
          contractAmount: 1_000_000n,
          quoteId: id === projectId ? quote.id : null,
        },
      });
    await tx.budgetLine.createMany({
      data: [
        {
          id: posts.carrelage,
          tenantId,
          projectId,
          position: 0,
          label: 'Carrelage',
          quoteSectionKey: sectionKeys.carrelage,
          budgetedCost: 100_000n,
          saleAmount: 150_000n,
        },
        {
          id: posts.plomberie,
          tenantId,
          projectId,
          position: 1,
          label: 'Plomberie',
          quoteSectionKey: sectionKeys.plomberie,
          budgetedCost: 50_000n,
          saleAmount: 80_000n,
        },
      ],
    });
  });
});

afterAll(async () => {
  await t?.close();
});

describe('M7 — achats', () => {
  const poId = uuidv7();

  it('proposition : seuls les matériaux, groupés par fournisseur préféré', async () => {
    const res = await inject('GET', `/v1/projects/${projectId}/order-proposal`);
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups;
    expect(groups.map((g: { supplierName: string | null }) => g.supplierName)).toEqual([
      'Brico Pro SA',
      null,
    ]);
    expect(groups[0].lines).toEqual([
      expect.objectContaining({
        description: 'Faïence 30x60',
        supplierCode: 'FAI-3060',
        quantity: '20',
        unitPrice: 2_500,
        budgetLineLabel: 'Carrelage',
        alreadyOrdered: false,
      }),
    ]);
    expect(groups[1].lines[0]).toMatchObject({
      description: 'Mitigeur thermostatique',
      budgetLineId: posts.plomberie,
    });
  });

  it('BC : brouillon, envoi numéroté (PDF, e-mail), figé ; réception partielle', async () => {
    const proposal = (await inject('GET', `/v1/projects/${projectId}/order-proposal`)).json().groups[0];
    const draft = await inject('POST', '/v1/purchase-orders', {
      id: poId,
      projectId,
      supplierId,
      lines: proposal.lines.map(
        ({ budgetLineLabel: _b, alreadyOrdered: _a, ...l }: Record<string, unknown>) => l,
      ),
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      status: 'draft',
      number: null,
      totalNet: 50_000,
      deliveryAddress: 'Rue de la Station 42, 6040 Jumet',
    });
    const sent = await inject('POST', `/v1/purchase-orders/${poId}/send`, {});
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'sent', sentTo: 'commandes@brico-pro.example.be' });
    expect(sent.json().number).toMatch(/^BC\d{4}-001$/);
    expect((await inject('POST', `/v1/purchase-orders/${poId}/send`, {})).statusCode).toBe(409);
    expect(
      (
        await inject('POST', '/v1/purchase-orders', {
          id: poId,
          projectId,
          supplierId,
          lines: proposal.lines
            .slice(0, 1)
            .map(({ budgetLineLabel: _b, alreadyOrdered: _a, ...l }: Record<string, unknown>) => l),
        })
      ).statusCode,
    ).toBe(409);
    const pdf = await inject('GET', `/v1/purchase-orders/${poId}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await outbox('purchase_order.sent.v1')).length).toBe(1);
    const again = (await inject('GET', `/v1/projects/${projectId}/order-proposal`)).json().groups[0];
    expect(again.lines[0].alreadyOrdered).toBe(true);
    const lineId = sent.json().lines[0].id;
    const received = await inject('POST', `/v1/purchase-orders/${poId}/receipts`, {
      lines: [{ lineId, quantity: '12' }],
    });
    expect(received.json()).toMatchObject({ status: 'partially_received' });
    expect(received.json().lines[0].receivedQuantity).toBe('12');
  });

  it('facture Peppol simulée : enregistrée avec ses lignes et son document, événement de réception', async () => {
    const number = (await inject('GET', `/v1/purchase-orders/${poId}`)).json().number;
    const res = await inject('POST', '/v1/integrations/peppol/simulate-inbound', {
      supplierId,
      number: 'F-2026-0912',
      orderReference: number,
      lines: [
        {
          description: 'Faïence 30x60',
          supplierCode: 'FAI-3060',
          quantity: '20',
          unitPrice: 2_500,
          vatRate: '21',
        },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      source: 'peppol',
      status: 'received',
      supplier: { id: supplierId, name: 'Brico Pro SA' },
      totalNet: 50_000,
      totalVat: 10_500,
      totalGross: 60_500,
      orderReference: number,
    });
    const doc = await inject('GET', `/v1/supplier-invoices/${res.json().id}/document`);
    expect(doc.body).toContain('<cbc:ID>F-2026-0912</cbc:ID>');
    expect((await outbox('supplier_invoice.received.v1')).length).toBe(1);
  });

  it('webhook Peppol : entité inconnue refusée ; document reçu une seule fois (déduplication)', async () => {
    const ubl = buildSimpleUbl({
      number: 'F-777',
      issueDate: '2026-10-01',
      supplier: { name: 'Facq', vatNumber: 'BE0400111241', enterpriseNumber: '0400111241' },
      buyer: { name: 'Rénov Achats', vatNumber: null, enterpriseNumber: null },
      lines: [{ description: 'Raccords', quantity: '10', unitPrice: 150n, vatRate: '21' }],
    });
    const post = (legalEntityId: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/webhooks/peppol',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          type: 'document.received',
          data: { legalEntityId, documentId: 'doc-777', ubl },
        }),
      });
    expect((await post('le-inconnue')).statusCode).toBe(404);
    await withSystem(t.prisma, (tx) =>
      tx.integrationConnection.upsert({
        where: { tenantId_kind: { tenantId, kind: 'peppol' } },
        create: { tenantId, kind: 'peppol', provider: 'mock', status: 'active', externalId: 'le-achats' },
        update: { externalId: 'le-achats' },
      }),
    );
    expect((await post('le-achats')).statusCode).toBe(202);
    expect((await post('le-achats')).statusCode).toBe(202);
    const rows = await withSystem(t.prisma, (tx) =>
      tx.supplierInvoice.findMany({ where: { tenantId, externalId: 'doc-777' } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ supplierName: 'Facq', supplierId: null, totalNet: 1_500n });
  });

  it('dépôt UBL, puis ventilation manuelle sur deux chantiers (somme exacte exigée)', async () => {
    const xml = buildSimpleUbl({
      number: 'F-2026-1000',
      issueDate: '2026-10-01',
      supplier: { name: 'Brico Pro SA', vatNumber: 'BE0412345614', enterpriseNumber: '0412345614' },
      buyer: { name: 'Rénov Achats', vatNumber: null, enterpriseNumber: null },
      lines: [{ description: 'Silicone sanitaire', quantity: '10', unitPrice: 1_000n, vatRate: '21' }],
    });
    const up = await t.app.inject({
      method: 'POST',
      url: '/v1/supplier-invoices/upload',
      headers: { cookie: owner.cookie, 'content-type': 'application/xml', 'x-file-name': 'facture.xml' },
      payload: Buffer.from(xml),
    });
    expect(up.statusCode).toBe(201);
    const id = up.json().id;
    expect(up.json()).toMatchObject({ source: 'upload', supplier: { id: supplierId }, totalNet: 10_000 });
    const wrong = await inject('POST', `/v1/supplier-invoices/${id}/allocate`, {
      allocations: [{ projectId, budgetLineId: posts.carrelage, amount: 9_000 }],
    });
    expect(wrong.json().error.code).toBe('allocation_total');
    const ok = await inject('POST', `/v1/supplier-invoices/${id}/allocate`, {
      allocations: [
        { projectId, budgetLineId: posts.plomberie, amount: 6_000 },
        { projectId: otherProjectId, budgetLineId: null, amount: 4_000 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'allocated', matchMethod: 'manual' });
    expect(ok.json().allocations.map((a: { amount: number }) => a.amount)).toEqual([6_000, 4_000]);
    const ev = await outbox('supplier_invoice.allocated.v1');
    expect(ev.at(-1)!.payload).toMatchObject({
      invoiceId: id,
      automatic: false,
      projectIds: [projectId, otherProjectId],
    });
    // Statuts : validée → à payer → payée ; pas de retour arrière arbitraire.
    expect((await inject('POST', `/v1/supplier-invoices/${id}/status`, { to: 'paid' })).statusCode).toBe(409);
    for (const to of ['validated', 'to_pay', 'paid'])
      expect((await inject('POST', `/v1/supplier-invoices/${id}/status`, { to })).json().status).toBe(to);
    expect(
      (
        await inject('POST', `/v1/supplier-invoices/${id}/allocate`, {
          allocations: [{ projectId, budgetLineId: null, amount: 10_000 }],
        })
      ).statusCode,
    ).toBe(409);
  });

  it('boîte « À imputer » et isolation entre entreprises', async () => {
    const inbox = (await inject('GET', '/v1/supplier-invoices?view=inbox')).json();
    expect(inbox.counts.inbox).toBe(2); // simulée + webhook, en attente du worker
    const other = await signupCompany(t.app, 'Autre BTP');
    expect(
      (await inject('GET', '/v1/supplier-invoices?view=all', undefined, other)).json().items,
    ).toHaveLength(0);
    expect((await inject('GET', `/v1/purchase-orders/${poId}`, undefined, other)).statusCode).toBe(404);
    expect(
      (await inject('GET', `/v1/projects/${projectId}/order-proposal`, undefined, other)).json().groups,
    ).toEqual([]);
  });
});
