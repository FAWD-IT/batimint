/** Healthcheck Docker du worker : le battement doit dater de moins de 60 s. */
import { readFileSync } from 'node:fs';

const file = process.env['WORKER_HEALTH_FILE'] ?? '/tmp/batimint-worker-heartbeat';
try {
  const last = Number(readFileSync(file, 'utf8'));
  process.exit(Date.now() - last < 60_000 ? 0 : 1);
} catch {
  process.exit(1);
}
