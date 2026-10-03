import { withSystem } from '@batimint/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../src/lib/crypto';
import { createTestApp, sessionCookie, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let owner: SignedUp;
let tenantId: string;

const inject = (
  s: SignedUp,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  payload?: unknown,
) =>
  t.app.inject({
    method,
    url,
    headers: { cookie: s.cookie },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });

beforeAll(async () => {
  t = await createTestApp();
  owner = await signupCompany(t.app, 'Rénov Onboarding');
  tenantId = (await inject(owner, 'GET', '/v1/me')).json().tenant.id;
});
afterAll(async () => {
  await t.close();
});

async function inviteAndAccept(role: string, name: string): Promise<SignedUp & { userId: string }> {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const inv = await inject(owner, 'POST', '/v1/invitations', { email, role, name });
  expect(inv.statusCode).toBe(201);
  // Le jeton est normalement généré par le consommateur ; on en fixe un pour le test.
  const token = `test-token-${Math.random().toString(36).slice(2)}-abcdefghij`;
  await withSystem(t.prisma, (tx) =>
    tx.invitation.update({ where: { id: inv.json().id }, data: { tokenHash: sha256(token) } }),
  );
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/invitations/accept',
    payload: { token, name, password: 'motdepasse-solide-42' },
  });
  expect(res.statusCode).toBe(200);
  const cookie = sessionCookie(res);
  const me = await t.app.inject({ url: '/v1/me', headers: { cookie } });
  return {
    cookie,
    token: res.json().sessionToken,
    email,
    password: 'motdepasse-solide-42',
    userId: me.json().user.id,
  };
}

describe('P1.1-2 — numéro d’entreprise et VIES', () => {
  it('pré-remplit raison sociale et adresse', async () => {
    const res = await inject(owner, 'POST', '/v1/company/vat-lookup', { number: 'BE 0123.456.749' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: true,
      name: "Rénov'Habitat SRL",
      legalForm: 'SRL',
      city: 'Charleroi',
      postalCode: '6000',
    });
  });

  it('refuse un numéro invalide avec un message clair', async () => {
    const res = await inject(owner, 'POST', '/v1/company/vat-lookup', { number: '0123456748' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/10 chiffres/);
  });

  it('enregistre la fiche : TVA validée, IBAN normalisé, couleur vérifiée, audit', async () => {
    const res = await inject(owner, 'PATCH', '/v1/company', {
      enterpriseNumber: '0123.456.749',
      legalName: "Rénov'Habitat SRL",
      street: 'Rue de Montigny 112',
      postalCode: '6000',
      city: 'Charleroi',
      iban: 'be68 5390 0754 7034',
      bic: 'gkccbebb',
      brandColor: 'ffd400',
    });
    expect(res.statusCode).toBe(200);
    const c = res.json();
    expect(c.vatNumber).toBe('BE0123456749');
    expect(c.vatValidatedAt).not.toBeNull();
    expect(c.iban).toBe('BE68539007547034');
    expect(c.bic).toBe('GKCCBEBB');
    expect(c.brandColor).toBe('#FFD400');
    expect(c.brandColorAccessible).toBe(false);
    const audit = await inject(owner, 'GET', '/v1/audit?entityType=tenant');
    expect(audit.json().items.map((a: { action: string }) => a.action)).toContain('company.updated');
  });

  it('refuse un IBAN invalide', async () => {
    const res = await inject(owner, 'PATCH', '/v1/company', { iban: 'BE68 5390 0754 7035' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_iban');
  });

  it('logo : envoi, lecture, format refusé', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const up = await t.app.inject({
      method: 'PUT',
      url: '/v1/company/logo',
      headers: { cookie: owner.cookie, 'content-type': 'image/png' },
      payload: png,
    });
    expect(up.statusCode).toBe(200);
    expect(up.json().logoUrl).toMatch(/^\/api\/v1\/company\/logo/);
    const get = await t.app.inject({ url: '/v1/company/logo', headers: { cookie: owner.cookie } });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    const bad = await t.app.inject({
      method: 'PUT',
      url: '/v1/company/logo',
      headers: { cookie: owner.cookie, 'content-type': 'application/pdf' },
      payload: 'x',
    });
    expect(bad.statusCode).toBe(415);
  });
});

describe('P1.3 — paramètres métier', () => {
  it('valeurs par défaut sensées puis enregistrement audité', async () => {
    const def = await inject(owner, 'GET', '/v1/company/settings');
    expect(def.json()).toMatchObject({
      paymentTermsDays: 30,
      dunningDays: [3, 15, 30],
      depositPercent: '30',
      rateProfiles: [],
    });
    expect(def.json().numbering.invoice).toBe('{YYYY}-{SEQ:3}');
    const body = {
      ...def.json(),
      rateProfiles: [
        { key: 'ouvrier', label: 'Ouvrier qualifié', costPerHour: 3600, salePerHour: 5200 },
        { key: 'chef', label: 'Chef de chantier', costPerHour: 4400, salePerHour: 6000 },
      ],
      marginCoefficient: '1.30',
    };
    const put = await inject(owner, 'PUT', '/v1/company/settings', body);
    expect(put.statusCode).toBe(200);
    expect((await inject(owner, 'GET', '/v1/company/settings')).json().rateProfiles).toHaveLength(2);
    const bad = await inject(owner, 'PUT', '/v1/company/settings', {
      ...body,
      numbering: { ...body.numbering, invoice: 'FACT' },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('P1.5 — Peppol (mock)', () => {
  it('inscrit l’entité légale puis la vérification la passe à « actif »', async () => {
    const act = await inject(owner, 'POST', '/v1/integrations/peppol/activate');
    expect(act.statusCode).toBe(200);
    expect(act.json()).toMatchObject({ kind: 'peppol', status: 'pending', provider: 'mock' });
    expect(act.json().details.participantId).toBe('0208:0123456749');
    const test = await inject(owner, 'POST', '/v1/integrations/peppol/test');
    expect(test.json().status).toBe('active');
    const list = await inject(owner, 'GET', '/v1/integrations');
    expect(list.json().items).toHaveLength(6);
  });
});

describe('P1.6 — invitations et rôles', () => {
  it('l’invitation émet un événement, l’acceptation crée le membre avec le bon rôle', async () => {
    const sophie = await inviteAndAccept('office', 'Sophie Martin');
    const me = await t.app.inject({ url: '/v1/me', headers: { cookie: sophie.cookie } });
    expect(me.json()).toMatchObject({ role: 'office', tenant: { id: tenantId } });
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId, type: { in: ['user.invited.v1', 'member.joined.v1'] } } }),
    );
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['user.invited.v1', 'member.joined.v1']),
    );
    const members = await inject(owner, 'GET', '/v1/members');
    expect(members.json().members.map((m: { name: string }) => m.name)).toContain('Sophie Martin');
  });

  it('un lien d’invitation ne sert qu’une fois', async () => {
    const inv = await inject(owner, 'POST', '/v1/invitations', {
      email: 'once@example.test',
      role: 'worker',
    });
    const token = 'one-shot-token-abcdefghijklmnop';
    await withSystem(t.prisma, (tx) =>
      tx.invitation.update({ where: { id: inv.json().id }, data: { tokenHash: sha256(token) } }),
    );
    const lookup = await t.app.inject({ url: `/v1/invitations/lookup?token=${token}` });
    expect(lookup.json()).toMatchObject({
      tenantName: 'Rénov Onboarding',
      role: 'worker',
      accountExists: false,
    });
    const ok = await t.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token, name: 'Luca', password: 'motdepasse-solide-42' },
    });
    expect(ok.statusCode).toBe(200);
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token, name: 'Luca', password: 'motdepasse-solide-42' },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('invalid_invitation');
  });

  it('le Bureau ne peut pas inviter ; on ne peut pas retirer le dernier patron', async () => {
    const office = await inviteAndAccept('office', 'Bureau Deux');
    const res = await inject(office, 'POST', '/v1/invitations', { email: 'x@example.test', role: 'worker' });
    expect(res.statusCode).toBe(403);
    const admin = await inviteAndAccept('admin', 'Admin Un');
    const members = (await inject(owner, 'GET', '/v1/members')).json().members as {
      id: string;
      role: string;
      isCurrentUser: boolean;
    }[];
    const ownerMembership = members.find((m) => m.isCurrentUser)!;
    const self = await inject(owner, 'PATCH', `/v1/members/${ownerMembership.id}`, { role: 'office' });
    expect(self.json().error.code).toBe('cannot_modify_self');
    const byAdmin = await inject(admin, 'PATCH', `/v1/members/${ownerMembership.id}`, { status: 'disabled' });
    expect(byAdmin.statusCode).toBe(403);
  });

  it('un membre désactivé perd l’accès', async () => {
    const luca = await inviteAndAccept('worker', 'Luca Rossi');
    const members = (await inject(owner, 'GET', '/v1/members')).json().members as {
      id: string;
      userId: string;
    }[];
    const m = members.find((x) => x.userId === luca.userId)!;
    await inject(owner, 'PATCH', `/v1/members/${m.id}`, { status: 'disabled' });
    const me = await t.app.inject({ url: '/v1/me', headers: { cookie: luca.cookie } });
    expect(me.json().tenant).toBeNull();
    expect(
      (await t.app.inject({ url: '/v1/notifications', headers: { cookie: luca.cookie } })).statusCode,
    ).toBe(403);
  });
});

describe('03 §1 — équipes, employés, INSS', () => {
  it('l’INSS est chiffré, masqué, et sa consultation est journalisée', async () => {
    const res = await inject(owner, 'POST', '/v1/employees', {
      firstName: 'Luca',
      lastName: 'Rossi',
      jobTitle: 'Carreleur',
      hourlyCost: 3650,
      inss: '85.07.30-033.28',
      skills: ['carrelage'],
    });
    expect(res.statusCode).toBe(201);
    const e = res.json();
    expect(e).toMatchObject({ hasInss: true, inssMasked: '••.••.••-•••.28', hourlyCost: 3650 });
    expect(JSON.stringify(e)).not.toContain('85073003328');
    const raw = await withSystem(t.prisma, (tx) => tx.employee.findUniqueOrThrow({ where: { id: e.id } }));
    expect(raw.inssEnc).not.toContain('85073003328');
    const inss = await inject(owner, 'GET', `/v1/employees/${e.id}/inss`);
    expect(inss.json().inss).toBe('85.07.30-033.28');
    const audit = await inject(owner, 'GET', `/v1/audit?entityType=employee&entityId=${e.id}`);
    expect(audit.json().items.map((a: { action: string }) => a.action)).toContain('employee.inss_viewed');
  });

  it('INSS invalide refusé ; le Bureau ne voit pas l’INSS ; l’Ouvrier ne voit pas les coûts', async () => {
    const bad = await inject(owner, 'POST', '/v1/employees', {
      firstName: 'A',
      lastName: 'B',
      inss: '85.07.30-033.29',
    });
    expect(bad.json().error.code).toBe('invalid_inss');
    const office = await inviteAndAccept('office', 'Sophie Bis');
    const list = await inject(office, 'GET', '/v1/employees');
    const luca = list.json().items.find((x: { firstName: string }) => x.firstName === 'Luca');
    expect((await inject(office, 'GET', `/v1/employees/${luca.id}/inss`)).statusCode).toBe(403);
    const worker = await inviteAndAccept('worker', 'Ouvrier Test');
    const wl = await inject(worker, 'GET', '/v1/employees');
    expect(wl.statusCode).toBe(403);
    const site = await inviteAndAccept('site_manager', 'Karim Test');
    const sl = await inject(site, 'GET', '/v1/employees');
    expect(sl.json().items[0]).toHaveProperty('hourlyCost');
  });

  it('équipes et absences', async () => {
    const emp = (
      await inject(owner, 'POST', '/v1/employees', { firstName: 'Karim', lastName: 'Benali' })
    ).json();
    const team = await inject(owner, 'POST', '/v1/teams', {
      name: 'Équipe Karim',
      color: '#1E7B45',
      leaderEmployeeId: emp.id,
      memberIds: [emp.id],
    });
    expect(team.statusCode).toBe(201);
    expect(team.json().memberIds).toEqual([emp.id]);
    const abs = await inject(owner, 'POST', `/v1/employees/${emp.id}/absences`, {
      kind: 'leave',
      startsOn: '2026-10-12',
      endsOn: '2026-10-16',
    });
    expect(abs.statusCode).toBe(201);
    const inverted = await inject(owner, 'POST', `/v1/employees/${emp.id}/absences`, {
      kind: 'leave',
      startsOn: '2026-10-16',
      endsOn: '2026-10-12',
    });
    expect(inverted.statusCode).toBe(400);
    const list = await inject(owner, 'GET', '/v1/absences?from=2026-10-01&to=2026-10-31');
    expect(list.json().items).toHaveLength(1);
    expect((await inject(owner, 'DELETE', `/v1/teams/${team.json().id}`)).statusCode).toBe(200);
  });
});

describe('onboarding et abonnement', () => {
  it('la checklist reflète l’état réel', async () => {
    const res = await inject(owner, 'GET', '/v1/company/onboarding');
    const steps = Object.fromEntries(
      res.json().steps.map((s: { step: string; done: boolean }) => [s.step, s.done]),
    );
    expect(steps).toMatchObject({
      company: true,
      bank: true,
      branding: true,
      rates: true,
      peppol: true,
      team: true,
      terms: false,
      library: false,
    });
    await inject(owner, 'PATCH', '/v1/company', { termsAndConditions: 'Conditions générales de vente…' });
    await inject(owner, 'POST', '/v1/library/starters', { trades: ['electrical'] });
    expect((await inject(owner, 'GET', '/v1/company/onboarding')).json().complete).toBe(true);
  });

  it('abonnement : sièges bureau facturés, ouvriers illimités', async () => {
    const res = await inject(owner, 'GET', '/v1/company/subscription');
    expect(res.json().plan).toBe('pro');
    expect(res.json().trialDaysLeft).toBe(14);
    expect(res.json().billableSeats).toBeLessThan(res.json().totalMembers);
  });
});

describe('administration plateforme', () => {
  it('réservée aux super-admins ; impersonation en lecture seule et auditée', async () => {
    expect((await inject(owner, 'GET', '/v1/admin/tenants')).statusCode).toBe(403);
    const admin = await signupCompany(t.app, 'Batimint HQ');
    await withSystem(t.prisma, (tx) =>
      tx.user.update({ where: { email: admin.email }, data: { isPlatformAdmin: true } }),
    );
    const list = await inject(admin, 'GET', '/v1/admin/tenants?q=Onboarding');
    expect(list.json().items[0].name).toBe('Rénov Onboarding');
    expect((await inject(admin, 'GET', '/v1/admin/overview')).json().tenants).toBeGreaterThan(1);
    await inject(admin, 'POST', `/v1/admin/tenants/${tenantId}/impersonate`);
    const me = await inject(admin, 'GET', '/v1/me');
    expect(me.json()).toMatchObject({ impersonating: true, role: 'accountant', tenant: { id: tenantId } });
    const write = await inject(admin, 'PATCH', '/v1/company', { name: 'Piratage' });
    expect(write.statusCode).toBe(403);
    await inject(admin, 'POST', '/v1/admin/impersonation/stop');
    expect((await inject(admin, 'GET', '/v1/me')).json().impersonating).toBe(false);
    const audit = await inject(owner, 'GET', '/v1/audit?entityType=tenant');
    expect(audit.json().items.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['platform.impersonation_started', 'platform.impersonation_stopped']),
    );
  });
});
