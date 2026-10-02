import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createSerializerCompiler,
  jsonSchemaTransform,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps } from './context';
import { jsonReplacer } from './lib/json';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';
import { idempotencyPlugin } from './plugins/idempotency';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { attachmentRoutes } from './routes/attachments';
import { companyRoutes } from './routes/company';
import { crmRoutes } from './routes/crm';
import { healthRoutes } from './routes/health';
import { integrationRoutes } from './routes/integrations';
import { leadRoutes } from './routes/leads';
import { libraryRoutes } from './routes/library';
import { memberRoutes } from './routes/members';
import { opportunityRoutes } from './routes/opportunities';
import { notificationRoutes } from './routes/notifications';
import { peopleRoutes } from './routes/people';
import { portalRoutes } from './routes/portal';
import { portalProjectRoutes } from './routes/portal-projects';
import { profileRoutes } from './routes/profile';
import { quoteRoutes } from './routes/quotes';
import { projectRoutes } from './routes/projects';
import { changeOrderRoutes } from './routes/change-orders';
import { commentRoutes } from './routes/comments';
import { searchRoutes } from './routes/search';
import { fieldRoutes } from './routes/field';
import { planningRoutes } from './routes/planning';
import { peppolWebhookRoutes, purchasingRoutes } from './routes/purchasing';
import { realtimeRoutes } from './routes/realtime';

export interface BuildOptions {
  logger?: boolean | object;
}

export async function buildServer(deps: AppDeps, options: BuildOptions = {}): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      options.logger ??
      (config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            ...(config.isProduction
              ? {}
              : {
                  transport: {
                    target: 'pino-pretty',
                    options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
                  },
                }),
          }),
    genReqId: (req) =>
      typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : uuidv7(),
    trustProxy: config.TRUST_PROXY || config.isProduction,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(createSerializerCompiler({ replacer: jsonReplacer }));

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, { origin: config.allowedOrigins, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    global: !config.RATE_LIMIT_DISABLED,
    max: 600,
    timeWindow: '1 minute',
    allowList: () => config.RATE_LIMIT_DISABLED,
  });
  await app.register(errorsPlugin);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Batimint API',
        version: '1.0.0',
        description:
          "API de Batimint. Authentification par cookie de session (web) ou en-tête Authorization: Bearer <jeton> (mobile). Les POST acceptent un en-tête Idempotency-Key. Les montants sont en centimes d'euro (entiers).",
      },
      servers: [{ url: config.API_URL }],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'bm_session' },
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes, { deps });
  await app.register(
    async (v1) => {
      await v1.register(authPlugin, { deps });
      await v1.register(idempotencyPlugin, { deps });
      await v1.register(authRoutes, { deps });
      await v1.register(notificationRoutes, { deps });
      await v1.register(realtimeRoutes, { deps });
      await v1.register(profileRoutes, { deps });
      await v1.register(companyRoutes, { deps });
      await v1.register(memberRoutes, { deps });
      await v1.register(peopleRoutes, { deps });
      await v1.register(integrationRoutes, { deps });
      await v1.register(adminRoutes, { deps });
      await v1.register(crmRoutes, { deps });
      await v1.register(leadRoutes, { deps });
      await v1.register(opportunityRoutes, { deps });
      await v1.register(attachmentRoutes, { deps });
      await v1.register(libraryRoutes, { deps });
      await v1.register(quoteRoutes, { deps });
      await v1.register(projectRoutes, { deps });
      await v1.register(changeOrderRoutes, { deps });
      await v1.register(commentRoutes, { deps });
      await v1.register(searchRoutes, { deps });
      await v1.register(fieldRoutes, { deps });
      await v1.register(planningRoutes, { deps });
      await v1.register(purchasingRoutes, { deps });
      await v1.register(peppolWebhookRoutes, { deps });
      await v1.register(portalRoutes, { deps });
      await v1.register(portalProjectRoutes, { deps });
      v1.get('/openapi.json', { schema: { hide: true }, config: { rateLimit: false } }, async () =>
        app.swagger(),
      );
    },
    { prefix: '/v1' },
  );

  return app;
}
