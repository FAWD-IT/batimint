import { describe, expect, it } from 'vitest';
import { type AccountingEntry, DEFAULT_ACCOUNTING_MAPPING, saleEntry } from '@batimint/domain';
import {
  createIntegrations,
  MemoryStorage,
  MockAccountingSync,
  MockGeocoder,
  MockMailer,
  MockVatValidator,
} from './index';

describe('intégrations mock (règle n°5 : tout tourne sans clé)', () => {
  it('sélectionne les mocks sans configuration', () => {
    const i = createIntegrations({});
    expect(i.mailer.provider).toBe('mock');
    expect(i.storage.provider).toBe('memory');
    expect(i.vat.provider).toBe('mock');
  });

  it('le mailer mock conserve les messages', async () => {
    const m = new MockMailer();
    await m.send({ to: 'marc@renov.be', subject: 'Bonjour', html: '<p>Hi</p>', text: 'Hi' });
    expect(m.lastTo('marc@renov.be')?.subject).toBe('Bonjour');
    expect(m.lastTo('autre@x.be')).toBeUndefined();
  });

  it('le stockage refuse l’écrasement d’un document légal', async () => {
    const s = new MemoryStorage();
    await s.put({ bucket: 'legal', key: 'f.pdf', body: 'a', contentType: 'application/pdf' });
    await expect(
      s.put({ bucket: 'legal', key: 'f.pdf', body: 'b', contentType: 'application/pdf' }),
    ).rejects.toThrow();
    await s.put({ bucket: 'uploads', key: 'p.jpg', body: 'a', contentType: 'image/jpeg' });
    await s.put({ bucket: 'uploads', key: 'p.jpg', body: 'b', contentType: 'image/jpeg' });
    expect(new TextDecoder().decode(await s.get('uploads', 'p.jpg'))).toBe('b');
    expect(await s.exists('uploads', 'x')).toBe(false);
  });

  it('VIES simulé : valide le numéro et pré-remplit raison sociale et adresse', async () => {
    const v = new MockVatValidator();
    const r = await v.validate('BE 0123.456.749');
    expect(r).toMatchObject({ valid: true, name: "Rénov'Habitat SRL", vatNumber: 'BE0123456749' });
    expect(r.address?.city).toBe('Charleroi');
    expect((await v.validate('BE0123456748')).valid).toBe(false);
    expect((await v.validate('BE0999999922')).name).toMatch(/SRL$/);
  });
});

describe('Peppol simulé', () => {
  it('inscrit l’entité légale puis passe active à la vérification (P1.5)', async () => {
    const { MockPeppolProvider } = await import('./index');
    const p = new MockPeppolProvider();
    const e = await p.registerLegalEntity({
      tenantId: 't1',
      name: 'Rénov',
      enterpriseNumber: '0123456749',
      vatNumber: 'BE0123456749',
      country: 'BE',
      email: null,
    });
    expect(e.status).toBe('pending');
    expect(e.participantId).toBe('0208:0123456749');
    expect((await p.getLegalEntityStatus(e.id)).status).toBe('active');
    await expect(
      p.registerLegalEntity({
        tenantId: 't',
        name: 'x',
        enterpriseNumber: '12',
        vatNumber: null,
        country: 'BE',
        email: null,
      }),
    ).rejects.toThrow();
  });

  it('annuaire : joignable sauf numéro finissant par 00 ; envoi et livraison', async () => {
    const { MockPeppolProvider } = await import('./index');
    const p = new MockPeppolProvider();
    expect((await p.lookupParticipant('0208', '0417497106')).reachable).toBe(true);
    expect((await p.lookupParticipant('0208', '0417497100')).reachable).toBe(false);
    const sent = await p.sendInvoice({ legalEntityId: 'le', ubl: '<Invoice/>', documentId: 'inv1' });
    expect(sent.status).toBe('sent');
    expect((await p.getDeliveryStatus(sent.id)).status).toBe('delivered');
    await expect(
      p.sendInvoice({ legalEntityId: 'le', ubl: 'pas du xml', documentId: 'x' }),
    ).rejects.toThrow();
    expect(p.parseWebhook('{"type":"document.received","data":{}}').type).toBe('document.received');
    expect(() => p.parseWebhook('{}')).toThrow();
  });

  it('les e-mails sont échappés et ont une version texte', async () => {
    const { buildEmail } = await import('./index');
    const m = buildEmail({
      to: 'a@b.be',
      subject: 'S',
      title: 'Bonjour <b>',
      paragraphs: ['Ligne & 1'],
      cta: { label: 'Ouvrir', href: 'https://x.be/?a=1&b=2' },
    });
    expect(m.html).toContain('Bonjour &lt;b&gt;');
    expect(m.html).toContain('Ligne &amp; 1');
    expect(m.text).toContain('Ouvrir : https://x.be/?a=1&b=2');
  });
});

describe('assistant IA simulé', () => {
  it('propose des lignes de devis depuis la bibliothèque (P2.3)', async () => {
    const { MockAiAssistant } = await import('./index');
    const ai = new MockAiAssistant();
    const lib = [
      {
        id: 'faience',
        code: 'OUV-FAI-3060',
        name: 'Faïence murale 30×60 posée, colle et joints compris',
        unit: 'm²',
      },
      { id: 'wc', code: 'OUV-SAN-WC', name: 'WC suspendu posé, raccordements compris', unit: 'u' },
    ];
    const r = await ai.draftQuoteLines('12 m² de faïence murale 30x60 pose comprise et 1 u WC suspendu', lib);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ itemId: 'faience', quantity: '12', unit: 'm²' });
    expect(r.lines[1]).toMatchObject({ itemId: 'wc', quantity: '1' });
    const unknown = await ai.draftQuoteLines('3 h de nettoyage du jardin', lib);
    expect(unknown.lines[0]).toMatchObject({ itemId: null, unit: 'h', quantity: '3' });
  });

  it('transcrit une note vocale (simulation honnête)', async () => {
    const { MockAiAssistant } = await import('./index');
    const r = await new MockAiAssistant().transcribe(new Uint8Array(48_000), 'audio/webm');
    expect(r.text).toMatch(/transcription simulée/);
    expect(r.durationSeconds).toBe(3);
  });

  it('extrait numéro de facture et bon de commande d’un texte', async () => {
    const { MockAiAssistant } = await import('./index');
    const r = await new MockAiAssistant().extractInvoice(new Uint8Array(), 'application/pdf', {
      text: 'Facture n° F2026-881 réf. BC2026-014 Total TVAC : 1.234,50',
    });
    expect(r.invoice).toMatchObject({
      invoiceNumber: 'F2026-881',
      purchaseOrderRef: 'BC2026-014',
      totalGross: 1234.5,
    });
    const s = await new MockAiAssistant().suggestAllocation(
      { supplierName: 'Brico', lines: ['Carrelage grès 60x60'], reference: 'Dupont' },
      [
        {
          id: 'p1',
          name: 'Rénovation Dupont',
          address: 'Jumet',
          budgetLines: [
            { id: 'b1', name: 'Carrelage' },
            { id: 'b2', name: 'Plomberie' },
          ],
        },
      ],
    );
    expect(s.suggestions[0]).toMatchObject({ projectId: 'p1', budgetLineId: 'b1' });
  });
});

describe('comptabilité simulée (Chift)', () => {
  const sync = new MockAccountingSync();
  const entry = (overrides: Partial<AccountingEntry> = {}): AccountingEntry => ({
    ...saleEntry(
      {
        type: 'invoice',
        number: '2026-120',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        partner: { name: 'Gilson SA', vatNumber: 'BE0456789034', enterpriseNumber: '0456789034' },
        structuredCommunication: null,
        vatBreakdown: [
          { regimes: ['standard_21'], ratePercent: '21', taxableAmount: 100_000n, taxAmount: 21_000n },
        ],
        totalNet: 100_000n,
        totalVat: 21_000n,
        totalGross: 121_000n,
      },
      DEFAULT_ACCOUNTING_MAPPING,
    ),
    ...overrides,
  });

  it('connexion, plan comptable, journaux et codes TVA ; pièce acceptée de façon idempotente', async () => {
    expect(createIntegrations({}).accounting.provider).toBe('mock');
    const c = await sync.connect({
      tenantId: '01a0f987-cc38-71ac-bb0b-129d59034cdb',
      name: 'Rénov',
      enterpriseNumber: null,
    });
    expect(c).toMatchObject({ status: 'active', software: 'WinBooks (simulation)' });
    expect((await sync.listChartOfAccounts(c.connectionId)).map((a) => a.number)).toContain('700000');
    expect((await sync.listJournals(c.connectionId)).map((j) => j.code)).toEqual([
      'VEN',
      'NCV',
      'ACH',
      'BQ1',
      'OD',
    ]);
    expect((await sync.mapVatCodes(c.connectionId)).some((v) => v.code === 'VCC')).toBe(true);
    const a = await sync.pushSale(c.connectionId, entry());
    expect(a.externalId).toBe('VEN-2026-120');
    expect(await sync.pushSale(c.connectionId, entry())).toEqual(a);
  });

  it('erreurs lisibles : compte absent, journal inconnu, TVA du partenaire invalide', async () => {
    const id = 'mock-abc';
    const bad = entry();
    bad.lines = bad.lines.map((l) => (l.account === '700000' ? { ...l, account: '709999' } : l));
    await expect(sync.pushSale(id, bad)).rejects.toThrow(/le compte 709999 n’existe pas/);
    await expect(sync.pushPurchase(id, entry())).rejects.toThrow(/journal « VEN » n’existe pas/);
    await expect(
      sync.pushSale(
        id,
        entry({ partner: { name: 'Gilson SA', vatNumber: 'BE0456789000', enterpriseNumber: null } }),
      ),
    ).rejects.toThrow(/numéro de TVA BE0456789000 de « Gilson SA » est invalide/);
  });
});

describe('géocodage simulé', () => {
  it('position stable par code postal, province correcte, hors Belgique inconnu', async () => {
    const g = new MockGeocoder();
    const jumet = await g.geocode({ street: 'Rue de la Station 42', postalCode: '6040', city: 'Jumet' });
    expect(jumet).toMatchObject({ precision: 'locality' });
    expect(Math.abs(jumet!.latitude - 50.41)).toBeLessThan(0.15);
    expect(await g.geocode({ street: 'x', postalCode: '6040', city: 'Jumet' })).toEqual(jumet);
    const liege = await g.geocode({ street: 'x', postalCode: '4000', city: 'Liège' });
    expect(liege!.longitude).toBeGreaterThan(5.3);
    expect(await g.geocode({ street: 'x', postalCode: '75001', city: 'Paris', country: 'FR' })).toBeNull();
    expect(createIntegrations({}).geocoder.provider).toBe('mock');
  });
});
