import { withSystem } from '@batimint/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';

export const healthRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.get(
    '/health',
    { schema: { hide: true, response: { 200: z.object({ status: z.literal('ok') }) } }, config: { rateLimit: false } },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/ready',
    {
      schema: {
        hide: true,
        response: {
          200: z.object({ status: z.enum(['ready', 'degraded']), checks: z.record(z.string(), z.string()) }),
          503: z.object({ status: z.literal('not_ready'), checks: z.record(z.string(), z.string()) }),
        },
      },
      config: { rateLimit: false },
    },
    async (_req, reply) => {
      const checks: Record<string, string> = {};
      let fatal = false;
      try {
        const rows = await withSystem(deps.prisma, (tx) =>
          tx.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public.outbox_events') IS NOT NULL AS ok`,
        );
        checks['database'] = 'ok';
        checks['migrations'] = rows[0]?.ok ? 'ok' : 'missing';
        if (!rows[0]?.ok) fatal = true;
      } catch {
        checks['database'] = 'unreachable';
        fatal = true;
      }
      try {
        await deps.integrations.storage.ping();
        checks['storage'] = 'ok';
      } catch {
        checks['storage'] = 'unreachable';
      }
      checks['realtime'] = deps.realtime.connected ? 'ok' : 'disconnected';
      if (fatal) return reply.status(503).send({ status: 'not_ready' as const, checks });
      const degraded = Object.values(checks).some((v) => v !== 'ok');
      return { status: degraded ? ('degraded' as const) : ('ready' as const), checks };
    },
  );
};
