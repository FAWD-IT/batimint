import { createHmac } from 'node:crypto';
import { withSystem } from '@batimint/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;
let slug: string;

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

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov CRM');
  const me = (await inject('GET', '/v1/me')).json();
  tenantId = me.tenant.id;
  slug = me.tenant.slug;
});
afterAll(async () => {
  await t.close();
});

describe('03 §2 — clients', () => {
  it('crée un particulier et une entreprise (TVA, Peppol 0208) ; signale les doublons', async () => {
    const dupont = await inject('POST', '/v1/customers', {
      kind: 'individual',
      firstName: 'Jean',
      lastName: 'Dupont',
      email: 'Jean.Dupont@example.be',
      phone: '0471 12 34 56',
    });
    expect(dupont.statusCode).toBe(201);
    expect(dupont.json()).toMatchObject({
      displayName: 'Jean Dupont',
      email: 'jean.dupont@example.be',
      status: 'prospect',
      vatNumber: null,
    });
    const brico = await inject('POST', '/v1/customers', {
      kind: 'company',
      companyName: 'Brico Pro SA',
      enterpriseNumber: '0417.497.106',
      vatLiable: true,
    });
    expect(brico.json()).toMatchObject({
      vatNumber: 'BE0417497106',
      peppolId: '0208:0417497106',
      vatLiable: true,
    });
    const dup = await inject('POST', '/v1/customers', {
      kind: 'individual',
      lastName: 'J. Dupont',
      email: 'jean.dupont@example.be',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.details[0]).toMatchObject({ reason: 'email', displayName: 'Jean Dupont' });
    const forced = await inject('POST', '/v1/customers', {
      kind: 'individual',
      lastName: 'J. Dupont',
      email: 'jean.dupont@example.be',
      force: true,
    });
    expect(forced.statusCode).toBe(201);
    const merged = await inject('POST', `/v1/customers/${forced.json().id}/merge`, {
      intoId: dupont.json().id,
    });
    expect(merged.statusCode).toBe(200);
    const list = await inject('GET', '/v1/customers?q=dupont');
    expect(list.json().items.map((c: { id: string }) => c.id)).toEqual([dupont.json().id]);
    const bad = await inject('POST', '/v1/customers', {
      kind: 'company',
      companyName: 'X',
      enterpriseNumber: '0417.497.107',
    });
    expect(bad.json().error.code).toBe('invalid_enterprise_number');
  });

  it('vérifie la présence dans l’annuaire Peppol', async () => {
    const c = (
      await inject('POST', '/v1/customers', {
        kind: 'company',
        companyName: 'Joignable SRL',
        enterpriseNumber: '0876.543.270',
      })
    ).json();
    const r = await inject('POST', `/v1/customers/${c.id}/peppol-check`);
    expect(r.json().peppolReachable).toBe(true);
    const ind = (await inject('POST', '/v1/customers', { kind: 'individual', lastName: 'Sans TVA' })).json();
    expect((await inject('POST', `/v1/customers/${ind.id}/peppol-check`)).json().error.code).toBe(
      'no_peppol_id',
    );
  });

  it('contacts, adresses de chantier (critères du 6 %) et historique', async () => {
    const c = (
      await inject('POST', '/v1/customers', { kind: 'individual', firstName: 'Marie', lastName: 'Lambert' })
    ).json();
    const contact = await inject('POST', `/v1/customers/${c.id}/contacts`, {
      firstName: 'Paul',
      lastName: 'Lambert',
      isPrimary: true,
    });
    expect(contact.statusCode).toBe(201);
    const site = await inject('POST', `/v1/customers/${c.id}/sites`, {
      street: 'Rue de la Station 42',
      postalCode: '6040',
      city: 'Jumet',
      firstOccupancyYear: 1975,
    });
    expect(site.json()).toMatchObject({ isPrivateDwelling: true, firstOccupancyYear: 1975 });
    const detail = await inject('GET', `/v1/customers/${c.id}`);
    expect(detail.json().contacts).toHaveLength(1);
    expect(detail.json().sites).toHaveLength(1);
  });
});

describe('02 P2.1 — demandes entrantes', () => {
  it('formulaire public : demande enregistrée, événement émis ; robot piégé sans indice', async () => {
    const cfg = await t.app.inject({ url: `/v1/public/forms/${slug}` });
    expect(cfg.json()).toMatchObject({ tenantName: 'Rénov CRM' });
    const ok = await t.app.inject({
      method: 'POST',
      url: `/v1/public/forms/${slug}/leads`,
      payload: {
        name: 'Sophie Delvaux',
        email: 'sophie@example.be',
        street: 'Rue Haute 5',
        postalCode: '6000',
        city: 'Charleroi',
        message: 'Rénovation de salle de bain',
        fillMs: 25_000,
        consent: true,
      },
    });
    expect(ok.statusCode).toBe(201);
    const bot = await t.app.inject({
      method: 'POST',
      url: `/v1/public/forms/${slug}/leads`,
      payload: {
        name: 'Bot',
        email: 'bot@spam.test',
        message: 'Achetez https://spam',
        website: 'http://x',
        consent: true,
      },
    });
    expect(bot.statusCode).toBe(201);
    const leads = (await inject('GET', '/v1/leads')).json().items as { name: string; status: string }[];
    expect(leads.find((l) => l.name === 'Sophie Delvaux')?.status).toBe('new');
    expect(leads.find((l) => l.name === 'Bot')?.status).toBe('discarded');
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.count({ where: { tenantId, type: 'lead.received.v1' } }),
    );
    expect(events).toBe(1);
    const missing = await t.app.inject({
      method: 'POST',
      url: `/v1/public/forms/${slug}/leads`,
      payload: { name: 'X', email: 'x' },
    });
    expect(missing.statusCode).toBe(400);
  });

  it('e-mail entrant : signature exigée, demande créée pour le bon tenant', async () => {
    const payload = JSON.stringify({
      to: `${slug}@in.batimint.local`,
      from: { email: 'Client@Mail.be', name: 'Client Mail' },
      subject: 'Toiture qui fuit',
      text: 'Pouvez-vous passer ?',
    });
    // Le secret vient de l'environnement (absent en CI) : le test fixe le sien.
    process.env['INBOUND_EMAIL_WEBHOOK_SECRET'] = 'test-inbound-secret';
    const unsigned = await t.app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(unsigned.statusCode).toBe(401);
    const sig = createHmac('sha256', 'test-inbound-secret').update(payload).digest('hex');
    const signed = await t.app.inject({
      method: 'POST',
      url: '/v1/webhooks/inbound-email',
      headers: { 'content-type': 'application/json', 'x-batimint-signature': sig },
      payload,
    });
    expect(signed.statusCode).toBe(202);
    const leads = (await inject('GET', '/v1/leads')).json().items as {
      name: string;
      source: string;
      email: string;
    }[];
    expect(leads.find((l) => l.source === 'email')).toMatchObject({
      name: 'Client Mail',
      email: 'client@mail.be',
    });
  });
});

describe('03 §2 — pipeline et visite technique', () => {
  it('déplace une opportunité, exige un motif de perte, fait d’un prospect gagné un client', async () => {
    const c = (await inject('POST', '/v1/customers', { kind: 'individual', lastName: 'Pipeline' })).json();
    const o1 = (
      await inject('POST', '/v1/opportunities', {
        customerId: c.id,
        title: 'Salle de bain',
        estimatedAmount: 1_250_000,
      })
    ).json();
    const o2 = (await inject('POST', '/v1/opportunities', { customerId: c.id, title: 'Cuisine' })).json();
    expect(o1).toMatchObject({ stage: 'new', estimatedAmount: 1_250_000 });
    const moved = await inject('POST', `/v1/opportunities/${o1.id}/move`, { stage: 'quoting', position: 0 });
    expect(moved.json().stage).toBe('quoting');
    const lost = await inject('POST', `/v1/opportunities/${o2.id}/move`, { stage: 'lost', position: 0 });
    expect(lost.json().error.code).toBe('lost_reason_required');
    await inject('POST', `/v1/opportunities/${o2.id}/move`, {
      stage: 'lost',
      position: 0,
      lostReason: 'Prix',
    });
    await inject('POST', `/v1/opportunities/${o1.id}/move`, { stage: 'won', position: 0 });
    expect((await inject('GET', `/v1/customers/${c.id}`)).json().customer.status).toBe('customer');
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.count({ where: { tenantId, type: 'opportunity.stage_changed.v1', aggregateId: o1.id } }),
    );
    expect(events).toBe(2);
  });

  it('visite : mesures, checklist, photo et note vocale', async () => {
    const c = (await inject('POST', '/v1/customers', { kind: 'individual', lastName: 'Visite' })).json();
    const o = (await inject('POST', '/v1/opportunities', { customerId: c.id, title: 'Rénovation' })).json();
    const v = await inject('POST', `/v1/opportunities/${o.id}/visits`, {
      scheduledAt: '2026-10-05T08:00:00Z',
    });
    expect(v.statusCode).toBe(201);
    expect((await inject('GET', `/v1/opportunities/${o.id}`)).json().opportunity.stage).toBe('visit_planned');
    const done = await inject('PUT', `/v1/visits/${v.json().id}`, {
      visitedAt: '2026-10-05T08:30:00Z',
      measurements: [{ label: 'Murs salle de bain', value: '12', unit: 'm²' }],
      checklist: [{ label: 'Arrivée d’eau', done: true }],
      notes: 'Canalisation en plomb derrière la faïence',
    });
    expect(done.json().measurements[0]).toMatchObject({ value: '12', unit: 'm²' });
    const photo = await t.app.inject({
      method: 'POST',
      url: `/v1/attachments?ownerType=opportunity&ownerId=${o.id}&kind=photo&lat=50.44&lng=4.43`,
      headers: {
        cookie: owner.cookie,
        'content-type': 'image/jpeg',
        'x-file-name': encodeURIComponent('cuisine 1.jpg'),
      },
      payload: Buffer.from('fakejpeg'),
    });
    expect(photo.statusCode).toBe(201);
    const voice = await t.app.inject({
      method: 'POST',
      url: `/v1/attachments?ownerType=opportunity&ownerId=${o.id}&kind=voice_note`,
      headers: { cookie: owner.cookie, 'content-type': 'audio/webm' },
      payload: Buffer.alloc(32_000),
    });
    expect(voice.json()).toMatchObject({ kind: 'voice_note', transcriptStatus: 'pending' });
    const file = await t.app.inject({
      url: `/v1/attachments/${photo.json().id}/file`,
      headers: { cookie: owner.cookie },
    });
    expect(file.body).toBe('fakejpeg');
    const list = await inject('GET', `/v1/attachments?ownerType=opportunity&ownerId=${o.id}`);
    expect(list.json().items).toHaveLength(2);
    const exe = await t.app.inject({
      method: 'POST',
      url: `/v1/attachments?ownerType=opportunity&ownerId=${o.id}&kind=document`,
      headers: { cookie: owner.cookie, 'content-type': 'application/octet-stream' },
      payload: Buffer.from('MZ'),
    });
    expect(exe.statusCode).toBe(400);
  });
});

describe('03 §3 — bibliothèque', () => {
  it('ouvrage : prix de revient calculé, recalculé quand un composant change ; historique', async () => {
    const carreau = (
      await inject('POST', '/v1/items', {
        code: 'T-CARR',
        kind: 'material',
        name: 'Carrelage 60×60',
        unit: 'm²',
        purchasePrice: 3450,
      })
    ).json();
    const mo = (
      await inject('POST', '/v1/items', {
        code: 'T-MO',
        kind: 'labour',
        name: 'Ouvrier',
        unit: 'h',
        purchasePrice: 3600,
        laborHours: '1',
      })
    ).json();
    const ouv = await inject('POST', '/v1/items', {
      code: 'T-OUV',
      kind: 'assembly',
      name: 'Carrelage posé',
      unit: 'm²',
      components: [
        { itemId: carreau.id, quantity: '1.08' },
        { itemId: mo.id, quantity: '0.75' },
      ],
    });
    // 1,08 × 34,50 + 0,75 × 36 = 37,26 + 27 = 64,26
    expect(ouv.json()).toMatchObject({ purchasePrice: 6426, laborHours: '0.75' });
    expect(ouv.json().effectiveSalePrice).toBe(Math.round(6426 * 1.1 * 1.25));
    await inject('PUT', `/v1/items/${carreau.id}`, {
      code: 'T-CARR',
      kind: 'material',
      name: 'Carrelage 60×60',
      unit: 'm²',
      purchasePrice: 3700,
    });
    const after = (await inject('GET', `/v1/items/${ouv.json().id}`)).json();
    expect(after.item.purchasePrice).toBe(6696);
    const hist = (await inject('GET', `/v1/items/${carreau.id}`)).json().history;
    expect(hist.map((h: { purchasePrice: number }) => h.purchasePrice)).toEqual([3700, 3450]);
    const cyc = await inject('PUT', `/v1/items/${ouv.json().id}`, {
      code: 'T-OUV',
      kind: 'assembly',
      name: 'x',
      unit: 'm²',
      components: [{ itemId: ouv.json().id, quantity: '1' }],
    });
    expect(cyc.statusCode).toBe(400);
    const dupCode = await inject('POST', '/v1/items', {
      code: 'T-CARR',
      kind: 'material',
      name: 'Doublon',
      unit: 'u',
    });
    expect(dupCode.json().error.code).toBe('code_taken');
  });

  it('bibliothèques types et recherche instantanée tolérante aux fautes', async () => {
    const r = await inject('POST', '/v1/library/starters', { trades: ['plumbing'] });
    expect(r.json().created).toBeGreaterThan(30);
    const again = await inject('POST', '/v1/library/starters', { trades: ['plumbing'] });
    expect(again.json().created).toBe(0);
    const started = Date.now();
    const s = await inject('GET', '/v1/items?q=faience');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(s.json().items[0].name).toMatch(/faïence/i);
    const typo = await inject('GET', '/v1/items?q=douche italienne');
    expect(typo.json().items.map((i: { code: string }) => i.code)).toContain('OUV-SAN-ITAL');
    const ital = typo.json().items.find((i: { code: string }) => i.code === 'OUV-SAN-ITAL');
    expect(ital.purchasePrice).toBeGreaterThan(100_000);
  });

  it('import CSV de 2 000 articles en moins de 30 s, avec rapport d’erreurs et mise à jour par code', async () => {
    const lines = ['Référence;Désignation;Unité;Prix d’achat;Famille'];
    for (let i = 1; i <= 2000; i++)
      lines.push(
        `IMP-${i};Article importé ${i};${i % 3 === 0 ? 'm²' : 'pce'};${(i % 97) + 1},${String(i % 100).padStart(2, '0')};Famille ${i % 7}`,
      );
    lines.push('IMP-ERR;;zorglub;douze;X');
    const csv = Buffer.from(lines.join('\n'), 'utf8');
    const started = Date.now();
    const preview = await t.app.inject({
      method: 'POST',
      url: '/v1/library/import/preview',
      headers: { cookie: owner.cookie, 'content-type': 'text/csv', 'x-file-name': 'tarifs.csv' },
      payload: csv,
    });
    expect(preview.statusCode).toBe(200);
    const p = preview.json();
    expect(p.totalRows).toBe(2001);
    expect(p.suggestedMapping).toMatchObject({ code: 0, name: 1, unit: 2, purchasePrice: 3, category: 4 });
    const dry = await inject('POST', '/v1/library/import', {
      fileId: p.fileId,
      mapping: p.suggestedMapping,
      dryRun: true,
    });
    expect(dry.json()).toMatchObject({ dryRun: true, created: 2000 });
    const real = await inject('POST', '/v1/library/import', {
      fileId: p.fileId,
      mapping: p.suggestedMapping,
    });
    const report = real.json();
    expect(report).toMatchObject({ created: 2000, updated: 0 });
    expect(report.errors.map((e: { row: number }) => e.row)).toEqual([2002, 2002, 2002]);
    expect(Date.now() - started).toBeLessThan(30_000);
    // Réimport avec un prix modifié : une mise à jour, le reste inchangé.
    lines[1] = 'IMP-1;Article importé 1;pce;99,99;Famille 1';
    const p2 = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/library/import/preview',
        headers: { cookie: owner.cookie, 'content-type': 'text/csv' },
        payload: Buffer.from(lines.join('\n')),
      })
    ).json();
    const second = (
      await inject('POST', '/v1/library/import', { fileId: p2.fileId, mapping: p2.suggestedMapping })
    ).json();
    expect(second).toMatchObject({ created: 0, updated: 1, unchanged: 1999 });
  }, 60_000);

  it('l’Ouvrier ne voit aucun prix', async () => {
    const { sha256 } = await import('../src/lib/crypto');
    const inv = await inject('POST', '/v1/invitations', { email: 'luca-lib@example.test', role: 'worker' });
    const token = 'lib-token-abcdefghijklmnopqrstu';
    await withSystem(t.prisma, (tx) =>
      tx.invitation.update({ where: { id: inv.json().id }, data: { tokenHash: sha256(token) } }),
    );
    const acc = await t.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token, name: 'Luca', password: 'motdepasse-solide-42' },
    });
    const cookie = acc.cookies.find((c) => c.name === 'bm_session')!;
    const res = await t.app.inject({
      url: '/v1/items?q=carrelage',
      headers: { cookie: `bm_session=${cookie.value}` },
    });
    // Les ouvriers n'ont pas accès à la bibliothèque.
    expect(res.statusCode).toBe(403);
  });
});
