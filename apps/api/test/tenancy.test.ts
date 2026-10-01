import { withSystem } from '@batimint/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signupCompany, type SignedUp, type TestApp } from './helpers';

let t: TestApp;
let a: SignedUp;
let b: SignedUp;
beforeAll(async () => {
  t = await createTestApp();
  a = await signupCompany(t.app, 'Entreprise A');
  b = await signupCompany(t.app, 'Entreprise B');
});
afterAll(async () => {
  await t.close();
});

async function tenantIdOf(s: SignedUp): Promise<string> {
  return (await t.app.inject({ url: '/v1/me', headers: { cookie: s.cookie } })).json().tenant.id;
}

describe('isolation multi-tenant via l’API', () => {
  it('un utilisateur de A reçoit 404 sur une ressource valide de B', async () => {
    const tenantB = await tenantIdOf(b);
    const userB = (await t.app.inject({ url: '/v1/me', headers: { cookie: b.cookie } })).json().user.id;
    const notif = await withSystem(t.prisma, (tx) =>
      tx.notification.create({ data: { tenantId: tenantB, userId: userB, type: 'test', title: 'Secret B' } }),
    );
    const res = await t.app.inject({
      method: 'POST',
      url: `/v1/notifications/${notif.id}/read`,
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(404);
    const list = await t.app.inject({ url: '/v1/notifications', headers: { cookie: a.cookie } });
    expect(list.json().items.map((n: { title: string }) => n.title)).not.toContain('Secret B');
  });

  it('impossible de basculer vers un tenant dont on n’est pas membre', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/switch-tenant',
      headers: { cookie: a.cookie },
      payload: { tenantId: await tenantIdOf(b) },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('permissions vérifiées côté API', () => {
  it('un Ouvrier ne peut pas lancer de diagnostic (403)', async () => {
    const tenantA = await tenantIdOf(a);
    const userA = (await t.app.inject({ url: '/v1/me', headers: { cookie: a.cookie } })).json().user.id;
    await withSystem(t.prisma, (tx) =>
      tx.membership.update({
        where: { tenantId_userId: { tenantId: tenantA, userId: userA } },
        data: { role: 'worker' },
      }),
    );
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/diagnostics/ping',
      headers: { cookie: a.cookie },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    await withSystem(t.prisma, (tx) =>
      tx.membership.update({
        where: { tenantId_userId: { tenantId: tenantA, userId: userA } },
        data: { role: 'owner' },
      }),
    );
  });
});

describe('idempotence (règle n°6)', () => {
  it('rejoue la même réponse pour la même clé, sans second événement', async () => {
    const headers = { cookie: a.cookie, 'idempotency-key': 'ping-0001-abcdef' };
    const first = await t.app.inject({
      method: 'POST',
      url: '/v1/diagnostics/ping',
      headers,
      payload: { message: 'hors ligne' },
    });
    expect(first.statusCode).toBe(202);
    const second = await t.app.inject({
      method: 'POST',
      url: '/v1/diagnostics/ping',
      headers,
      payload: { message: 'hors ligne' },
    });
    expect(second.statusCode).toBe(202);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().eventId).toBe(first.json().eventId);
    const tenantA = await tenantIdOf(a);
    const count = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.count({
        where: {
          tenantId: tenantA,
          type: 'diagnostic.ping.v1',
          payload: { path: ['message'], equals: 'hors ligne' },
        },
      }),
    );
    expect(count).toBe(1);
  });

  it('refuse la réutilisation d’une clé pour une autre requête', async () => {
    const headers = { cookie: a.cookie, 'idempotency-key': 'ping-0002-abcdef' };
    await t.app.inject({ method: 'POST', url: '/v1/diagnostics/ping', headers, payload: { message: 'un' } });
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/diagnostics/ping',
      headers,
      payload: { message: 'deux' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('idempotency_key_reused');
  });
});
