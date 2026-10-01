import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@batimint/db';
import { createIntegrations } from '@batimint/integrations';
import pino from 'pino';
import { createBoss, registerConsumers } from './boss';
import { loadDotEnv } from './env';
import { OutboxRelay } from './relay';

loadDotEnv();
const isProduction = process.env['NODE_ENV'] === 'production';
const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'worker' },
  ...(isProduction
    ? {}
    : {
        transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
      }),
});

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  logger.error('DATABASE_URL manquant');
  process.exit(1);
}

export const HEALTH_FILE = process.env['WORKER_HEALTH_FILE'] ?? '/tmp/batimint-worker-heartbeat';

const prisma = createPrismaClient({ url: databaseUrl, applicationName: 'batimint-worker', max: 10 });
const deps = {
  prisma,
  integrations: createIntegrations(),
  appUrl: process.env['APP_URL'] ?? 'http://localhost:3000',
};
const boss = createBoss(databaseUrl);
boss.on('error', (err) => logger.error({ err }, 'pg-boss'));
await boss.start();
await registerConsumers(boss, deps, logger);
const relay = new OutboxRelay(deps, boss, databaseUrl, logger);
await relay.start();

const beat = () => {
  try {
    writeFileSync(HEALTH_FILE, String(Date.now()));
  } catch (err) {
    logger.warn({ err }, 'battement de santé impossible');
  }
};
beat();
const heartbeat = setInterval(beat, 10_000);
logger.info('worker démarré : relais outbox et consommateurs actifs');

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'arrêt : fin du job en cours');
  clearInterval(heartbeat);
  const timer = setTimeout(() => process.exit(1), 30_000);
  await relay.stop();
  await boss.stop({ graceful: true, timeout: 25_000 });
  await prisma.$disconnect();
  clearTimeout(timer);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
