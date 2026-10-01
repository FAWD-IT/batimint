import { describe, expect, it } from 'vitest';
import { createIntegrations, MemoryStorage, MockMailer, MockVatValidator } from './index';

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
