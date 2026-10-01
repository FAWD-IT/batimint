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
    await expect(s.put({ bucket: 'legal', key: 'f.pdf', body: 'b', contentType: 'application/pdf' })).rejects.toThrow();
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
