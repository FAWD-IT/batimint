import { createPrismaClient } from '@batimint/db';
import { createIntegrations } from '@batimint/integrations';
import { loadConfig } from './config';
import { FieldCipher } from './lib/crypto';
import { loadDotEnv } from './lib/env';
import { RealtimeHub } from './realtime/hub';
import { buildServer } from './server';

loadDotEnv();
const config = loadConfig();
const prisma = createPrismaClient({ url: config.DATABASE_URL, applicationName: 'batimint-api' });
const realtime = new RealtimeHub(config.DATABASE_URL);
const app = await buildServer({
  config,
  prisma,
  integrations: createIntegrations(),
  cipher: new FieldCipher(config.FIELD_ENCRYPTION_KEY),
  realtime,
});
await realtime.start();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'arrêt en cours : fin des requêtes, fermeture des flux SSE');
  const timer = setTimeout(() => process.exit(1), 15_000);
  try {
    await app.close();
    await realtime.stop();
    await prisma.$disconnect();
  } finally {
    clearTimeout(timer);
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.API_PORT, host: config.API_HOST });
