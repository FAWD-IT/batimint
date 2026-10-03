import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
import { defineConfig } from 'prisma/config';

// Les migrations s'exécutent avec le rôle propriétaire (MIGRATION_DATABASE_URL).
// L'application, elle, se connecte avec un rôle sans BYPASSRLS (DATABASE_URL).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url:
      process.env['MIGRATION_DATABASE_URL'] ??
      process.env['DATABASE_URL'] ??
      'postgresql://postgres:postgres@localhost:5432/batimint',
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
