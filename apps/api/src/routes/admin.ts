/**
 * Administration plateforme (03 §16) : tenants, plans, drapeaux, impersonation auditée
 * en lecture seule, santé des intégrations, jobs en échec avec rejeu.
 */
import { OkSchema } from '@batimint/contracts';
import { withSystem, writeAudit } from '@batimint/db';
import { FEATURES, PLANS } from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { forbidden, notFound } from '../lib/errors';
import { iso } from '../lib/tenant';
import { requireAuth } from '../plugins/auth';

function requirePlatformAdmin(req: FastifyRequest) {
  const auth = requireAuth(req);
  if (!auth.isPlatformAdmin) throw forbidden('Réservé aux administrateurs Batimint.');
  return auth;
}

const TenantAdminSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.enum(PLANS),
  featureFlags: z.record(z.string(), z.boolean()),
  trialEndsAt: z.string().nullable(),
  createdAt: z.string(),
  members: z.number().int(),
  ownerEmail: z.string().nullable(),
});

const JobSchema = z.object({
  id: z.string(),
  queue: z.string(),
  state: z.string(),
  retryCount: z.number().int(),
  data: z.unknown(),
  output: z.unknown(),
  createdOn: z.string(),
  completedOn: z.string().nullable(),
});

export const adminRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const pgbossInstalled = async () =>
    withSystem(
      deps.prisma,
      async (tx) =>
        (await tx.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`)[0]?.ok ??
        false,
    );

  app.get(
    '/admin/overview',
    {
      schema: {
        tags: ['admin'],
        summary: 'Vue d’ensemble plateforme',
        response: {
          200: z.object({
            tenants: z.number(),
            users: z.number(),
            failedJobs: z.number(),
            integrationErrors: z.number(),
            pendingEvents: z.number(),
          }),
        },
      },
    },
    async (req) => {
      requirePlatformAdmin(req);
      const hasBoss = await pgbossInstalled();
      return withSystem(deps.prisma, async (tx) => {
        const [tenants, users, integrationErrors, pendingEvents] = await Promise.all([
          tx.tenant.count(),
          tx.user.count(),
          tx.integrationConnection.count({ where: { status: 'error' } }),
          tx.outboxEvent.count({ where: { publishedAt: null } }),
        ]);
        const failedJobs = hasBoss
          ? Number(
              (
                await tx.$queryRaw<
                  { n: bigint }[]
                >`SELECT count(*)::bigint AS n FROM pgboss.job WHERE state = 'failed'`
              )[0]?.n ?? 0,
            )
          : 0;
        return { tenants, users, failedJobs, integrationErrors, pendingEvents };
      });
    },
  );

  app.get(
    '/admin/tenants',
    {
      schema: {
        tags: ['admin'],
        summary: 'Tenants',
        querystring: z.object({ q: z.string().max(100).optional() }),
        response: { 200: z.object({ items: z.array(TenantAdminSchema) }) },
      },
    },
    async (req) => {
      requirePlatformAdmin(req);
      return withSystem(deps.prisma, async (tx) => {
        const q = req.query.q?.trim();
        const rows = await tx.tenant.findMany({
          where: q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { slug: { contains: q } },
                  { enterpriseNumber: { contains: q } },
                ],
              }
            : {},
          include: { memberships: { include: { user: { select: { email: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        return {
          items: rows.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            plan: t.plan,
            featureFlags: (t.featureFlags ?? {}) as Record<string, boolean>,
            trialEndsAt: iso(t.trialEndsAt),
            createdAt: t.createdAt.toISOString(),
            members: t.memberships.filter((m) => m.status === 'active').length,
            ownerEmail: t.memberships.find((m) => m.role === 'owner')?.user.email ?? null,
          })),
        };
      });
    },
  );

  app.patch(
    '/admin/tenants/:id',
    {
      schema: {
        tags: ['admin'],
        summary: 'Modifier plan, drapeaux ou essai',
        params: z.object({ id: z.uuid() }),
        body: z.object({
          plan: z.enum(PLANS).optional(),
          featureFlags: z
            .partialRecord(z.enum([...FEATURES, 'all'] as [string, ...string[]]), z.boolean())
            .optional(),
          trialEndsAt: z.iso.datetime().nullable().optional(),
        }),
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      const admin = requirePlatformAdmin(req);
      await withSystem(deps.prisma, async (tx) => {
        const before = await tx.tenant.findUnique({ where: { id: req.params.id } });
        if (!before) throw notFound('Ce tenant');
        const data: Record<string, unknown> = {};
        if (req.body.plan) data['plan'] = req.body.plan;
        if (req.body.featureFlags) data['featureFlags'] = req.body.featureFlags;
        if (req.body.trialEndsAt !== undefined)
          data['trialEndsAt'] = req.body.trialEndsAt ? new Date(req.body.trialEndsAt) : null;
        await tx.tenant.update({ where: { id: before.id }, data });
        await writeAudit(tx, {
          tenantId: before.id,
          actor: { type: 'platform_admin', id: admin.userId, label: admin.name },
          action: 'platform.tenant_updated',
          entityType: 'tenant',
          entityId: before.id,
          changes: req.body,
          ip: req.ip,
          requestId: req.id,
        });
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/admin/tenants/:id/impersonate',
    {
      schema: {
        tags: ['admin'],
        summary: 'Ouvrir le tenant en lecture seule (audité)',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      const admin = requirePlatformAdmin(req);
      await withSystem(deps.prisma, async (tx) => {
        const t = await tx.tenant.findUnique({ where: { id: req.params.id } });
        if (!t) throw notFound('Ce tenant');
        await tx.session.update({
          where: { id: admin.sessionId },
          data: { activeTenantId: t.id, impersonatorId: admin.userId },
        });
        await writeAudit(tx, {
          tenantId: t.id,
          actor: { type: 'platform_admin', id: admin.userId, label: admin.name },
          action: 'platform.impersonation_started',
          entityType: 'tenant',
          entityId: t.id,
          ip: req.ip,
          userAgent: req.headers['user-agent'] ?? null,
          requestId: req.id,
        });
      });
      return { ok: true as const };
    },
  );

  app.post(
    '/admin/impersonation/stop',
    { schema: { tags: ['admin'], summary: 'Quitter le mode assistance', response: { 200: OkSchema } } },
    async (req) => {
      const auth = requireAuth(req);
      if (!auth.impersonatorId) return { ok: true as const };
      await withSystem(deps.prisma, async (tx) => {
        const own = await tx.membership.findFirst({
          where: { userId: auth.userId, status: 'active' },
          orderBy: { createdAt: 'asc' },
        });
        await tx.session.update({
          where: { id: auth.sessionId },
          data: { impersonatorId: null, activeTenantId: own?.tenantId ?? null },
        });
        if (auth.tenantId) {
          await writeAudit(tx, {
            tenantId: auth.tenantId,
            actor: { type: 'platform_admin', id: auth.userId, label: auth.name },
            action: 'platform.impersonation_stopped',
            entityType: 'tenant',
            entityId: auth.tenantId,
            requestId: req.id,
          });
        }
      });
      return { ok: true as const };
    },
  );

  app.get(
    '/admin/integrations',
    {
      schema: {
        tags: ['admin'],
        summary: 'Santé des intégrations',
        response: {
          200: z.object({
            items: z.array(
              z.object({
                tenantId: z.string(),
                tenantName: z.string(),
                kind: z.string(),
                provider: z.string(),
                status: z.string(),
                lastError: z.string().nullable(),
                lastCheckedAt: z.string().nullable(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      requirePlatformAdmin(req);
      return withSystem(deps.prisma, async (tx) => {
        const rows = await tx.integrationConnection.findMany({
          include: { tenant: { select: { name: true } } },
          orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
          take: 500,
        });
        return {
          items: rows.map((r) => ({
            tenantId: r.tenantId,
            tenantName: r.tenant.name,
            kind: r.kind,
            provider: r.provider,
            status: r.status,
            lastError: r.lastError,
            lastCheckedAt: iso(r.lastCheckedAt),
          })),
        };
      });
    },
  );

  app.get(
    '/admin/jobs',
    {
      schema: {
        tags: ['admin'],
        summary: 'Jobs (en échec par défaut)',
        querystring: z.object({ state: z.enum(['failed', 'retry', 'active', 'created']).default('failed') }),
        response: { 200: z.object({ items: z.array(JobSchema) }) },
      },
    },
    async (req) => {
      requirePlatformAdmin(req);
      if (!(await pgbossInstalled())) return { items: [] };
      return withSystem(deps.prisma, async (tx) => {
        const rows = await tx.$queryRaw<
          {
            id: string;
            name: string;
            state: string;
            retry_count: number;
            data: unknown;
            output: unknown;
            created_on: Date;
            completed_on: Date | null;
          }[]
        >`SELECT id, name, state::text AS state, retry_count, data, output, created_on, completed_on
          FROM pgboss.job WHERE state::text = ${req.query.state} AND name NOT LIKE '\\_\\_pgboss%'
          ORDER BY created_on DESC LIMIT 200`;
        return {
          items: rows.map((r) => ({
            id: r.id,
            queue: r.name,
            state: r.state,
            retryCount: r.retry_count,
            data: r.data,
            output: r.output,
            createdOn: r.created_on.toISOString(),
            completedOn: iso(r.completed_on),
          })),
        };
      });
    },
  );

  app.post(
    '/admin/jobs/:id/retry',
    {
      schema: {
        tags: ['admin'],
        summary: 'Rejouer un job en échec',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      requirePlatformAdmin(req);
      const updated = await withSystem(
        deps.prisma,
        (tx) =>
          tx.$executeRaw`UPDATE pgboss.job SET state = 'retry', retry_count = 0, start_after = now(), completed_on = NULL, output = NULL
                       WHERE id = ${req.params.id}::uuid AND state = 'failed'`,
      );
      if (updated === 0) throw notFound('Ce job en échec');
      return { ok: true as const };
    },
  );
};
