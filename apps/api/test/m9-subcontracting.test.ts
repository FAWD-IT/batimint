/**
 * M9 — Sous-traitance et conformité (03 §9, 05 §7, 02 P9) contre un vrai Postgres : contrat avec
 * contrôle 30bis à la création, les deux chemins 30bis avant paiement (sans dette → à payer ;
 * avec dette → bloquée, retenue, document de versement, payée), preuve immuable, documents et
 * échéances, portail sous-traitant (missions, dépôt de document et de facture), déclaration de
 * travaux, isolation entre tenants.
 */
import { createPortalToken, withSystem } from '@batimint/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let cleanId: string;
let debtorId: string;
let noNumberId: string;
const projectId = uuidv7();
const postId = uuidv7();
const cleanContract = uuidv7();
const debtorContract = uuidv7();

const inject = (
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  url: string,
  payload?: unknown,
  s: { cookie: string } = owner,
  headers: Record<string, string> = {},
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie, ...headers },
    ...(payload !== undefined
      ? Buffer.isBuffer(payload)
        ? { payload }
        : { payload: payload as object }
      : {}),
  });

const outbox = (type: string) =>
  withSystem(t.prisma, (tx) => tx.outboxEvent.findMany({ where: { tenantId, type } }));

async function supplier(name: string, enterpriseNumber: string | null, email: string) {
  const res = await inject('POST', '/v1/suppliers', {
    name,
    ...(enterpriseNumber ? { enterpriseNumber } : {}),
    email,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

async function invoiceFor(subcontractId: string, supplierId: string, net: bigint, vat: bigint) {
  const id = uuidv7();
  await withSystem(t.prisma, (tx) =>
    tx.supplierInvoice.create({
      data: {
        id,
        tenantId,
        source: 'upload',
        supplierId,
        supplierName: 'Sous-traitant',
        number: `F-${id.slice(-4)}`,
        totalNet: net,
        totalVat: vat,
        totalGross: net + vat,
        status: 'validated',
        subcontractId,
        projectId,
      },
    }),
  );
  return id;
}

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Sous-traitance');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const customer = (
    await inject('POST', '/v1/customers', { kind: 'individual', firstName: 'Jean', lastName: 'Dupont' })
  ).json();
  await withSystem(t.prisma, async (tx) => {
    await tx.project.create({
      data: {
        id: projectId,
        tenantId,
        number: 'CH2026-090',
        name: 'Rénovation Dupont',
        customerId: customer.id,
        status: 'in_progress',
        contractAmount: 1_000_000n,
      },
    });
    await tx.budgetLine.create({
      data: { id: postId, tenantId, projectId, position: 0, label: 'Électricité', budgetedCost: 500_000n },
    });
  });
  cleanId = await supplier('Électro Pirson SPRL', '0456.789.034', 'contact@pirson.example.be');
  // Mock 30bis : « 99 » avant le contrôle = dette sociale (25 000 €).
  debtorId = await supplier('Façades Debt SRL', '0712.349.984', 'compta@facades.example.be');
  noNumberId = await supplier('Sans Numéro', null, 'x@sans-numero.example.be');
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe('M9 — contrats et 30bis', () => {
  it('refuse un contrat sans numéro d’entreprise (pas de consultation possible)', async () => {
    const res = await inject('POST', '/v1/subcontracts', {
      id: uuidv7(),
      projectId,
      supplierId: noNumberId,
      title: 'Électricité',
      amount: 100_000,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/numéro d’entreprise/);
  });

  it('refuse un échéancier qui ne fait pas 100 %', async () => {
    const res = await inject('POST', '/v1/subcontracts', {
      id: uuidv7(),
      projectId,
      supplierId: cleanId,
      title: 'Électricité',
      amount: 100_000,
      installments: [{ label: 'Acompte', percent: '40' }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/40 %/);
  });

  it('conclut un contrat sur un poste : numéro, échéancier, consultation 30bis, PDF, événements', async () => {
    const body = {
      id: cleanContract,
      projectId,
      budgetLineId: postId,
      supplierId: cleanId,
      title: 'Électricité complète',
      scope: 'Tableau, circuits, prises',
      amount: 1_240_000,
      startDate: '2026-10-12',
      endDate: '2026-10-23',
      installments: [
        { label: 'Au démarrage', percent: '30' },
        { label: 'À la réception', percent: '70' },
      ],
    };
    const res = await inject('POST', '/v1/subcontracts', body);
    expect(res.statusCode, res.body).toBe(201);
    const s = res.json();
    expect(s.number).toMatch(/^ST\d{4}-001$/);
    expect(s.budgetLine.label).toBe('Électricité');
    expect(s.installments.map((i: { amount: number }) => i.amount)).toEqual([372_000, 868_000]);
    expect(s.creationCheck).toMatchObject({ context: 'contract', hasSocialDebt: false, hasTaxDebt: false });
    expect(s.creationCheck.proofUrl).toBeTruthy();
    // Idempotent (identifiant client) : même contrat, pas de nouveau numéro.
    const again = await inject('POST', '/v1/subcontracts', body);
    expect(again.json().number).toBe(s.number);
    const pdf = await inject('GET', `/v1/subcontracts/${cleanContract}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await outbox('subcontract.created.v1')).length).toBe(1);
    expect((await outbox('thirty_bis.checked.v1')).length).toBe(1);
    const proof = await inject('GET', s.creationCheck.proofUrl.replace('/api', ''));
    expect(proof.statusCode).toBe(200);
    expect(proof.payload.slice(0, 5)).toBe('%PDF-');
  });

  it('signale la dette dès la création du contrat', async () => {
    const res = await inject('POST', '/v1/subcontracts', {
      id: debtorContract,
      projectId,
      budgetLineId: postId,
      supplierId: debtorId,
      title: 'Façade',
      amount: 2_000_000,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().creationCheck).toMatchObject({ hasSocialDebt: true, socialDebtAmount: 2_500_000 });
  });

  it('la preuve 30bis ne se modifie pas', async () => {
    await expect(
      withSystem(t.prisma, (tx) =>
        tx.thirtyBisCheck.updateMany({ where: { supplierId: debtorId }, data: { hasSocialDebt: false } }),
      ),
    ).rejects.toThrow(/preuve/);
  });

  it('chemin « sans dette » : consultation du jour puis mise à payer', async () => {
    const id = await invoiceFor(cleanContract, cleanId, 372_000n, 78_120n);
    const res = await inject('POST', `/v1/supplier-invoices/${id}/status`, { to: 'to_pay' });
    expect(res.statusCode, res.body).toBe(200);
    const i = res.json();
    expect(i.status).toBe('to_pay');
    expect(i.isSubcontractor).toBe(true);
    expect(i.subcontract.number).toMatch(/^ST/);
    expect(i.thirtyBis).toMatchObject({ social: 0, tax: 0, payableToSubcontractor: 450_120 });
    expect(i.thirtyBis.check.context).toBe('payment');
    const paid = await inject('POST', `/v1/supplier-invoices/${id}/status`, { to: 'paid' });
    expect(paid.json().status).toBe('paid');
    // Une seule consultation « paiement » le même jour.
    const checks = await withSystem(t.prisma, (tx) =>
      tx.thirtyBisCheck.count({ where: { supplierInvoiceId: id, context: 'payment' } }),
    );
    expect(checks).toBe(1);
  });

  it('chemin « avec dette » : bloquée, retenue, document de versement, puis payée', async () => {
    const id = await invoiceFor(debtorContract, debtorId, 1_000_000n, 210_000n);
    const blocked = await inject('POST', `/v1/supplier-invoices/${id}/status`, { to: 'to_pay' });
    expect(blocked.statusCode, blocked.body).toBe(200);
    const b = blocked.json();
    expect(b.status).toBe('blocked');
    expect(b.thirtyBis).toMatchObject({
      social: 350_000,
      tax: 0,
      payableToSubcontractor: 860_000,
      appliedAt: null,
    });
    expect(b.thirtyBis.blockedReason).toMatch(/dettes sociales/);
    expect((await outbox('supplier_invoice.blocked_thirty_bis.v1')).length).toBe(1);
    // Le paiement normal reste bloqué tant que la retenue n'est pas appliquée.
    const retry = await inject('POST', `/v1/supplier-invoices/${id}/status`, { to: 'to_pay' });
    expect(retry.json().status).toBe('blocked');

    const applied = await inject('POST', `/v1/supplier-invoices/${id}/withholding`);
    expect(applied.statusCode, applied.body).toBe(200);
    const a = applied.json();
    expect(a.status).toBe('to_pay');
    expect(a.thirtyBis.appliedAt).toBeTruthy();
    expect(a.thirtyBis.transferDocumentUrl).toBeTruthy();
    const doc = await inject('GET', a.thirtyBis.transferDocumentUrl.replace('/api', ''));
    expect(doc.statusCode).toBe(200);
    expect(doc.headers['content-type']).toBe('application/pdf');

    const paid = await inject('POST', `/v1/supplier-invoices/${id}/status`, { to: 'paid' });
    expect(paid.json().status).toBe('paid');
    const contract = (await inject('GET', `/v1/subcontracts/${debtorContract}`)).json();
    expect(contract.withheld).toBe(350_000);
    expect(contract.invoiced).toBe(1_000_000);
    const audit = await withSystem(t.prisma, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, entityId: id }, orderBy: { occurredAt: 'asc' } }),
    );
    expect(audit.map((x) => x.action)).toEqual([
      'supplier_invoice.blocked',
      'supplier_invoice.blocked',
      'supplier_invoice.withholding_applied',
      'supplier_invoice.paid',
    ]);
  });

  it('modifie puis clôture un contrat ; un contrat facturé ne s’annule pas', async () => {
    const res = await inject('PATCH', `/v1/subcontracts/${cleanContract}`, { amount: 1_300_000 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().installments.map((i: { amount: number }) => i.amount)).toEqual([390_000, 910_000]);
    const cancel = await inject('POST', `/v1/subcontracts/${cleanContract}/status`, { to: 'cancelled' });
    expect(cancel.statusCode).toBe(409);
    const done = await inject('POST', `/v1/subcontracts/${cleanContract}/status`, { to: 'completed' });
    expect(done.json().status).toBe('completed');
    const locked = await inject('PATCH', `/v1/subcontracts/${cleanContract}`, { title: 'X' });
    expect(locked.statusCode).toBe(409);
    await inject('POST', `/v1/subcontracts/${cleanContract}/status`, { to: 'active' });
  });
});

describe('M9 — documents, fiche et déclaration de travaux', () => {
  it('dépose des documents avec échéance et calcule la conformité', async () => {
    const pdf = Buffer.from('%PDF-1.4 attestation');
    const up = await inject(
      'POST',
      `/v1/subcontractors/${cleanId}/documents?kind=rc_insurance&expiresOn=2020-01-31`,
      pdf,
      owner,
      { 'content-type': 'application/pdf', 'x-file-name': 'rc.pdf' },
    );
    expect(up.statusCode, up.body).toBe(201);
    expect(up.json().status).toBe('expired');
    const detail = (await inject('GET', `/v1/subcontractors/${cleanId}`)).json();
    expect(detail.compliance.compliant).toBe(false);
    expect(detail.compliance.requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'rc_insurance', status: 'expired' }),
        expect.objectContaining({ kind: 'social_certificate', status: 'missing' }),
      ]),
    );
    expect(detail.contracts).toHaveLength(1);
    expect(detail.checks.length).toBeGreaterThanOrEqual(2);
    const file = await inject('GET', detail.documents[0].url.replace('/api', ''));
    expect(file.statusCode).toBe(200);
    const list = (await inject('GET', '/v1/subcontractors')).json().items;
    expect(list.map((s: { name: string }) => s.name)).toEqual(
      expect.arrayContaining(['Électro Pirson SPRL', 'Façades Debt SRL']),
    );
  });

  it('consultation manuelle et invitation au portail', async () => {
    const c = await inject('POST', `/v1/subcontractors/${debtorId}/thirty-bis-check`);
    expect(c.statusCode, c.body).toBe(200);
    expect(c.json()).toMatchObject({ context: 'manual', hasSocialDebt: true });
    const inv = await inject('POST', `/v1/subcontractors/${cleanId}/invite`, {
      subcontractId: cleanContract,
    });
    expect(inv.json().email).toBe('contact@pirson.example.be');
    expect((await outbox('subcontractor.invited.v1')).length).toBe(1);
  });

  it('déclaration de travaux : requise avec un sous-traitant, données pré-remplies, référence', async () => {
    const d = (await inject('GET', `/v1/projects/${projectId}/works-declaration`)).json();
    expect(d).toMatchObject({ required: true, reasons: ['subcontractor'], declaredAt: null });
    expect(d.data.subcontractors).toHaveLength(2);
    const saved = await inject('POST', `/v1/projects/${projectId}/works-declaration`, {
      reference: 'DT-2026-001234',
      declaredOn: '2026-10-05',
    });
    expect(saved.json()).toMatchObject({ reference: 'DT-2026-001234' });
    expect(saved.json().declaredAt).toBeTruthy();
  });
});

describe('M9 — portail sous-traitant', () => {
  let token: string;
  beforeAll(async () => {
    token = (
      await withSystem(t.prisma, (tx) =>
        createPortalToken(tx, { tenantId, kind: 'subcontractor', supplierId: cleanId }),
      )
    ).token;
  });

  it('montre les missions et les documents à fournir', async () => {
    const res = await t.app.inject({ method: 'GET', url: `/v1/portal/subcontractors/${token}` });
    expect(res.statusCode, res.body).toBe(200);
    const p = res.json();
    expect(p.subcontractor.name).toBe('Électro Pirson SPRL');
    expect(p.missions).toHaveLength(1);
    expect(p.missions[0]).toMatchObject({ title: 'Électricité complète', amount: 1_300_000 });
    expect(p.compliance.issues).toBe(3);
    const pdf = await t.app.inject({ method: 'GET', url: p.missions[0].pdfUrl.replace('/api', '') });
    expect(pdf.statusCode).toBe(200);
  });

  it('dépose un document et une facture pour une mission', async () => {
    const doc = await t.app.inject({
      method: 'POST',
      url: `/v1/portal/subcontractors/${token}/documents?kind=social_certificate&expiresOn=2027-06-30`,
      payload: Buffer.from('%PDF-1.4 onss'),
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'onss.pdf' },
    });
    expect(doc.statusCode, doc.body).toBe(201);
    expect(doc.json().compliance.issues).toBe(2);
    const id = uuidv7();
    const inv = await t.app.inject({
      method: 'POST',
      url: `/v1/portal/subcontractors/${token}/invoices?subcontractId=${cleanContract}&id=${id}`,
      payload: Buffer.from('%PDF-1.4 facture'),
      headers: { 'content-type': 'application/pdf', 'x-file-name': 'facture-12.pdf' },
    });
    expect(inv.statusCode, inv.body).toBe(201);
    expect(inv.json().invoices.find((i: { id: string }) => i.id === id)).toMatchObject({
      state: 'received',
      missionNumber: expect.stringMatching(/^ST/),
    });
    const row = await withSystem(t.prisma, (tx) => tx.supplierInvoice.findUniqueOrThrow({ where: { id } }));
    expect(row).toMatchObject({ supplierId: cleanId, subcontractId: cleanContract, source: 'upload' });
    expect((await outbox('subcontractor.document_uploaded.v1')).length).toBe(1);
  });

  it('refuse la mission d’un autre sous-traitant et un lien invalide', async () => {
    const other = await t.app.inject({
      method: 'POST',
      url: `/v1/portal/subcontractors/${token}/invoices?subcontractId=${debtorContract}`,
      payload: Buffer.from('%PDF-1.4'),
      headers: { 'content-type': 'application/pdf' },
    });
    expect(other.statusCode).toBe(404);
    const bad = await t.app.inject({ method: 'GET', url: `/v1/portal/subcontractors/${'x'.repeat(40)}` });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().error.message).toMatch(/plus valable/);
  });
});

describe('M9 — isolation', () => {
  it('un autre tenant ne voit ni contrats, ni sous-traitants, ni preuves', async () => {
    const other = await signupCompany(t.app, 'Autre Entreprise');
    expect((await inject('GET', `/v1/subcontracts/${cleanContract}`, undefined, other)).statusCode).toBe(404);
    expect((await inject('GET', '/v1/subcontracts', undefined, other)).json().items).toHaveLength(0);
    expect((await inject('GET', '/v1/subcontractors', undefined, other)).json().items).toHaveLength(0);
    expect((await inject('GET', `/v1/subcontractors/${cleanId}`, undefined, other)).statusCode).toBe(404);
  });
});
