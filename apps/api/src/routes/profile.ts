import { OkSchema, Password } from '@batimint/contracts';
import { withContext } from '@batimint/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { requireAuth } from '../plugins/auth';

export const profileRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.patch(
    '/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'Modifier mon profil',
        body: z.object({ name: z.string().trim().min(2).max(120) }),
        response: { 200: OkSchema },
      },
    },
    async (req) => {
      const auth = requireAuth(req);
      await withContext(deps.prisma, { userId: auth.userId }, (tx) =>
        tx.user.update({ where: { id: auth.userId }, data: { name: req.body.name } }),
      );
      return { ok: true as const };
    },
  );

  app.post(
    '/me/password',
    {
      schema: {
        tags: ['auth'],
        summary: 'Changer mon mot de passe',
        body: z.object({ currentPassword: z.string().max(200), newPassword: Password }),
        response: { 200: OkSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const auth = requireAuth(req);
      const newHash = await hashPassword(req.body.newPassword);
      await withContext(deps.prisma, { userId: auth.userId }, async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
        if (user.passwordHash && !(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
          throw new AppError(400, 'invalid_current_password', 'Mot de passe actuel incorrect.');
        }
        await tx.user.update({ where: { id: auth.userId }, data: { passwordHash: newHash } });
        // Les autres appareils sont déconnectés ; la session courante est conservée.
        await tx.session.updateMany({
          where: { userId: auth.userId, revokedAt: null, id: { not: auth.sessionId } },
          data: { revokedAt: new Date() },
        });
      });
      return { ok: true as const };
    },
  );
};
