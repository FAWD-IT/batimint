import { can, type Action } from '@batimint/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps, AuthContext, TenantAuthContext } from '../context';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { resolveSession, SESSION_COOKIE } from '../services/auth';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function extractToken(req: FastifyRequest): { token: string; via: 'cookie' | 'bearer' } | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7).trim(), via: 'bearer' };
  const cookie = req.cookies?.[SESSION_COOKIE];
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

export const authPlugin = fp(async (app: FastifyInstance, opts: { deps: AppDeps }) => {
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    const found = extractToken(req);
    if (!found) return;
    // Protection CSRF : une requête modifiante authentifiée par cookie doit venir de nos origines.
    if (found.via === 'cookie' && UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && !opts.deps.config.allowedOrigins.includes(origin) && !isSameHost(origin, req)) {
        throw new AppError(403, 'bad_origin', 'Requête refusée : origine non autorisée.');
      }
    }
    const session = await resolveSession(opts.deps.prisma, found.token);
    if (session) req.auth = { ...session, via: found.via };
  });
});

function isSameHost(origin: string, req: FastifyRequest): boolean {
  try {
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Exige un tenant actif et, si demandé, une permission de la matrice (source de vérité). */
export function requireTenant(req: FastifyRequest, action?: Action): TenantAuthContext {
  const auth = requireAuth(req);
  if (!auth.tenantId || !auth.role) {
    throw new AppError(403, 'no_tenant', "Aucune entreprise active. Choisissez une entreprise ou créez-en une.");
  }
  if (action && !can(auth.role, action)) throw forbidden();
  if (auth.impersonatorId && UNSAFE.has(req.method)) {
    throw forbidden('Mode lecture seule (assistance Batimint) : aucune modification possible.');
  }
  return auth as TenantAuthContext;
}
