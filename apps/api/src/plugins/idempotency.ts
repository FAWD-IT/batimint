/**
 * Idempotence (CLAUDE.md règle n°6) : tout POST/PUT/PATCH/DELETE peut porter un en-tête
 * Idempotency-Key. La première réponse (< 500) est mémorisée et rejouée telle quelle ;
 * réutiliser une clé pour une autre requête est refusé. Indispensable pour le mobile hors ligne.
 */
import { withTenant } from '@batimint/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from '../context';
import { sha256 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { toJson } from '../lib/json';

declare module 'fastify' {
  interface FastifyRequest {
    idempotency: { tenantId: string; scope: string; key: string } | null;
  }
}

const METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

function scopeOf(req: FastifyRequest): { tenantId: string; scope: string } | null {
  if (req.auth?.tenantId) return { tenantId: req.auth.tenantId, scope: `user:${req.auth.userId}` };
  return null;
}

export const idempotencyPlugin = fp(async (app: FastifyInstance, opts: { deps: AppDeps }) => {
  const { prisma } = opts.deps;
  app.decorateRequest('idempotency', null);

  app.addHook('preHandler', async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !METHODS.has(req.method)) return;
    if (!KEY_PATTERN.test(key)) {
      throw new AppError(
        400,
        'invalid_idempotency_key',
        'En-tête Idempotency-Key invalide (8 à 128 caractères, sans espace).',
      );
    }
    const scope = scopeOf(req);
    if (!scope) return;
    const requestHash = sha256(
      `${req.method} ${req.routeOptions.url ?? req.url} ${req.url} ${toJson(req.body ?? null)}`,
    );
    const existing = await withTenant(prisma, scope.tenantId, req.auth?.userId ?? null, async (tx) => {
      const found = await tx.idempotencyKey.findUnique({
        where: { tenantId_scope_key: { tenantId: scope.tenantId, scope: scope.scope, key } },
      });
      if (found) return found;
      await tx.idempotencyKey.create({
        data: { tenantId: scope.tenantId, scope: scope.scope, key, requestHash, responseStatus: 0 },
      });
      return null;
    });
    if (!existing) {
      req.idempotency = { tenantId: scope.tenantId, scope: scope.scope, key };
      return;
    }
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        422,
        'idempotency_key_reused',
        'Cette clé d’idempotence a déjà servi pour une autre requête.',
      );
    }
    if (existing.responseStatus === 0) {
      throw new AppError(
        409,
        'request_in_progress',
        'Cette requête est déjà en cours de traitement. Réessayez dans un instant.',
      );
    }
    void reply
      .header('idempotent-replayed', 'true')
      .header('content-type', 'application/json; charset=utf-8')
      .status(existing.responseStatus)
      .send(existing.responseBody === null ? '' : JSON.stringify(existing.responseBody));
    return reply;
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const idem = req.idempotency;
    if (!idem) return payload;
    req.idempotency = null;
    const where = { tenantId_scope_key: { tenantId: idem.tenantId, scope: idem.scope, key: idem.key } };
    await withTenant(prisma, idem.tenantId, req.auth?.userId ?? null, async (tx) => {
      if (reply.statusCode >= 500) {
        await tx.idempotencyKey.delete({ where });
        return;
      }
      let body: unknown = null;
      if (typeof payload === 'string' && payload.length > 0) {
        try {
          body = JSON.parse(payload);
        } catch {
          body = null;
        }
      }
      await tx.idempotencyKey.update({
        where,
        data: {
          responseStatus: reply.statusCode,
          responseBody: body === null ? undefined : (body as object),
        },
      });
    }).catch((err: unknown) => req.log.error({ err }, 'mémorisation idempotence impossible'));
    return payload;
  });
});
