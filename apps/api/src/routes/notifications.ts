import { DiagnosticPingRequestSchema, DiagnosticPingResponseSchema, NotificationListSchema, OkSchema } from '@batimint/contracts';
import { emitEvent, withTenant, writeAudit } from '@batimint/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { notFound } from '../lib/errors';
import { requireTenant } from '../plugins/auth';

export const notificationRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/notifications',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Centre de notifications',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
        response: { 200: NotificationListSchema },
      },
    },
    async (req) => {
      const auth = requireTenant(req);
      return withTenant(deps.prisma, auth.tenantId, auth.userId, async (tx) => {
        const [items, unreadCount] = await Promise.all([
          tx.notification.findMany({
            where: { userId: auth.userId },
            orderBy: { createdAt: 'desc' },
            take: req.query.limit,
          }),
          tx.notification.count({ where: { userId: auth.userId, readAt: null } }),
        ]);
        return {
          unreadCount,
          items: items.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            link: n.link,
            readAt: n.readAt?.toISOString() ?? null,
            createdAt: n.createdAt.toISOString(),
          })),
        };
      });
    },
  );

  app.post(
    '/notifications/:id/read',
    { schema: { tags: ['notifications'], summary: 'Marquer comme lue', params: z.object({ id: z.uuid() }), response: { 200: OkSchema } } },
    async (req) => {
      const auth = requireTenant(req);
      const res = await withTenant(deps.prisma, auth.tenantId, auth.userId, (tx) =>
        tx.notification.updateMany({ where: { id: req.params.id, userId: auth.userId }, data: { readAt: new Date() } }),
      );
      if (res.count === 0) throw notFound('Cette notification');
      return { ok: true as const };
    },
  );

  app.post(
    '/notifications/read-all',
    { schema: { tags: ['notifications'], summary: 'Tout marquer comme lu', response: { 200: OkSchema } } },
    async (req) => {
      const auth = requireTenant(req);
      await withTenant(deps.prisma, auth.tenantId, auth.userId, (tx) =>
        tx.notification.updateMany({ where: { userId: auth.userId, readAt: null }, data: { readAt: new Date() } }),
      );
      return { ok: true as const };
    },
  );

  /**
   * Diagnostic de bout en bout : API → outbox → worker → pg_notify → SSE → navigateur.
   * Sert au critère de sortie de M0 et au bouton « Tester la chaîne temps réel » des paramètres.
   */
  app.post(
    '/diagnostics/ping',
    {
      schema: {
        tags: ['diagnostics'],
        summary: 'Émettre un événement de test traversant toute la chaîne temps réel',
        body: DiagnosticPingRequestSchema,
        response: { 202: DiagnosticPingResponseSchema },
      },
    },
    async (req, reply) => {
      const auth = requireTenant(req, 'diagnostics.run');
      const event = await withTenant(deps.prisma, auth.tenantId, auth.userId, async (tx) => {
        const actor = { type: 'user' as const, id: auth.userId, label: auth.name };
        await writeAudit(tx, { tenantId: auth.tenantId, actor, action: 'diagnostic.ping', entityType: 'tenant', entityId: auth.tenantId, requestId: req.id });
        return emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'diagnostic.ping.v1',
          aggregateType: 'tenant',
          aggregateId: auth.tenantId,
          payload: { requestedBy: auth.userId, message: req.body.message ?? 'Chaîne temps réel opérationnelle' },
          actor,
        });
      });
      return reply.status(202).send({ eventId: event.id, emittedAt: event.occurredAt.toISOString() });
    },
  );
};
