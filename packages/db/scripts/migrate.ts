/**
 * pnpm db:migrate (dev) / pnpm db:migrate:deploy (production, service `migrate` de Coolify).
 * 1. attend la base ; 2. applique les migrations Prisma avec le rôle propriétaire ;
 * 3. provisionne le rôle applicatif sans BYPASSRLS ; 4. vérifie que toutes les tables métier ont la RLS.
 * 5. si SEED_DEMO=true, charge le tenant de démonstration (idempotent).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { provisionAppRole, tablesMissingRls } from '../src/roles';
import { loadEnv } from './env';

loadEnv();

const mode = process.argv[2] === 'dev' ? 'dev' : 'deploy';
const appUrl = process.env['DATABASE_URL'];
const ownerUrl = process.env['MIGRATION_DATABASE_URL'] ?? appUrl;
if (!appUrl || !ownerUrl) {
  console.error('DATABASE_URL (et MIGRATION_DATABASE_URL) sont requis.');
  process.exit(1);
}

async function waitForDatabase(url: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase(ownerUrl!);
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const args = mode === 'dev' ? ['migrate', 'dev', '--skip-generate'] : ['migrate', 'deploy'];
  const prismaBin = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const result = spawnSync(prismaBin, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
    shell: false,
  });
  if (result.status !== 0) {
    // `prisma migrate dev` n'accepte plus --skip-generate dans certaines versions : on retente sans.
    if (mode === 'dev') {
      const retry = spawnSync(prismaBin, ['migrate', 'dev'], { cwd, stdio: 'inherit', env: process.env });
      if (retry.status !== 0) process.exit(retry.status ?? 1);
    } else {
      process.exit(result.status ?? 1);
    }
  }
  if (mode === 'dev') spawnSync(prismaBin, ['generate'], { cwd, stdio: 'inherit', env: process.env });
  const { appUser, sameAsOwner } = await provisionAppRole(ownerUrl!, appUrl!);
  if (sameAsOwner) {
    console.warn(
      `⚠ DATABASE_URL utilise le rôle propriétaire (${appUser}) : la RLS n'est pas appliquée. Définir MIGRATION_DATABASE_URL.`,
    );
  } else {
    console.info(`Rôle applicatif « ${appUser} » provisionné (sans BYPASSRLS).`);
  }
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  const missing = await tablesMissingRls(client);
  await client.end();
  if (missing.length > 0) {
    console.error(`Tables métier sans RLS : ${missing.join(', ')}`);
    process.exit(1);
  }
  console.info('Migrations appliquées, RLS vérifiée sur toutes les tables métier.');
  if (process.env['SEED_DEMO'] === 'true' && mode === 'deploy') {
    const seed = spawnSync(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './seed.ts' : './seed.js', import.meta.url)),
      ],
      {
        stdio: 'inherit',
        env: process.env,
      },
    );
    if (seed.status !== 0) process.exit(seed.status ?? 1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
