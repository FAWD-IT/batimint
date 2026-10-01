/**
 * Provisionnement du rôle applicatif (sans BYPASSRLS) et des droits, exécuté après chaque migration.
 * Idempotent : peut être rejoué à chaque déploiement.
 */
import pg from 'pg';

export interface AppRoleCredentials {
  user: string;
  password: string;
}

export function credentialsFromUrl(url: string): AppRoleCredentials {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Crée ou met à jour le rôle applicatif, accorde les droits DML sur le schéma public,
 * révoque UPDATE/DELETE sur le journal d'audit et prépare le schéma pg-boss.
 */
export async function provisionAppRole(ownerUrl: string, appUrl: string): Promise<{ appUser: string; sameAsOwner: boolean }> {
  const owner = credentialsFromUrl(ownerUrl);
  const app = credentialsFromUrl(appUrl);
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const sameAsOwner = owner.user === app.user;
    const role = quoteIdent(app.user);
    if (!sameAsOwner) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [app.user]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await client.query(
        `${verb} ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${quoteLiteral(app.password)}`,
      );
      const db = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]!.db;
      await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(db)} TO ${role}`);
      await client.query(`GRANT USAGE ON SCHEMA public, rls TO ${role}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.query(`REVOKE ALL ON TABLE public."_prisma_migrations" FROM ${role}`).catch(() => undefined);
      await client.query(`REVOKE UPDATE, DELETE ON TABLE public."audit_logs" FROM ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rls TO ${role}`);
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
      );
      // pg-boss gère son propre schéma (files de jobs, sans données métier).
      await client.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${role}`);
      await client.query(`ALTER SCHEMA pgboss OWNER TO ${role}`);
    } else {
      await client.query('CREATE SCHEMA IF NOT EXISTS pgboss');
    }
    // Garde-fou : le rôle applicatif ne doit jamais contourner la RLS.
    const check = await client.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1',
      [app.user],
    );
    const r = check.rows[0];
    if (!sameAsOwner && (!r || r.rolbypassrls || r.rolsuper)) {
      throw new Error(`Le rôle applicatif ${app.user} contourne la RLS : refus de continuer.`);
    }
    return { appUser: app.user, sameAsOwner };
  } finally {
    await client.end();
  }
}

/** Liste les tables ayant une colonne tenant_id sans RLS forcée ni politique (doit être vide). */
export async function tablesMissingRls(client: pg.ClientBase): Promise<string[]> {
  const res = await client.query<{ table_name: string }>(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
           OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
    ORDER BY 1`);
  return res.rows.map((r) => r.table_name);
}
