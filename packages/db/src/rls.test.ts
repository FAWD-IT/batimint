/**
 * CLAUDE.md règle n°1 — un tenant ne voit jamais les données d'un autre.
 * Tests contre un vrai Postgres, avec le rôle applicatif (sans BYPASSRLS).
 */
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../scripts/env';
import { createPrismaClient, type PrismaClient } from './client';
import { withContext, withSystem, withTenant } from './context';
import { emitEvent } from './outbox';
import { tablesMissingRls } from './roles';
import { nextSequenceValue } from './sequences';
import { testDatabaseUrls, truncateAll } from './testing';
import { checkSequenceContinuity } from '@batimint/domain';

loadEnv();
const urls = testDatabaseUrls('db');
let db: PrismaClient;
const A = { tenant: uuidv7(), user: uuidv7() };
const B = { tenant: uuidv7(), user: uuidv7() };

beforeAll(async () => {
  await truncateAll(urls.ownerUrl);
  db = createPrismaClient({ url: urls.appUrl, max: 20 });
  await withSystem(db, async (tx) => {
    for (const [i, t] of [A, B].entries()) {
      await tx.tenant.create({
        data: { id: t.tenant, name: `Tenant ${i}`, slug: `tenant-${i}-${t.tenant.slice(-6)}` },
      });
      await tx.user.create({
        data: { id: t.user, email: `user${i}-${t.user.slice(-6)}@example.test`, name: `User ${i}` },
      });
      await tx.membership.create({ data: { tenantId: t.tenant, userId: t.user, role: 'owner' } });
      await tx.notification.create({
        data: { tenantId: t.tenant, userId: t.user, type: 'test', title: `N${i}` },
      });
    }
  });
});

afterAll(async () => {
  await db?.$disconnect();
});

describe('isolation multi-tenant par RLS', () => {
  it('le rôle applicatif n’a ni BYPASSRLS ni SUPERUSER', async () => {
    const client = new pg.Client({ connectionString: urls.appUrl });
    await client.connect();
    const r = await client.query('SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user');
    await client.end();
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('toutes les tables portant tenant_id ont une RLS forcée et une politique', async () => {
    const client = new pg.Client({ connectionString: urls.ownerUrl });
    await client.connect();
    const missing = await tablesMissingRls(client);
    await client.end();
    expect(missing).toEqual([]);
  });

  it('sans contexte, aucune donnée n’est visible', async () => {
    const count = await withContext(db, {}, (tx) => tx.notification.count());
    expect(count).toBe(0);
    expect(await withContext(db, {}, (tx) => tx.tenant.count())).toBe(0);
  });

  it('le tenant A ne voit que ses lignes', async () => {
    const rows = await withTenant(db, A.tenant, A.user, (tx) => tx.notification.findMany());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(A.tenant);
  });

  it('un ID valide du tenant B est introuvable depuis A (lecture, mise à jour, suppression)', async () => {
    const bNotif = await withTenant(db, B.tenant, B.user, (tx) => tx.notification.findFirstOrThrow());
    await withTenant(db, A.tenant, A.user, async (tx) => {
      expect(await tx.notification.findUnique({ where: { id: bNotif.id } })).toBeNull();
      const upd = await tx.notification.updateMany({ where: { id: bNotif.id }, data: { title: 'piraté' } });
      expect(upd.count).toBe(0);
      const del = await tx.notification.deleteMany({ where: { id: bNotif.id } });
      expect(del.count).toBe(0);
      expect(await tx.tenant.findUnique({ where: { id: B.tenant } })).toBeNull();
      expect(await tx.user.findUnique({ where: { id: B.user } })).toBeNull();
    });
    const still = await withTenant(db, B.tenant, B.user, (tx) =>
      tx.notification.findUniqueOrThrow({ where: { id: bNotif.id } }),
    );
    expect(still.title).toBe('N1');
  });

  it('impossible d’écrire une ligne pour un autre tenant', async () => {
    await expect(
      withTenant(db, A.tenant, A.user, (tx) =>
        tx.notification.create({ data: { tenantId: B.tenant, userId: B.user, type: 'x', title: 'intrus' } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, A.tenant, A.user, (tx) =>
        emitEvent(tx, {
          tenantId: B.tenant,
          type: 'test.injected.v1',
          aggregateType: 'test',
          aggregateId: '1',
          payload: {},
        }),
      ),
    ).rejects.toThrow();
  });

  it('un utilisateur voit ses propres appartenances, sans voir le contenu des autres tenants', async () => {
    const memberships = await withContext(db, { userId: A.user }, (tx) =>
      tx.membership.findMany({ include: { tenant: true } }),
    );
    expect(memberships.map((m) => m.tenantId)).toEqual([A.tenant]);
    expect(await withContext(db, { userId: A.user }, (tx) => tx.notification.count())).toBe(0);
  });

  it('le journal d’audit est en ajout seul', async () => {
    const id = await withTenant(db, A.tenant, A.user, async (tx) => {
      const row = await tx.auditLog.create({
        data: { tenantId: A.tenant, actorType: 'user', actorId: A.user, action: 'test', entityType: 'test' },
      });
      return row.id;
    });
    await expect(
      withTenant(db, A.tenant, A.user, (tx) =>
        tx.auditLog.update({ where: { id }, data: { action: 'falsifié' } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, A.tenant, A.user, (tx) => tx.auditLog.delete({ where: { id } })),
    ).rejects.toThrow();
  });
});

describe('numérotation légale (05 §2)', () => {
  it('100 émissions concurrentes : aucune lacune, aucun doublon', async () => {
    const values = await Promise.all(
      Array.from({ length: 100 }, () =>
        withTenant(db, A.tenant, A.user, (tx) => nextSequenceValue(tx, A.tenant, 'invoice', 2026), {
          timeoutMs: 60_000,
        }),
      ),
    );
    expect(checkSequenceContinuity(values)).toEqual({ ok: true, gaps: [], duplicates: [] });
  });

  it('une transaction annulée ne consomme pas de numéro', async () => {
    await expect(
      withTenant(db, A.tenant, A.user, async (tx) => {
        await nextSequenceValue(tx, A.tenant, 'credit_note', 2026);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const v = await withTenant(db, A.tenant, A.user, (tx) =>
      nextSequenceValue(tx, A.tenant, 'credit_note', 2026),
    );
    expect(v).toBe(1);
  });

  it('les séquences sont indépendantes par tenant et par année', async () => {
    expect(
      await withTenant(db, B.tenant, B.user, (tx) => nextSequenceValue(tx, B.tenant, 'invoice', 2026)),
    ).toBe(1);
    expect(
      await withTenant(db, A.tenant, A.user, (tx) => nextSequenceValue(tx, A.tenant, 'invoice', 2027)),
    ).toBe(1);
  });
});
