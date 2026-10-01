import {
  LoginRequestSchema,
  LoginResponseSchema,
  MagicLinkRequestSchema,
  MeResponseSchema,
  OkSchema,
  PasswordResetConfirmSchema,
  SessionInfoSchema,
  SignupRequestSchema,
  SwitchTenantSchema,
  TokenRequestSchema,
  TotpVerifySchema,
} from '@batimint/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { notFound } from '../lib/errors';
import { requireAuth } from '../plugins/auth';
import {
  buildMe,
  type CreatedSession,
  listSessions,
  login,
  requestMagicLink,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  SESSION_COOKIE,
  signup,
  switchTenant,
  totpDisable,
  totpEnable,
  totpSetup,
  verifyMagicLink,
} from '../services/auth';

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const meta = (req: FastifyRequest) => ({
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: req.id,
  });

  const setSessionCookie = (reply: FastifyReply, session: CreatedSession) => {
    void reply.setCookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: deps.config.isProduction,
      sameSite: 'lax',
      path: '/',
      domain: deps.config.COOKIE_DOMAIN,
      expires: session.expiresAt,
    });
  };

  const clearSessionCookie = (reply: FastifyReply) => {
    void reply.clearCookie(SESSION_COOKIE, { path: '/', domain: deps.config.COOKIE_DOMAIN });
  };

  app.post(
    '/auth/signup',
    {
      schema: { tags: ['auth'], summary: 'Créer un compte et son entreprise', body: SignupRequestSchema, response: { 201: LoginResponseSchema } },
      config: authRateLimit,
    },
    async (req, reply) => {
      const session = await signup(deps, req.body, meta(req));
      setSessionCookie(reply, session);
      return reply.status(201).send({ status: 'ok', sessionToken: session.token });
    },
  );

  app.post(
    '/auth/login',
    {
      schema: { tags: ['auth'], summary: 'Connexion par e-mail et mot de passe', body: LoginRequestSchema, response: { 200: LoginResponseSchema } },
      config: authRateLimit,
    },
    async (req, reply) => {
      const result = await login(deps, req.body, meta(req));
      if (result.status === 'mfa_required') return { status: 'mfa_required' as const };
      setSessionCookie(reply, result.session);
      return { status: 'ok' as const, sessionToken: result.session.token };
    },
  );

  app.post(
    '/auth/logout',
    { schema: { tags: ['auth'], summary: 'Déconnexion', response: { 200: OkSchema } } },
    async (req, reply) => {
      if (req.auth) await revokeSession(deps.prisma, req.auth.userId, req.auth.sessionId);
      clearSessionCookie(reply);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/magic-link',
    { schema: { tags: ['auth'], summary: 'Recevoir un lien de connexion', body: MagicLinkRequestSchema, response: { 200: OkSchema } }, config: authRateLimit },
    async (req) => {
      await requestMagicLink(deps, req.body.email);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/magic-link/verify',
    { schema: { tags: ['auth'], summary: 'Se connecter avec un lien magique', body: TokenRequestSchema, response: { 200: LoginResponseSchema } }, config: authRateLimit },
    async (req, reply) => {
      const session = await verifyMagicLink(deps, req.body.token, meta(req));
      setSessionCookie(reply, session);
      return { status: 'ok' as const, sessionToken: session.token };
    },
  );

  app.post(
    '/auth/password/forgot',
    { schema: { tags: ['auth'], summary: 'Demander une réinitialisation', body: MagicLinkRequestSchema, response: { 200: OkSchema } }, config: authRateLimit },
    async (req) => {
      await requestPasswordReset(deps, req.body.email);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/password/reset',
    { schema: { tags: ['auth'], summary: 'Choisir un nouveau mot de passe', body: PasswordResetConfirmSchema, response: { 200: LoginResponseSchema } }, config: authRateLimit },
    async (req, reply) => {
      const session = await resetPassword(deps, req.body.token, req.body.password, meta(req));
      setSessionCookie(reply, session);
      return { status: 'ok' as const, sessionToken: session.token };
    },
  );

  app.get('/me', { schema: { tags: ['auth'], summary: 'Utilisateur courant, entreprise active et permissions', response: { 200: MeResponseSchema } } }, async (req) =>
    buildMe(deps, requireAuth(req)),
  );

  app.post(
    '/auth/switch-tenant',
    { schema: { tags: ['auth'], summary: "Changer d'entreprise active", body: SwitchTenantSchema, response: { 200: OkSchema } } },
    async (req) => {
      await switchTenant(deps.prisma, requireAuth(req), req.body.tenantId);
      return { ok: true as const };
    },
  );

  app.get(
    '/auth/sessions',
    { schema: { tags: ['auth'], summary: 'Sessions ouvertes', response: { 200: z.object({ items: z.array(SessionInfoSchema) }) } } },
    async (req) => {
      const auth = requireAuth(req);
      const sessions = await listSessions(deps.prisma, auth.userId);
      return {
        items: sessions.map((s) => ({
          id: s.id,
          current: s.id === auth.sessionId,
          ip: s.ip,
          userAgent: s.userAgent,
          createdAt: s.createdAt.toISOString(),
          lastSeenAt: s.lastSeenAt.toISOString(),
        })),
      };
    },
  );

  app.delete(
    '/auth/sessions/:id',
    { schema: { tags: ['auth'], summary: 'Révoquer une session', params: z.object({ id: z.uuid() }), response: { 200: OkSchema } } },
    async (req) => {
      const auth = requireAuth(req);
      if (!(await revokeSession(deps.prisma, auth.userId, req.params.id))) throw notFound('Cette session');
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/totp/setup',
    { schema: { tags: ['auth'], summary: 'Préparer la double authentification', response: { 200: z.object({ secret: z.string(), otpauthUrl: z.string() }) } } },
    async (req) => totpSetup(deps, requireAuth(req)),
  );

  app.post(
    '/auth/totp/enable',
    { schema: { tags: ['auth'], summary: 'Activer la double authentification', body: TotpVerifySchema, response: { 200: OkSchema } } },
    async (req) => {
      await totpEnable(deps, requireAuth(req), req.body.code);
      return { ok: true as const };
    },
  );

  app.post(
    '/auth/totp/disable',
    { schema: { tags: ['auth'], summary: 'Désactiver la double authentification', body: TotpVerifySchema, response: { 200: OkSchema } } },
    async (req) => {
      await totpDisable(deps, requireAuth(req), req.body.code);
      return { ok: true as const };
    },
  );
};
