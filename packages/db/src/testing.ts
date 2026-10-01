/**
 * Outils de test d'intégration : prépare une base de test migrée, avec le rôle applicatif
 * provisionné, et renvoie les URLs propriétaire / applicative.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { provisionAppRole } from './roles';

export interface TestDatabase {
  ownerUrl: string;
  appUrl: string;
}

export function testDatabaseUrls(): TestDatabase {
  const ownerUrl = process.env['TEST_DATABASE_URL'] ?? 'postgresql://postgres:postgres@localhost:5432/batimint_test';
  const app = new URL(process.env['DATABASE_URL'] ?? 'postgresql://batimint_app:batimint_app@localhost:5432/batimint');
  const appUrl = new URL(ownerUrl);
  appUrl.username = app.username;
  appUrl.password = app.password;
  return { ownerUrl, appUrl: appUrl.toString() };
}

async function ensureDatabaseExists(ownerUrl: string): Promise<void> {
  const target = new URL(ownerUrl);
  const dbName = target.pathname.replace(/^\//, '');
  const admin = new URL(ownerUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

/** Applique les migrations sur la base de test (idempotent). */
export async function prepareTestDatabase(): Promise<TestDatabase> {
  const urls = testDatabaseUrls();
  await ensureDatabaseExists(urls.ownerUrl);
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const res = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd,
    env: { ...process.env, MIGRATION_DATABASE_URL: urls.ownerUrl },
    encoding: 'utf8',
  });
  if (res.status !== 0) throw new Error(`Migration de la base de test impossible :\n${res.stdout}\n${res.stderr}`);
  await provisionAppRole(urls.ownerUrl, urls.appUrl);
  return urls;
}

/** Vide toutes les tables métier (rôle propriétaire). */
export async function truncateAll(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const res = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (res.rows.length === 0) return;
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.allow_tenant_purge', 'on', true)");
    await client.query(`TRUNCATE ${res.rows.map((r) => `"${r.tablename}"`).join(', ')} CASCADE`);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}
