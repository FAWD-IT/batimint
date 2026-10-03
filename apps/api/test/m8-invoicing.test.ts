/**
 * M8 — Facturation et encaissement (03 §10, 05, 02 P7, P8) contre un vrai Postgres : acompte,
 * état d'avancement pré-rempli et approuvé sur le portail, facture générée avec déduction de
 * l'acompte, émission immuable et numérotée sans trou (même en concurrence), documents rangés,
 * paiements, lien de paiement, note de crédit, B2B sans approbation, isolation et droits.
 */
import { createHash } from 'node:crypto';
import type { InvoiceDto, ProgressStatementDto } from '@batimint/contracts';
import { withSystem } from '@batimint/db';
import { isValidStructuredCommunication } from '@batimint/domain';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto';
import { createTestApp, sessionCookie, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let projectId: string;
let customerId: string;
let portalToken: string;
const posts = { demolition: uuidv7(), carrelage: uuidv7(), plomberie: uuidv7() };
const sections = { demolition: uuidv7(), carrelage: uuidv7(), plomberie: uuidv7() };

const inject = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  s: SignedUp | { cookie: string } = owner,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
const portal = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({ method, url, ...(payload !== undefined ? { payload: payload as object } : {}) });
const invoice = async (id: string): Promise<InvoiceDto> => (await inject('GET', `/v1/invoices/${id}`)).json();

async function issue(id: string): Promise<InvoiceDto> {
  const res = await inject('POST', `/v1/invoices/${id}/issue`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Facturation');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const dupont = (
    await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont.m8@example.be',
    })
  ).json();
  customerId = dupont.id;
  const site = (
    await inject('POST', `/v1/customers/${dupont.id}/sites`, {
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      isPrivateDwelling: true,
      firstOccupancyYear: 1975,
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
        structuredCommPrefix: 104,
      },
    });
    const quote = await tx.quote.create({
      data: {
        tenantId,
        customerId: dupont.id,
        siteId: site.id,
        title: 'Salle de bain',
        status: 'signed',
        number: 'D2026-001',
      },
    });
    const version = await tx.quoteVersion.create({
      data: { tenantId, quoteId: quote.id, version: 1, status: 'signed' },
    });
    await tx.quote.update({ where: { id: quote.id }, data: { currentVersionId: version.id } });
    const mk = async (
      key: string,
      title: string,
      position: number,
      lines: { unit: string; q: string; p: bigint }[],
    ) => {
      const s = await tx.quoteSection.create({
        data: { tenantId, versionId: version.id, key, position, title },
      });
      await tx.quoteLine.createMany({
        data: lines.map((l, i) => ({
          tenantId,
          versionId: version.id,
          sectionId: s.id,
          key: uuidv7(),
          position: i,
          kind: 'item',
          description: `${title} ${i + 1}`,
          unit: l.unit,
          quantity: l.q,
          unitPrice: l.p,
          vatRegime: 'reduced_6',
          vatSuggested: 'reduced_6',
        })),
      });
    };
    await mk(sections.demolition, 'Démolition', 0, [{ unit: 'forfait', q: '1', p: 2_000_000n }]);
    await mk(sections.carrelage, 'Carrelage', 1, [{ unit: 'm²', q: '40', p: 75_000n }]);
    await mk(sections.plomberie, 'Plomberie', 2, [{ unit: 'forfait', q: '1', p: 5_000_000n }]);
    await tx.project.create({
      data: {
        id: projectId,
        tenantId,
        number: 'CH2026-001',
        name: 'Rénovation salle de bain Dupont',
        customerId: dupont.id,
        siteId: site.id,
        quoteId: quote.id,
        status: 'in_progress',
        contractAmount: 10_000_000n,
        startDate: new Date('2026-09-01T00:00:00Z'),
      },
    });
    const post = (id: string, key: string, position: number, label: string, sale: bigint) => ({
      id,
      tenantId,
      projectId,
      quoteSectionKey: key,
      position,
      label,
      saleAmount: sale,
      budgetedCost: (sale * 7n) / 10n,
    });
    await tx.budgetLine.createMany({
      data: [
        post(posts.demolition, sections.demolition, 0, 'Démolition', 2_000_000n),
        post(posts.carrelage, sections.carrelage, 1, 'Carrelage', 3_000_000n),
        post(posts.plomberie, sections.plomberie, 2, 'Plomberie', 5_000_000n),
      ],
    });
    const task = (
      budgetLineId: string,
      position: number,
      amount: bigint,
      status: 'done' | 'todo' | 'in_progress',
      progress: string,
    ) => ({
      tenantId,
      projectId,
      budgetLineId,
      position,
      title: `Tâche ${position}`,
      amount,
      status,
      progress,
      quoteLineKey: uuidv7(),
    });
    await tx.task.createMany({
      data: [
        task(posts.demolition, 0, 2_000_000n, 'done', '1'),
        task(posts.carrelage, 1, 1_500_000n, 'done', '1'),
        task(posts.carrelage, 2, 1_500_000n, 'todo', '0'),
        task(posts.plomberie, 3, 5_000_000n, 'in_progress', '0.2'),
      ],
    });
  });
  const link = (await inject('POST', `/v1/projects/${projectId}/portal-link`, {})).json();
  portalToken = encodeURIComponent(decodeURIComponent(new URL(link.url).pathname.split('/p/')[1]!));
});

afterAll(async () => {
  await t.close();
});

describe('acompte et TVA 6 % (05 §3)', () => {
  const depositId = uuidv7();
  it('sans attestation signée, le 6 % ne s’émet pas ; avec, la facture d’acompte reçoit son numéro', async () => {
    const draft = await inject('PUT', `/v1/invoices/${depositId}`, {
      id: depositId,
      type: 'deposit',
      customerId,
      projectId,
      title: 'Acompte de 30 % sur le devis D2026-001',
      lines: [
        {
          description: 'Acompte 30 %',
          unit: 'forfait',
          quantity: '1',
          unitPrice: 3_000_000,
          vatRegime: 'reduced_6',
        },
      ],
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.json()).toMatchObject({
      status: 'draft',
      totalNet: 3_000_000,
      totalVat: 180_000,
      totalGross: 3_180_000,
    });
    expect(draft.json().issueBlockers.join(' ')).toMatch(/attestation/);
    const refused = await inject('POST', `/v1/invoices/${depositId}/issue`);
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('invoice_not_ready');

    await withSystem(t.prisma, async (tx) => {
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      await tx.vatCertificate.create({
        data: {
          tenantId,
          quoteId: p.quoteId!,
          customerId,
          projectId,
          status: 'signed',
          signedAt: new Date('2026-08-12T18:00:00Z'),
        },
      });
    });
    const issued = await issue(depositId);
    expect(issued.status).toBe('issued');
    expect(issued.number).toMatch(/^\d{4}-001$/);
    expect(isValidStructuredCommunication(issued.structuredCommunication!)).toBe(true);
    expect(issued.structuredCommunication!.startsWith('104')).toBe(true);
    expect(issued.vatMentions.join(' ')).toMatch(/6 %.*attestation du client signée le 12\/08\/2026/);
    expect(issued.seller).toMatchObject({ vatNumber: 'BE0123456749' });
    expect(issued.buyer).toMatchObject({ name: 'Jean Dupont' });
  });

  it('documents légaux rangés avec empreinte ; facture émise immuable (API et base)', async () => {
    const row = await withSystem(t.prisma, (tx) =>
      tx.invoice.findUniqueOrThrow({ where: { id: depositId } }),
    );
    expect(row.pdfKey).toMatch(/\.pdf$/);
    expect(row.ublSha256).toMatch(/^[0-9a-f]{64}$/);
    const pdf = await inject('GET', `/v1/invoices/${depositId}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(createHashOf(pdf.rawPayload)).toBe(row.pdfSha256);
    const ubl = await inject('GET', `/v1/invoices/${depositId}/ubl`);
    expect(ubl.body).toContain(
      '<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
    );

    const edit = await inject('PUT', `/v1/invoices/${depositId}`, {
      id: depositId,
      type: 'deposit',
      customerId,
      projectId,
      title: 'Autre',
      lines: [{ description: 'x', unit: 'u', quantity: '1', unitPrice: 1, vatRegime: 'reduced_6' }],
    });
    expect(edit.statusCode).toBe(409);
    expect((await inject('DELETE', `/v1/invoices/${depositId}`)).statusCode).toBe(409);
    await expect(
      withSystem(t.prisma, (tx) => tx.invoice.update({ where: { id: depositId }, data: { totalNet: 1n } })),
    ).rejects.toThrow();
  });
});

describe('état d’avancement B2C approuvé sur le portail (02 P7)', () => {
  const statementId = uuidv7();
  let invoiceId: string;

  it('pré-remplit depuis les tâches cochées', async () => {
    const pre: ProgressStatementDto = (
      await inject('GET', `/v1/projects/${projectId}/progress-statements/prefill`)
    ).json();
    expect(pre.ordinal).toBe(1);
    expect(pre.approvalRequired).toBe(true);
    const pct = Object.fromEntries(pre.lines.map((l) => [l.label, l.cumulativePercent]));
    expect(pct).toEqual({ Démolition: '100', Carrelage: '50', Plomberie: '20' });
    const carrelage = pre.lines.find((l) => l.label === 'Carrelage')!;
    expect(carrelage).toMatchObject({ unit: 'm²', totalQuantity: '40', cumulativeQuantity: '20' });
  });

  it('saisie en %, en quantité et en € ; refuse un poste au-delà du contrat', async () => {
    const over = await inject('PUT', `/v1/projects/${projectId}/progress-statements/${statementId}`, {
      id: statementId,
      periodEnd: '2026-09-30',
      lines: [{ budgetLineId: posts.carrelage, mode: 'quantity', value: '41' }],
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toMatch(/Carrelage/);
    const res = await inject('PUT', `/v1/projects/${projectId}/progress-statements/${statementId}`, {
      id: statementId,
      periodEnd: '2026-09-30',
      lines: [
        { budgetLineId: posts.demolition, mode: 'percent', value: '100' },
        { budgetLineId: posts.carrelage, mode: 'quantity', value: '16' },
        { budgetLineId: posts.plomberie, mode: 'amount', value: '1000000' },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const st: ProgressStatementDto = res.json();
    expect(st).toMatchObject({
      status: 'draft',
      cumulativeAmount: 4_200_000,
      periodAmount: 4_200_000,
      cumulativePercent: '42',
    });
  });

  it('soumis : le client le voit sur son portail, l’approuve, et la facture est générée', async () => {
    const sub = await inject('POST', `/v1/progress-statements/${statementId}/submit`);
    expect(sub.statusCode, sub.body).toBe(200);
    expect(sub.json()).toMatchObject({ status: 'submitted', invoiceId: null });
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: 'progress_statement.submitted.v1' } }),
    );
    expect(events).toHaveLength(1);

    const view = (await portal('GET', `/v1/portal/projects/${portalToken}`)).json();
    expect(view.statements[0]).toMatchObject({
      ordinal: 1,
      status: 'submitted',
      cumulativePercent: '42',
      periodAmount: 4_200_000,
    });
    const decided = await portal(
      'POST',
      `/v1/portal/projects/${portalToken}/progress-statements/${statementId}/decision`,
      {
        decision: 'approve',
        signerName: 'Jean Dupont',
      },
    );
    expect(decided.statusCode, decided.body).toBe(200);
    expect(decided.json().statements[0]).toMatchObject({ status: 'approved', approvedByName: 'Jean Dupont' });
    const twice = await portal(
      'POST',
      `/v1/portal/projects/${portalToken}/progress-statements/${statementId}/decision`,
      {
        decision: 'approve',
        signerName: 'Jean Dupont',
      },
    );
    expect(twice.statusCode).toBe(409);

    const list = (await inject('GET', `/v1/projects/${projectId}/progress-statements`)).json();
    invoiceId = list.items[0].invoice.id;
    const draft = await invoice(invoiceId);
    expect(draft).toMatchObject({ type: 'progress', status: 'draft', title: 'État d’avancement n°1 — 42 %' });
    // Acompte de 30 000 € déduit au prorata : 30 000 × 42 000 / 100 000 = 12 600 €.
    const deduction = draft.lines.find((l) => l.kind === 'deduction')!;
    expect(deduction).toMatchObject({ quantity: '-1', unitPrice: 1_260_000, netAmount: -1_260_000 });
    expect(draft.totalNet).toBe(4_200_000 - 1_260_000);
    expect(draft.totalVat).toBe(176_400);
  });

  it('émise : numéro suivant, documents, statut « facturé » de l’état ; le facturé du chantier suit', async () => {
    const issued = await issue(invoiceId);
    expect(issued.number).toMatch(/-002$/);
    expect(issued.progressStatement).toMatchObject({ ordinal: 1 });
    const st = await withSystem(t.prisma, (tx) =>
      tx.progressStatement.findUniqueOrThrow({ where: { id: statementId } }),
    );
    expect(st.status).toBe('invoiced');
    const project = (await inject('GET', `/v1/projects/${projectId}`)).json();
    // Facturé = acompte (30 000) + avancement (42 000) − déduction (12 600).
    expect(project.financials.invoiced).toBe(3_000_000 + 4_200_000 - 1_260_000);
    const issuedEvents = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: 'invoice.issued.v1' } }),
    );
    expect(issuedEvents).toHaveLength(2);
  });

  it('paiements partiels, trop-perçu refusé, annulation, puis lien de paiement en ligne', async () => {
    const before = await invoice(invoiceId);
    expect(before.balance).toBe(before.totalGross);
    const p1 = uuidv7();
    const part = await inject('POST', `/v1/invoices/${invoiceId}/payments`, {
      id: p1,
      amount: 1_000_000,
      receivedOn: '2026-10-01',
      method: 'transfer',
    });
    expect(part.statusCode, part.body).toBe(200);
    expect(part.json()).toMatchObject({
      status: 'partially_paid',
      amountPaid: 1_000_000,
      balance: before.totalGross - 1_000_000,
    });
    // Idempotent : le même paiement rejoué ne compte pas deux fois.
    await inject('POST', `/v1/invoices/${invoiceId}/payments`, {
      id: p1,
      amount: 1_000_000,
      receivedOn: '2026-10-01',
    });
    expect((await invoice(invoiceId)).amountPaid).toBe(1_000_000);
    const over = await inject('POST', `/v1/invoices/${invoiceId}/payments`, {
      id: uuidv7(),
      amount: before.totalGross,
      receivedOn: '2026-10-01',
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toMatch(/dépasse le solde/);
    const undo = await inject('DELETE', `/v1/invoices/${invoiceId}/payments/${p1}`);
    expect(undo.json()).toMatchObject({ amountPaid: 0, status: 'issued' });

    const view = (await portal('GET', `/v1/portal/projects/${portalToken}`)).json();
    const portalInvoice = view.invoices.find((i: { id: string }) => i.id === invoiceId);
    expect(portalInvoice).toMatchObject({ canPayOnline: true, balance: before.totalGross });
    const pay = await portal('POST', `/v1/portal/projects/${portalToken}/invoices/${invoiceId}/pay`);
    expect(pay.statusCode, pay.body).toBe(200);
    const externalId = pay.json().url.split('/paiement-simule/')[1];
    const checkout = (await portal('GET', `/v1/payments/checkout/${externalId}`)).json();
    expect(checkout).toMatchObject({ amount: before.totalGross, status: 'open' });
    expect((await portal('POST', `/v1/payments/checkout/${externalId}/complete`)).statusCode).toBe(200);
    // Le webhook rejoué n'enregistre pas un second paiement.
    await t.app.inject({
      method: 'POST',
      url: '/v1/webhooks/payments',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `id=${externalId}`,
    });
    const paid = await invoice(invoiceId);
    expect(paid).toMatchObject({ status: 'paid', balance: 0, amountPaid: before.totalGross });
    expect(paid.payments).toEqual([
      expect.objectContaining({ source: 'payment_link', method: 'bancontact' }),
    ]);
  });
});

describe('notes de crédit (05 §2)', () => {
  it('partielle puis totale : la facture d’origine est annulée et le facturé diminue', async () => {
    const freeId = uuidv7();
    await inject('PUT', `/v1/invoices/${freeId}`, {
      id: freeId,
      type: 'free',
      customerId,
      projectId,
      title: 'Travaux supplémentaires',
      lines: [
        {
          description: 'Pose de plinthes',
          unit: 'm',
          quantity: '10',
          unitPrice: 2_500,
          vatRegime: 'standard_21',
          budgetLineId: posts.carrelage,
        },
        {
          description: 'Évacuation',
          unit: 'forfait',
          quantity: '1',
          unitPrice: 15_000,
          vatRegime: 'standard_21',
        },
      ],
    });
    const original = await issue(freeId);
    expect(original.totalNet).toBe(40_000);
    const before = (await inject('GET', `/v1/projects/${projectId}`)).json().financials.invoiced;

    const partialId = uuidv7();
    const partial = await inject('POST', `/v1/invoices/${freeId}/credit-note`, {
      id: partialId,
      reason: 'geste commercial',
      lines: [{ index: 0, amount: 5_000 }],
    });
    expect(partial.statusCode, partial.body).toBe(200);
    const pn = await issue(partialId);
    expect(pn).toMatchObject({ type: 'credit_note', totalNet: 5_000, totalGross: 6_050 });
    expect(pn.number).toMatch(/^NC\d{4}-001$/);
    expect(pn.creditedInvoice).toMatchObject({ id: freeId });
    expect((await inject('GET', `/v1/invoices/${pn.id}/ubl`)).body).toContain(
      '<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>',
    );
    expect((await invoice(freeId)).balance).toBe(original.totalGross - 6_050);

    const tooMuch = await inject('POST', `/v1/invoices/${freeId}/credit-note`, {
      id: uuidv7(),
      reason: 'erreur',
      lines: [{ index: 1, amount: 40_000 }],
    });
    expect(tooMuch.statusCode).toBe(400);
    const restId = uuidv7();
    await inject('POST', `/v1/invoices/${freeId}/credit-note`, {
      id: restId,
      reason: 'annulation du solde',
      lines: [
        { index: 0, amount: 20_000 },
        { index: 1, amount: 15_000 },
      ],
    });
    await issue(restId);
    const cancelled = await invoice(freeId);
    expect(cancelled).toMatchObject({ status: 'cancelled', balance: 0 });
    expect(cancelled.creditNotes).toHaveLength(2);
    const after = (await inject('GET', `/v1/projects/${projectId}`)).json().financials.invoiced;
    expect(after).toBe(before - 40_000);
  });
});

describe('numérotation légale (règle n°4)', () => {
  it('émissions concurrentes : numéros continus, sans trou ni doublon', async () => {
    // 09 : 100 émissions parallèles, zéro trou ni doublon.
    const ids = Array.from({ length: 100 }, () => uuidv7());
    for (const id of ids)
      await inject('PUT', `/v1/invoices/${id}`, {
        id,
        type: 'free',
        customerId,
        title: 'Facture libre',
        lines: [
          { description: 'Dépannage', unit: 'h', quantity: '2', unitPrice: 5_500, vatRegime: 'standard_21' },
        ],
      });
    const issued = await Promise.all(ids.map((id) => inject('POST', `/v1/invoices/${id}/issue`)));
    expect(issued.filter((r) => r.statusCode !== 200).map((r) => r.body)).toEqual([]);
    const seqs = issued
      .map((r) => Number((r.json() as InvoiceDto).number!.split('-')[1]))
      .sort((a, b) => a - b);
    const first = seqs[0]!;
    expect(seqs).toEqual(Array.from({ length: 100 }, (_, i) => first + i));
    // Émettre deux fois ne consomme pas de numéro.
    const again = await inject('POST', `/v1/invoices/${ids[0]}/issue`);
    expect(again.json().number).toBe(issued[0]!.json().number);
  }, 180_000);
});

describe('B2B : facturé directement, sans approbation (paramètre par défaut)', () => {
  it('l’état passe approuvé et la facture brouillon est prête', async () => {
    const company = (
      await inject('POST', '/v1/customers', {
        kind: 'company',
        companyName: 'Immo Charleroi SA',
        vatNumber: 'BE0417497106',
        email: 'compta@immo.example',
      })
    ).json();
    const pid = uuidv7();
    const bl = uuidv7();
    await withSystem(t.prisma, async (tx) => {
      await tx.project.create({
        data: {
          id: pid,
          tenantId,
          number: 'CH2026-002',
          name: 'Bureaux',
          customerId: company.id,
          status: 'in_progress',
          contractAmount: 2_000_000n,
        },
      });
      await tx.budgetLine.create({
        data: { id: bl, tenantId, projectId: pid, position: 0, label: 'Cloisons', saleAmount: 2_000_000n },
      });
    });
    const sid = uuidv7();
    await inject('PUT', `/v1/projects/${pid}/progress-statements/${sid}`, {
      id: sid,
      periodEnd: '2026-09-30',
      lines: [{ budgetLineId: bl, mode: 'percent', value: '25' }],
    });
    const sub = await inject('POST', `/v1/progress-statements/${sid}/submit`);
    expect(sub.json()).toMatchObject({ status: 'approved', approvalRequired: false });
    const inv = await invoice(sub.json().invoiceId);
    expect(inv).toMatchObject({ type: 'progress', totalNet: 500_000, status: 'draft' });
  });
});

describe('isolation et droits', () => {
  it('un autre tenant ne voit pas les factures ; le Comptable lit sans émettre ni encaisser', async () => {
    const other = await signupCompany(t.app, 'Autre Facturation');
    const list = (await inject('GET', '/v1/invoices?view=all', undefined, other)).json();
    expect(list.items).toHaveLength(0);
    const anyId = (await inject('GET', '/v1/invoices?view=all')).json().items[0].id;
    expect((await inject('GET', `/v1/invoices/${anyId}`, undefined, other)).statusCode).toBe(404);

    const email = `compta-${Date.now()}@example.test`;
    const inv = await inject('POST', '/v1/invitations', {
      email,
      role: 'accountant',
      name: 'Isabelle Lambert',
    });
    const token = `test-token-${Math.random().toString(36).slice(2)}-abcdefghij`;
    await withSystem(t.prisma, (tx) =>
      tx.invitation.update({ where: { id: inv.json().id }, data: { tokenHash: sha256(token) } }),
    );
    const accepted = await t.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token, name: 'Isabelle Lambert', password: 'motdepasse-solide-42' },
    });
    const accountant = { cookie: sessionCookie(accepted) };
    expect(
      (await inject('GET', '/v1/invoices?view=all', undefined, accountant)).json().items.length,
    ).toBeGreaterThan(0);
    const draftId = uuidv7();
    expect(
      (
        await inject(
          'PUT',
          `/v1/invoices/${draftId}`,
          {
            id: draftId,
            type: 'free',
            customerId,
            title: 'x',
            lines: [{ description: 'x', unit: 'u', quantity: '1', unitPrice: 1, vatRegime: 'standard_21' }],
          },
          accountant,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await inject(
          'POST',
          `/v1/invoices/${anyId}/payments`,
          { id: uuidv7(), amount: 1, receivedOn: '2026-10-01' },
          accountant,
        )
      ).statusCode,
    ).toBe(403);
  });
});

function createHashOf(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
