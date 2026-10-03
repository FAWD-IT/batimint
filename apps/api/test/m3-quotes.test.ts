/**
 * M3 — Devis et signature (02 P2.3–P2.9, 03 §4, 05 §3 et §10) contre un vrai Postgres.
 */
import { createHash } from 'node:crypto';
import { withSystem } from '@batimint/db';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QuoteDto } from '@batimint/contracts';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

type Section = QuoteDto['currentVersion']['sections'][number];
type Line = Section['lines'][number];

let t: TestApp;
let owner: SignedUp;
let tenantId: string;

const inject = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
  s: SignedUp = owner,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

const portal = (method: 'GET' | 'POST', url: string, payload?: unknown) =>
  t.app.inject({
    method,
    url,
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Test', 'x-forwarded-for': '203.0.113.7' },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

let opportunityId: string;
let itemIds: { faience: string; pose: string; douche: string };

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Devis');
  tenantId = (await inject('GET', '/v1/me')).json().tenant.id;
  const dupont = (
    await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'jean.dupont@example.be',
    })
  ).json();
  const site = (
    await inject('POST', `/v1/customers/${dupont.id}/sites`, {
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      isPrivateDwelling: true,
      firstOccupancyYear: 1975,
    })
  ).json();
  opportunityId = (
    await inject('POST', '/v1/opportunities', {
      customerId: dupont.id,
      siteId: site.id,
      title: 'Rénovation salle de bain',
    })
  ).json().id;
  const item = async (
    code: string,
    name: string,
    unit: string,
    purchasePrice: number,
    kind = 'material',
    vatRate?: string,
  ) =>
    (
      await inject('POST', '/v1/items', {
        code,
        name,
        unit,
        kind,
        purchasePrice,
        laborHours: kind === 'labour' ? '1' : '0',
        ...(vatRate ? { vatRate } : {}),
      })
    ).json().id as string;
  itemIds = {
    faience: await item('FAI-3060', 'Faïence murale 30x60', 'm²', 2899),
    pose: await item('MO-POSE', 'Pose de faïence', 'm²', 3200, 'labour'),
    douche: await item('DOU-IT', 'Douche à l’italienne', 'forfait', 100_000, 'material', 'standard_21'),
  };
});
afterAll(async () => {
  await t.close();
});

let quoteId: string;
let quote: QuoteDto;

const line = (itemId: string | null, over: Record<string, unknown> = {}) => ({
  key: uuidv7(),
  kind: 'item',
  itemId,
  description: 'Ligne',
  unit: 'm²',
  quantity: '1',
  unitPrice: 10_000,
  unitCost: 7_000,
  laborHours: '0',
  vatRegime: 'reduced_6',
  discountPercent: '0',
  ...over,
});

describe('P2.3 — créer et composer le devis depuis l’affaire', () => {
  it('crée le devis numéroté, propose la TVA 6 % (logement de 1975, particulier) et passe l’affaire en « devis en cours »', async () => {
    const res = await inject('POST', '/v1/quotes', { opportunityId, title: 'Rénovation salle de bain' });
    expect(res.statusCode).toBe(201);
    quote = res.json();
    quoteId = quote.id;
    expect(quote).toMatchObject({
      number: `D${new Date().getFullYear()}-001`,
      status: 'draft',
      vatSuggestion: {
        regime: 'reduced_6',
        reason: 'renovation_dwelling_over_10_years',
        requiresCertificate: true,
      },
      currentVersion: { version: 1, deposit: { kind: 'percent', value: '30' } },
    });
    expect(quote.currentVersion.sections).toHaveLength(1);
    const opp = (await inject('GET', `/v1/opportunities/${opportunityId}`)).json();
    expect(opp.opportunity.stage).toBe('quoting');
  });

  it('bibliothèque → ligne : prix de vente calculé ; ouvrage éclatable', async () => {
    const res = await inject('GET', `/v1/quotes/library-lines/${itemIds.faience}?quantity=18.5`);
    expect(res.json().lines[0]).toMatchObject({ code: 'FAI-3060', quantity: '18.5', unitCost: 2899 });
    // revient × 1,10 × 1,25 = 39,86 €
    expect(res.json().lines[0].unitPrice).toBe(3986);
  });

  it('dictée : texte → lignes proposées depuis la bibliothèque', async () => {
    const res = await inject('POST', `/v1/quotes/${quoteId}/draft-lines`, {
      text: '18,5 m² de faïence murale 30x60\n12 m² pose de faïence',
    });
    expect(res.statusCode).toBe(200);
    const lines = res.json().lines;
    expect(lines[0]).toMatchObject({ quantity: '18.5', item: { code: 'FAI-3060' } });
    expect(lines[1]).toMatchObject({ quantity: '12', item: { code: 'MO-POSE' } });
  });

  it('enregistre postes, option et acompte ; refuse un changement de TVA non justifié', async () => {
    const sectionKey = quote.currentVersion.sections[0]!.key;
    const optionKey = uuidv7();
    const initialRevision = quote.currentVersion.revision as number;
    const content = (doucheRegime: string, justification?: string) => ({
      revision: initialRevision,
      intro: 'Suite à notre visite du 27 septembre.',
      deposit: { kind: 'percent', value: '30' },
      sections: [
        {
          key: sectionKey,
          title: 'Carrelage',
          lines: [
            line(itemIds.faience, {
              description: 'Faïence murale 30x60',
              quantity: '18.5',
              unitPrice: 3986,
              unitCost: 2899,
            }),
            line(itemIds.pose, {
              description: 'Pose',
              quantity: '18.5',
              unitPrice: 4400,
              unitCost: 3200,
              laborHours: '1',
            }),
            {
              ...line(null),
              kind: 'text',
              description: 'Teinte au choix du client',
              unitPrice: 0,
              unitCost: 0,
            },
          ],
        },
        {
          key: optionKey,
          title: "Douche à l'italienne",
          optional: true,
          lines: [
            line(itemIds.douche, {
              description: 'Douche à l’italienne',
              unit: 'forfait',
              unitPrice: 140_000,
              unitCost: 100_000,
              vatRegime: doucheRegime,
              ...(justification ? { vatJustification: justification } : {}),
            }),
          ],
        },
      ],
    });
    // L'article douche impose 21 % : le forcer à 6 % sans justification est refusé.
    const refused = await inject('PUT', `/v1/quotes/${quoteId}/content`, content('reduced_6'));
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('vat_justification_required');
    const ok = await inject('PUT', `/v1/quotes/${quoteId}/content`, content('standard_21'));
    expect(ok.statusCode).toBe(200);
    quote = ok.json();
    const totals = quote.currentVersion.totals;
    // 18,5 × 39,86 = 737,41 ; 18,5 × 44,00 = 814,00 → 1 551,41 HTVA ; TVA 6 % = 93,08
    expect(totals).toMatchObject({
      totalNet: 155_141,
      totalVat: 9_308,
      totalGross: 164_449,
      optionsAvailable: 140_000,
      depositAmount: 49_335,
      laborHours: '18.5',
      totalCost: 112_832,
    });
    expect(quote.currentVersion.sections[1]!.lines[0]).toMatchObject({ vatSuggested: 'standard_21' });
    // Concurrence optimiste : une révision périmée est refusée.
    const stale = await inject('PUT', `/v1/quotes/${quoteId}/content`, content('standard_21'));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('stale_revision');
  });

  it('PDF du devis', async () => {
    const res = await inject('GET', `/v1/quotes/${quoteId}/pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('P2.7 — envoi, nouvelle version, comparatif', () => {
  it('envoie : version figée (PDF + empreinte), événement, affaire « devis envoyé »', async () => {
    const res = await inject('POST', `/v1/quotes/${quoteId}/send`, { email: 'jean.dupont@example.be' });
    expect(res.statusCode).toBe(200);
    quote = res.json();
    expect(quote).toMatchObject({ status: 'sent', currentVersion: { status: 'sent', version: 1 } });
    expect(quote.validUntil).not.toBeNull();
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, aggregateId: quoteId }, orderBy: { occurredAt: 'asc' } }),
    );
    expect(events.map((e) => e.type)).toContain('quote.sent.v1');
    const v = await withSystem(t.prisma, (tx) =>
      tx.quoteVersion.findFirstOrThrow({ where: { quoteId, version: 1 } }),
    );
    expect(v.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    const opp = (await inject('GET', `/v1/opportunities/${opportunityId}`)).json();
    expect(opp.opportunity.stage).toBe('sent');
  });

  it('modifier après envoi crée la version 2 ; la 1 est « remplacée » ; comparatif', async () => {
    const v1 = quote.currentVersion;
    // La pose passe de 18,5 à 20 m².
    const sections = v1.sections.map((s: Section) => ({
      ...s,
      lines: s.lines.map((l: Line) => (l.description === 'Pose' ? { ...l, quantity: '20' } : l)),
    }));
    const res = await inject('PUT', `/v1/quotes/${quoteId}/content`, {
      revision: v1.revision,
      deposit: v1.deposit,
      sections: sections.map((s: Section) => ({
        key: s.key,
        title: s.title,
        optional: s.optional,
        selected: s.selected,
        lines: s.lines.map(({ id: _id, vatSuggested: _s, ...l }: Line) => l),
      })),
    });
    expect(res.statusCode).toBe(200);
    quote = res.json();
    expect(quote).toMatchObject({ status: 'draft', currentVersion: { version: 2, status: 'draft' } });
    expect(quote.versions.map((v: QuoteDto['versions'][number]) => [v.version, v.status])).toEqual([
      [1, 'superseded'],
      [2, 'draft'],
    ]);
    const cmp = await inject(
      'GET',
      `/v1/quotes/${quoteId}/compare?from=${quote.versions[0]!.id}&to=${quote.versions[1]!.id}`,
    );
    expect(cmp.json().changes).toEqual([
      expect.objectContaining({
        kind: 'changed',
        fields: ['quantity'],
        after: { quantity: '20', unitPrice: 4400 },
      }),
    ]);
    const sent = await inject('POST', `/v1/quotes/${quoteId}/send`, { email: 'jean.dupont@example.be' });
    expect(sent.json()).toMatchObject({ status: 'sent', currentVersion: { version: 2, status: 'sent' } });
  });
});

describe('P2.8 — portail client et signature', () => {
  const token = `portal-test-${'x'.repeat(30)}`;
  beforeAll(async () => {
    await withSystem(t.prisma, (tx) =>
      tx.portalToken.create({
        data: {
          tenantId,
          kind: 'quote',
          quoteId,
          email: 'jean.dupont@example.be',
          tokenHash: createHash('sha256').update(token).digest('hex'),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    );
  });

  it('lien invalide → message clair', async () => {
    const res = await portal('GET', '/v1/portal/quotes/inconnu-abcdefghijklmnopqrstuvwxyz');
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('portal_link_invalid');
  });

  it('le client voit la version envoyée, sans prix de revient ; l’ouverture est tracée une fois', async () => {
    const res = await portal('GET', `/v1/portal/quotes/${token}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.quote).toMatchObject({ version: 2, status: 'sent' });
    expect(body.certificateRequired).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/unitCost|totalCost|margin/);
    await portal('POST', `/v1/portal/quotes/${token}/view`);
    await portal('POST', `/v1/portal/quotes/${token}/view`);
    const viewed = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.count({ where: { tenantId, aggregateId: quoteId, type: 'quote.viewed.v1' } }),
    );
    expect(viewed).toBe(1);
    expect((await inject('GET', `/v1/quotes/${quoteId}`)).json().status).toBe('viewed');
  });

  it('signer exige l’attestation 6 % ; logement trop récent refusé', async () => {
    const base = { signerName: 'Jean Dupont', acceptTerms: true, signaturePath: 'M10 10 L 40 40' };
    const noCert = await portal('POST', `/v1/portal/quotes/${token}/sign`, base);
    expect(noCert.statusCode).toBe(400);
    expect(noCert.json().error.code).toBe('certificate_required');
    const recent = await portal('POST', `/v1/portal/quotes/${token}/sign`, {
      ...base,
      certificate: {
        firstOccupancyYear: new Date().getFullYear() - 3,
        privateDwelling: true,
        overTenYears: true,
        finalConsumer: true,
      },
    });
    expect(recent.json().error.code).toBe('dwelling_too_recent');
  });

  it('signe avec l’option : preuve (horodatage, IP, empreinte du PDF signé), attestation, événement', async () => {
    const optionKey = quote.currentVersion.sections[1]!.key;
    const res = await portal('POST', `/v1/portal/quotes/${token}/sign`, {
      signerName: 'Jean Dupont',
      acceptTerms: true,
      signaturePath: 'M10 10 L 40 40',
      options: { [optionKey]: true },
      certificate: {
        firstOccupancyYear: 1975,
        privateDwelling: true,
        overTenYears: true,
        finalConsumer: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.quote.status).toBe('signed');
    expect(body.certificateSigned).toBe(true);
    // Option retenue : 737,41 + 880,00 (6 %) + 1 400,00 (21 %)
    expect(body.totals.totalNet).toBe(161_741 + 140_000);
    expect(
      body.totals.vatBreakdown.map((v: { ratePercent: string; taxAmount: number }) => [
        v.ratePercent,
        v.taxAmount,
      ]),
    ).toEqual([
      ['21', 29_400],
      ['6', 9_704],
    ]);
    const sig = await withSystem(t.prisma, (tx) =>
      tx.signature.findFirstOrThrow({ where: { tenantId, subjectType: 'quote_version' } }),
    );
    expect(sig).toMatchObject({
      signerName: 'Jean Dupont',
      acceptedTerms: true,
      userAgent: 'Mozilla/5.0 (iPhone) Test',
    });
    expect(sig.ip).toBeTruthy();
    expect(sig.documentSha256).toMatch(/^[0-9a-f]{64}$/);
    const stored = await t.deps.integrations.storage.get('legal', sig.documentKey!);
    expect(createHash('sha256').update(stored).digest('hex')).toBe(sig.documentSha256);
    // Preuve en ajout seul.
    await expect(
      withSystem(t.prisma, (tx) => tx.signature.update({ where: { id: sig.id }, data: { signerName: 'X' } })),
    ).rejects.toThrow();
    const q = (await inject('GET', `/v1/quotes/${quoteId}`)).json();
    expect(q).toMatchObject({
      status: 'signed',
      certificate: { status: 'signed' },
      signature: { signerName: 'Jean Dupont' },
    });
    const signedEvents = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.count({ where: { tenantId, aggregateId: quoteId, type: 'quote.signed.v1' } }),
    );
    expect(signedEvents).toBe(1);
    // Le PDF servi est exactement le document signé.
    const pdf = await portal('GET', `/v1/portal/quotes/${token}/pdf`);
    expect(createHash('sha256').update(pdf.rawPayload).digest('hex')).toBe(sig.documentSha256);
  });

  it('un devis signé ne se re-signe pas et ne se modifie plus', async () => {
    const again = await portal('POST', `/v1/portal/quotes/${token}/sign`, {
      signerName: 'Jean Dupont',
      acceptTerms: true,
    });
    expect(again.statusCode).toBe(409);
    const edit = await inject('PUT', `/v1/quotes/${quoteId}/content`, { revision: 99, sections: [] });
    expect(edit.json().error.code).toBe('quote_signed');
  });
});

describe('modèles, duplication, droits', () => {
  it('enregistre un modèle puis crée un devis à partir de lui (TVA réalignée sur le nouveau client)', async () => {
    const tpl = await inject('POST', '/v1/quotes', {
      title: 'Salle de bain type',
      fromQuoteId: quoteId,
      isTemplate: true,
    });
    expect(tpl.json()).toMatchObject({ isTemplate: true, number: null, customer: null });
    const list = await inject('GET', '/v1/quotes?templates=true');
    expect(list.json().items.map((q: { title: string }) => q.title)).toContain('Salle de bain type');
    const company = (
      await inject('POST', '/v1/customers', {
        kind: 'company',
        companyName: 'Brico Pro SA',
        enterpriseNumber: '0417.497.106',
        vatLiable: true,
      })
    ).json();
    const fromTpl = await inject('POST', '/v1/quotes', {
      title: 'Sanitaires Brico',
      customerId: company.id,
      fromQuoteId: tpl.json().id,
    });
    expect(fromTpl.statusCode).toBe(201);
    const v = fromTpl.json().currentVersion;
    expect(fromTpl.json().vatSuggestion.regime).toBe('reverse_charge');
    // Lignes « auto » → autoliquidation ; la douche garde son taux imposé par l'article.
    expect(v.sections[0].lines[0].vatRegime).toBe('reverse_charge');
    expect(v.sections[1].lines[0].vatRegime).toBe('standard_21');
  });

  it('un modèle ne s’envoie pas ; un devis vide non plus', async () => {
    const empty = (await inject('POST', '/v1/quotes', { opportunityId, title: 'Vide' })).json();
    const res = await inject('POST', `/v1/quotes/${empty.id}/send`, { email: 'x@example.be' });
    expect(res.json().error.code).toBe('quote_empty');
  });
});
