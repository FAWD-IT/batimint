import { withSystem } from '@batimint/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookieSecure } from '../src/services/auth';
import { createTestApp, sessionCookie, signupCompany, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('santé', () => {
  it('/health et /ready', async () => {
    expect((await t.app.inject({ url: '/health' })).json()).toEqual({ status: 'ok' });
    const ready = await t.app.inject({ url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.database).toBe('ok');
    expect(ready.json().checks.migrations).toBe('ok');
  });

  it('OpenAPI 3.1 généré depuis les schémas zod', async () => {
    const res = await t.app.inject({ url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/v1/auth/signup', '/v1/me', '/v1/diagnostics/ping']),
    );
  });
});

describe('P1.1 — inscription et connexion', () => {
  it('l’inscription crée l’entreprise, rend Owner et ouvre une session', async () => {
    const s = await signupCompany(t.app, "Rénov'Habitat Test");
    const me = await t.app.inject({ url: '/v1/me', headers: { cookie: s.cookie } });
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.role).toBe('owner');
    expect(body.tenant.name).toBe("Rénov'Habitat Test");
    expect(body.tenant.slug).toMatch(/^renovhabitat-test/);
    expect(body.permissions).toContain('subscription.manage');
    // L'événement tenant.created est écrit dans l'outbox, dans la même transaction.
    const events = await withSystem(t.prisma, (tx) =>
      tx.outboxEvent.findMany({ where: { tenantId: body.tenant.id } }),
    );
    expect(events.map((e) => e.type)).toContain('tenant.created.v1');
    const audit = await withSystem(t.prisma, (tx) =>
      tx.auditLog.findMany({ where: { tenantId: body.tenant.id } }),
    );
    expect(audit.map((a) => a.action)).toContain('tenant.created');
  });

  it('refuse un e-mail déjà utilisé avec un message clair', async () => {
    const s = await signupCompany(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/signup',
      payload: { companyName: 'Autre', name: 'Xavier', email: s.email, password: 'motdepasse-solide-42' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('email_taken');
    expect(res.json().error.message).toMatch(/Mot de passe oublié/);
  });

  it('valide les champs en français', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('connexion : mauvais mot de passe puis bon', async () => {
    const s = await signupCompany(t.app);
    const bad = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: s.email, password: 'faux' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('invalid_credentials');
    const ok = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: s.email.toUpperCase(), password: s.password },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('ok');
    // Le jeton fonctionne aussi en Bearer (app mobile).
    const me = await t.app.inject({
      url: '/v1/me',
      headers: { authorization: `Bearer ${ok.json().sessionToken}` },
    });
    expect(me.json().user.email).toBe(s.email);
  });

  it('sans session : 401', async () => {
    const res = await t.app.inject({ url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toMatch(/Reconnectez-vous/);
  });

  it('lien magique : e-mail envoyé, lien à usage unique', async () => {
    const s = await signupCompany(t.app);
    await t.app.inject({ method: 'POST', url: '/v1/auth/magic-link', payload: { email: s.email } });
    const mail = t.mailer.lastTo(s.email);
    expect(mail?.subject).toMatch(/lien de connexion/);
    const token = decodeURIComponent(/token=([^"&\s]+)/.exec(mail!.text)![1]!);
    const first = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link/verify',
      payload: { token },
    });
    expect(first.statusCode).toBe(200);
    sessionCookie(first);
    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link/verify',
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('invalid_token');
  });

  it('lien magique pour une adresse inconnue : même réponse, aucun e-mail', async () => {
    const before = t.mailer.sent.length;
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/magic-link',
      payload: { email: 'inconnu@example.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(t.mailer.sent.length).toBe(before);
  });

  it('réinitialisation : nouveau mot de passe et révocation des autres sessions', async () => {
    const s = await signupCompany(t.app);
    await t.app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: s.email } });
    const token = decodeURIComponent(/token=([^"&\s]+)/.exec(t.mailer.lastTo(s.email)!.text)![1]!);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/password/reset',
      payload: { token, password: 'nouveau-mot-de-passe-99' },
    });
    expect(res.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/v1/me', headers: { cookie: s.cookie } })).statusCode).toBe(401);
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: s.email, password: 'nouveau-mot-de-passe-99' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('sessions : liste et révocation', async () => {
    const s = await signupCompany(t.app);
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: s.email, password: s.password },
    });
    const other = sessionCookie(login);
    const list = await t.app.inject({ url: '/v1/auth/sessions', headers: { cookie: s.cookie } });
    expect(list.json().items).toHaveLength(2);
    const target = list.json().items.find((i: { current: boolean }) => !i.current);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${target.id}`,
      headers: { cookie: s.cookie },
    });
    expect(del.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/v1/me', headers: { cookie: other } })).statusCode).toBe(401);
    const logout = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: s.cookie },
    });
    expect(logout.statusCode).toBe(200);
    expect((await t.app.inject({ url: '/v1/me', headers: { cookie: s.cookie } })).statusCode).toBe(401);
  });

  it('refuse une requête modifiante par cookie venant d’une autre origine (CSRF)', async () => {
    const s = await signupCompany(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/notifications/read-all',
      headers: { cookie: s.cookie, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('bad_origin');
  });

  it('double authentification TOTP', async () => {
    const OTPAuth = await import('otpauth');
    const s = await signupCompany(t.app);
    const setup = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/totp/setup',
      headers: { cookie: s.cookie },
    });
    const secret: string = setup.json().secret;
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 });
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/totp/enable',
      headers: { cookie: s.cookie },
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(400);
    const en = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/totp/enable',
      headers: { cookie: s.cookie },
      payload: { code: totp.generate() },
    });
    expect(en.statusCode).toBe(200);
    const step1 = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: s.email, password: s.password },
    });
    expect(step1.json().status).toBe('mfa_required');
    const step2 = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: s.email, password: s.password, totp: totp.generate() },
    });
    expect(step2.json().status).toBe('ok');
  });
});

describe('cookie de session', () => {
  it('Secure en production derrière HTTPS seulement (accès HTTP direct possible)', () => {
    expect(sessionCookieSecure('https', true)).toBe(true);
    expect(sessionCookieSecure('http', true)).toBe(false);
    expect(sessionCookieSecure('https', false)).toBe(false);
  });
});
