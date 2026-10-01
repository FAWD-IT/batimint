/**
 * Flux SSE (06 « Temps réel ») : l'abonné reçoit les messages de ses canaux autorisés.
 * Canaux implicites : user:{id} et tenant:{id}. Les canaux supplémentaires (project:…) sont
 * vérifiés au moment de l'abonnement.
 */
import { tenantChannel, userChannel } from '@batimint/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { requireTenant } from '../plugins/auth';

const HEARTBEAT_MS = 20_000;

export const realtimeRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  const open = new Set<() => void>();
  // Arrêt propre : on ferme les flux pour que les clients se reconnectent ailleurs.
  app.addHook('onClose', async () => {
    for (const close of open) close();
  });

  app.get(
    '/realtime/stream',
    {
      schema: {
        tags: ['realtime'],
        summary: 'Flux Server-Sent Events',
        querystring: z.object({ channels: z.string().max(2000).optional() }),
      },
      config: { rateLimit: false },
    },
    async (req, reply) => {
      const auth = requireTenant(req);
      const channels = new Set<string>([userChannel(auth.userId), tenantChannel(auth.tenantId), `tenant:${auth.tenantId}:inbox`]);
      for (const c of req.query.channels?.split(',') ?? []) {
        // Les canaux projet sont autorisés pour les membres du tenant ; la RLS garantit que
        // les données rechargées ensuite appartiennent bien au tenant.
        if (/^project:[0-9a-f-]{36}$/.test(c)) channels.add(c);
      }
      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write(`retry: 3000\n`);
      res.write(`event: ready\ndata: ${JSON.stringify({ channels: [...channels] })}\n\n`);
      const unsubscribe = deps.realtime.subscribe({
        tenantId: auth.tenantId,
        channels,
        send: (msg) => {
          res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`);
        },
      });
      const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);
      const close = () => {
        if (!open.delete(close)) return;
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      };
      open.add(close);
      req.raw.on('close', close);
    },
  );
};
