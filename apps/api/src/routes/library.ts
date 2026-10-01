/**
 * Bibliothèque (03 §3) : articles, ouvrages, recherche instantanée, historique des prix,
 * bibliothèques types, import Excel/CSV avec mapping, aperçu et rapport. Fournisseurs (base).
 */
import {
  ImportPreviewSchema,
  ImportReportSchema,
  ImportRequestSchema,
  ItemInputSchema,
  ItemSchema,
  OkSchema,
  parseTenantSettings,
  PriceHistorySchema,
  SupplierInputSchema,
  SupplierSchema,
} from '@batimint/contracts';
import {
  emitEvent,
  installStarterLibraries,
  recomputeAssembliesUsing,
  recomputeAssembly,
  STARTER_LIBRARIES,
  type Tx,
} from '@batimint/db';
import {
  can,
  computeSalePrice,
  type ImportField,
  isValidEnterpriseNumber,
  LibraryError,
  normalizeEnterpriseNumber,
  planImport,
  type Role,
  suggestMapping,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { parseSpreadsheet } from '../lib/spreadsheet';
import { inTenant } from '../lib/tenant';

type ItemRow = Awaited<ReturnType<Tx['item']['findUniqueOrThrow']>> & {
  supplier?: { name: string } | null;
  components?: {
    quantity: { toString(): string };
    item: Awaited<ReturnType<Tx['item']['findUniqueOrThrow']>>;
  }[];
  _count?: { usedIn: number };
};

interface Coefs {
  overheadCoefficient: string;
  marginCoefficient: string;
}

function toItemDto(i: ItemRow, role: Role, coefs: Coefs) {
  const prices = can(role, 'pricing.read');
  return {
    id: i.id,
    code: i.code,
    kind: i.kind,
    name: i.name,
    description: i.description,
    unit: i.unit,
    ...(prices
      ? {
          purchasePrice: Number(i.purchasePrice),
          salePrice: i.salePrice === null ? null : Number(i.salePrice),
          effectiveSalePrice: Number(
            computeSalePrice({
              cost: i.purchasePrice,
              salePrice: i.salePrice,
              itemCoefficient: i.saleCoefficient?.toString() ?? null,
              ...coefs,
            }),
          ),
          saleCoefficient: i.saleCoefficient?.toString() ?? null,
        }
      : {}),
    vatRate: i.vatRate as 'auto',
    laborHours: i.laborHours.toString(),
    trade: i.trade,
    category: i.category,
    supplierId: i.supplierId,
    supplierName: i.supplier?.name ?? null,
    archived: Boolean(i.archivedAt),
    ...(i.components
      ? {
          components: i.components.map((c) => ({
            itemId: c.item.id,
            code: c.item.code,
            name: c.item.name,
            unit: c.item.unit,
            quantity: c.quantity.toString(),
            ...(prices ? { unitCost: Number(c.item.purchasePrice) } : {}),
          })),
        }
      : {}),
    usedInCount: i._count?.usedIn ?? 0,
    updatedAt: i.updatedAt.toISOString(),
  };
}

async function coefsOf(tx: Tx, tenantId: string): Promise<Coefs> {
  const s = parseTenantSettings(
    (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings,
  );
  return { overheadCoefficient: s.overheadCoefficient, marginCoefficient: s.marginCoefficient };
}

/** Recherche floue sur code, désignation, description et catégorie (pg_trgm). */
export async function searchItemIds(tx: Tx, q: string, limit: number, kinds?: string[]): Promise<string[]> {
  const kindFilter = kinds?.length ? kinds : null;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM items
    WHERE archived_at IS NULL
      AND (${kindFilter}::text[] IS NULL OR kind::text = ANY(${kindFilter}::text[]))
      AND (
        lower(code) LIKE lower(${q}) || '%'
        OR rls.search_text(code, name, coalesce(description, ''), coalesce(category, '')) LIKE '%' || rls.search_text(${q}) || '%'
        OR word_similarity(rls.search_text(${q}), rls.search_text(code, name, coalesce(description, ''), coalesce(category, ''))) > 0.4
      )
    ORDER BY (lower(code) = lower(${q})) DESC,
             word_similarity(rls.search_text(${q}), rls.search_text(code, name, coalesce(description, ''), coalesce(category, ''))) DESC,
             name
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export const libraryRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  app.addContentTypeParser(
    [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ],
    { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES },
    (_r, body, done) => done(null, body),
  );

  app.get(
    '/items',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Articles et ouvrages (recherche instantanée)',
        querystring: z.object({
          q: z.string().max(120).optional(),
          kind: z.string().max(100).optional(),
          trade: z.string().max(40).optional(),
          archived: z.stringbool().default(false),
          limit: z.coerce.number().int().min(1).max(500).default(100),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        response: { 200: z.object({ items: z.array(ItemSchema), total: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.read', async ({ tx, auth }) => {
        const { q, kind, trade, archived, limit, offset } = req.query;
        const kinds = kind?.split(',').filter(Boolean);
        const coefs = await coefsOf(tx, auth.tenantId);
        const include = { supplier: { select: { name: true } }, _count: { select: { usedIn: true } } };
        if (q?.trim()) {
          const ids = await searchItemIds(tx, q.trim(), limit, kinds);
          const rows = await tx.item.findMany({
            where: { id: { in: ids }, ...(trade ? { trade } : {}) },
            include,
          });
          const order = new Map(ids.map((id, i) => [id, i]));
          rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
          return { items: rows.map((r) => toItemDto(r, auth.role, coefs)), total: rows.length };
        }
        const where = {
          archivedAt: archived ? { not: null } : null,
          ...(kinds?.length ? { kind: { in: kinds as never[] } } : {}),
          ...(trade ? { trade } : {}),
        };
        const [rows, total] = await Promise.all([
          tx.item.findMany({
            where,
            include,
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
            take: limit,
            skip: offset,
          }),
          tx.item.count({ where }),
        ]);
        return { items: rows.map((r) => toItemDto(r, auth.role, coefs)), total };
      }),
  );

  const loadItem = (tx: Tx, id: string) =>
    tx.item.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        _count: { select: { usedIn: true } },
        components: { orderBy: { position: 'asc' }, include: { item: true } },
      },
    });

  app.get(
    '/items/:id',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Article ou ouvrage, avec historique des prix',
        params: z.object({ id: z.uuid() }),
        response: { 200: z.object({ item: ItemSchema, history: z.array(PriceHistorySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.read', async ({ tx, auth }) => {
        const i = await loadItem(tx, req.params.id);
        if (!i) throw notFound('Cet article');
        const history = can(auth.role, 'pricing.read')
          ? await tx.priceHistory.findMany({
              where: { itemId: i.id },
              orderBy: { changedAt: 'desc' },
              take: 50,
            })
          : [];
        return {
          item: toItemDto(i as ItemRow, auth.role, await coefsOf(tx, auth.tenantId)),
          history: history.map((h) => ({
            purchasePrice: Number(h.purchasePrice),
            salePrice: h.salePrice === null ? null : Number(h.salePrice),
            source: h.source,
            changedAt: h.changedAt.toISOString(),
          })),
        };
      }),
  );

  const saveComponents = async (
    tx: Tx,
    tenantId: string,
    assemblyId: string,
    components: { itemId: string; quantity: string }[],
  ) => {
    await tx.assemblyComponent.deleteMany({ where: { assemblyId } });
    if (components.some((c) => c.itemId === assemblyId))
      throw badRequest('assembly_cycle', 'Un ouvrage ne peut pas se contenir lui-même.');
    const found = await tx.item.findMany({
      where: { id: { in: components.map((c) => c.itemId) } },
      select: { id: true },
    });
    if (found.length !== new Set(components.map((c) => c.itemId)).size)
      throw badRequest('unknown_component', 'Un composant est introuvable.');
    await tx.assemblyComponent.createMany({
      data: components.map((c, position) => ({
        tenantId,
        assemblyId,
        itemId: c.itemId,
        quantity: c.quantity,
        position,
      })),
    });
    try {
      await recomputeAssembly(tx, assemblyId);
    } catch (err) {
      if (err instanceof LibraryError) throw badRequest('invalid_assembly', err.message);
      throw err;
    }
  };

  app.post(
    '/items',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Créer un article ou un ouvrage',
        body: ItemInputSchema,
        response: { 201: ItemSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'library.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        if (
          await tx.item.findUnique({ where: { tenantId_code: { tenantId: auth.tenantId, code: b.code } } })
        ) {
          throw conflict('code_taken', `Le code « ${b.code} » est déjà utilisé.`);
        }
        const item = await tx.item.create({
          data: {
            ...(b.id ? { id: b.id } : {}),
            tenantId: auth.tenantId,
            code: b.code,
            kind: b.kind,
            name: b.name,
            description: b.description ?? null,
            unit: b.unit,
            purchasePrice: BigInt(b.purchasePrice ?? 0),
            salePrice: b.salePrice === undefined || b.salePrice === null ? null : BigInt(b.salePrice),
            saleCoefficient: b.saleCoefficient ?? null,
            vatRate: b.vatRate ?? 'auto',
            laborHours: b.laborHours ?? '0',
            trade: b.trade ?? null,
            category: b.category ?? null,
            supplierId: b.supplierId ?? null,
            supplierCode: b.supplierCode ?? null,
            createdBy: auth.userId,
          },
        });
        if (b.kind === 'assembly') await saveComponents(tx, auth.tenantId, item.id, b.components ?? []);
        const fresh = (await loadItem(tx, item.id))!;
        await tx.priceHistory.create({
          data: {
            tenantId: auth.tenantId,
            itemId: item.id,
            purchasePrice: fresh.purchasePrice,
            salePrice: fresh.salePrice,
            source: 'creation',
            changedBy: auth.userId,
          },
        });
        await audit('item.created', 'item', item.id, { code: item.code });
        return toItemDto(fresh as ItemRow, auth.role, await coefsOf(tx, auth.tenantId));
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/items/:id',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Modifier (les devis existants ne changent pas)',
        params: z.object({ id: z.uuid() }),
        body: ItemInputSchema,
        response: { 200: ItemSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        const before = await tx.item.findUnique({ where: { id: req.params.id } });
        if (!before) throw notFound('Cet article');
        if (
          b.code !== before.code &&
          (await tx.item.findUnique({ where: { tenantId_code: { tenantId: auth.tenantId, code: b.code } } }))
        ) {
          throw conflict('code_taken', `Le code « ${b.code} » est déjà utilisé.`);
        }
        await tx.item.update({
          where: { id: before.id },
          data: {
            code: b.code,
            kind: b.kind,
            name: b.name,
            description: b.description ?? null,
            unit: b.unit,
            ...(b.kind !== 'assembly' && b.purchasePrice !== undefined
              ? { purchasePrice: BigInt(b.purchasePrice) }
              : {}),
            ...(b.salePrice !== undefined
              ? { salePrice: b.salePrice === null ? null : BigInt(b.salePrice) }
              : {}),
            ...(b.saleCoefficient !== undefined ? { saleCoefficient: b.saleCoefficient } : {}),
            vatRate: b.vatRate ?? before.vatRate,
            ...(b.kind !== 'assembly' && b.laborHours !== undefined ? { laborHours: b.laborHours } : {}),
            trade: b.trade ?? null,
            category: b.category ?? null,
            supplierId: b.supplierId ?? null,
            supplierCode: b.supplierCode ?? null,
          },
        });
        if (b.kind === 'assembly' && b.components)
          await saveComponents(tx, auth.tenantId, before.id, b.components);
        const after = (await loadItem(tx, before.id))!;
        if (after.purchasePrice !== before.purchasePrice || after.salePrice !== before.salePrice) {
          await tx.priceHistory.create({
            data: {
              tenantId: auth.tenantId,
              itemId: after.id,
              purchasePrice: after.purchasePrice,
              salePrice: after.salePrice,
              source: 'manual',
              changedBy: auth.userId,
            },
          });
          await recomputeAssembliesUsing(tx, after.id);
        }
        await audit('item.updated', 'item', after.id, { code: after.code });
        return toItemDto(after as ItemRow, auth.role, await coefsOf(tx, auth.tenantId));
      }),
  );

  app.delete(
    '/items/:id',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Archiver un article',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.write', async ({ tx, audit }) => {
        const res = await tx.item.updateMany({
          where: { id: req.params.id, archivedAt: null },
          data: { archivedAt: new Date() },
        });
        if (!res.count) throw notFound('Cet article');
        await audit('item.archived', 'item', req.params.id);
        return { ok: true as const };
      }),
  );

  app.post(
    '/items/:id/restore',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Restaurer un article archivé',
        params: z.object({ id: z.uuid() }),
        response: { 200: OkSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.write', async ({ tx }) => {
        const res = await tx.item.updateMany({ where: { id: req.params.id }, data: { archivedAt: null } });
        if (!res.count) throw notFound('Cet article');
        return { ok: true as const };
      }),
  );

  // --- Bibliothèques types ---
  app.get(
    '/library/starters',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Bibliothèques types disponibles',
        response: {
          200: z.object({
            items: z.array(
              z.object({
                trade: z.string(),
                label: z.string(),
                description: z.string(),
                itemCount: z.number().int(),
              }),
            ),
          }),
        },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.read', async () => ({
        items: STARTER_LIBRARIES.map((l) => ({
          trade: l.trade,
          label: l.label,
          description: l.description,
          itemCount: l.items.length + l.assemblies.length,
        })),
      })),
  );

  app.post(
    '/library/starters',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Installer des bibliothèques types',
        body: z.object({ trades: z.array(z.enum(['general', 'roofing', 'electrical', 'plumbing'])).min(1) }),
        response: { 200: z.object({ created: z.number().int(), skipped: z.number().int() }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.write', async ({ tx, auth, actor, audit }) => {
        const r = await installStarterLibraries(tx, auth.tenantId, req.body.trades, auth.userId);
        await audit('library.starter_installed', 'library', null, { trades: req.body.trades, ...r });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'library.imported.v1',
          aggregateType: 'library',
          aggregateId: auth.tenantId,
          payload: { created: r.created, updated: 0 },
          actor,
        });
        return r;
      }),
  );

  // --- Import Excel / CSV ---
  app.post(
    '/library/import/preview',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Analyser un fichier Excel ou CSV (en-têtes, aperçu, mapping proposé)',
        consumes: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        response: { 200: ImportPreviewSchema },
      },
    },
    async (req) => {
      const body = req.body as Buffer | undefined;
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
      const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'import'));
      if (!Buffer.isBuffer(body) || !body.length) throw badRequest('empty_file', 'Le fichier est vide.');
      const ext: 'csv' | 'xlsx' =
        type.includes('spreadsheetml') || type === 'application/vnd.ms-excel' || /\.xlsx$/i.test(fileName)
          ? 'xlsx'
          : 'csv';
      return inTenant(deps, req, 'library.write', async ({ auth }) => {
        const rows = await parseSpreadsheet(body, ext);
        if (rows.length < 2)
          throw badRequest(
            'no_rows',
            'Aucune ligne de données trouvée. La première ligne doit contenir les titres de colonnes.',
          );
        const fileId = `${uuidv7()}.${ext}`;
        await deps.integrations.storage.put({
          bucket: 'uploads',
          key: `imports/${auth.tenantId}/${fileId}`,
          body,
          contentType: type || 'text/csv',
        });
        const headers = rows[0]!.map((h, i) => h || `Colonne ${i + 1}`);
        return {
          fileId,
          fileName,
          headers,
          sampleRows: rows.slice(1, 11).map((r) => headers.map((_, i) => r[i] ?? '')),
          totalRows: rows.length - 1,
          suggestedMapping: suggestMapping(headers) as Record<string, number>,
        };
      });
    },
  );

  app.post(
    '/library/import',
    {
      schema: {
        tags: ['bibliothèque'],
        summary: 'Importer (ou simuler) avec rapport d’erreurs ; mise à jour par code',
        body: ImportRequestSchema,
        response: { 200: ImportReportSchema },
      },
    },
    async (req) => {
      const started = Date.now();
      return inTenant(
        deps,
        req,
        'library.write',
        async ({ tx, auth, actor, audit }) => {
          let buffer: Uint8Array;
          try {
            buffer = await deps.integrations.storage.get(
              'uploads',
              `imports/${auth.tenantId}/${req.body.fileId}`,
            );
          } catch {
            throw badRequest('import_expired', 'Le fichier analysé est introuvable : envoyez-le à nouveau.');
          }
          const rows = await parseSpreadsheet(
            Buffer.from(buffer),
            req.body.fileId.endsWith('.xlsx') ? 'xlsx' : 'csv',
          );
          const existingRows = await tx.item.findMany({
            select: { id: true, code: true, purchasePrice: true, salePrice: true, name: true, unit: true },
          });
          const existing = new Map(existingRows.map((r) => [r.code, r]));
          const plan = planImport(
            rows.slice(1),
            req.body.mapping as Partial<Record<ImportField, number>>,
            existing,
          );
          const report = {
            dryRun: req.body.dryRun,
            created: plan.toCreate.length,
            updated: plan.toUpdate.length,
            unchanged: plan.unchanged.length,
            errors: [...plan.errors, ...plan.duplicates].sort((a, b) => a.row - b.row).slice(0, 500),
            durationMs: 0,
          };
          if (!req.body.dryRun && (plan.toCreate.length || plan.toUpdate.length)) {
            const trade = req.body.trade ?? null;
            for (let i = 0; i < plan.toCreate.length; i += 1000) {
              const chunk = plan.toCreate.slice(i, i + 1000).map((r) => ({
                id: uuidv7(),
                tenantId: auth.tenantId,
                code: r.code,
                name: r.name,
                description: r.description,
                unit: r.unit,
                kind: r.kind,
                purchasePrice: r.purchasePrice,
                salePrice: r.salePrice,
                laborHours: r.laborHours,
                vatRate: r.vatRate,
                trade: r.trade ?? trade,
                category: r.category,
                supplierCode: r.supplierCode,
                createdBy: auth.userId,
              }));
              await tx.item.createMany({ data: chunk });
              await tx.priceHistory.createMany({
                data: chunk.map((c) => ({
                  tenantId: auth.tenantId,
                  itemId: c.id,
                  purchasePrice: c.purchasePrice,
                  salePrice: c.salePrice,
                  source: 'import',
                  changedBy: auth.userId,
                })),
              });
            }
            for (const r of plan.toUpdate) {
              const current = existing.get(r.code)!;
              await tx.item.update({
                where: { id: current.id },
                data: {
                  name: r.name,
                  unit: r.unit,
                  purchasePrice: r.purchasePrice,
                  ...(r.salePrice !== null ? { salePrice: r.salePrice } : {}),
                  description: r.description ?? undefined,
                  category: r.category ?? undefined,
                  laborHours: r.laborHours,
                  archivedAt: null,
                },
              });
              if (
                current.purchasePrice !== r.purchasePrice ||
                (r.salePrice !== null && r.salePrice !== current.salePrice)
              ) {
                await tx.priceHistory.create({
                  data: {
                    tenantId: auth.tenantId,
                    itemId: current.id,
                    purchasePrice: r.purchasePrice,
                    salePrice: r.salePrice,
                    source: 'import',
                    changedBy: auth.userId,
                  },
                });
                await recomputeAssembliesUsing(tx, current.id);
              }
            }
            await audit('library.imported', 'library', null, {
              created: report.created,
              updated: report.updated,
              errors: report.errors.length,
            });
            await emitEvent(tx, {
              tenantId: auth.tenantId,
              type: 'library.imported.v1',
              aggregateType: 'library',
              aggregateId: auth.tenantId,
              payload: { created: report.created, updated: report.updated },
              actor,
            });
          }
          report.durationMs = Date.now() - started;
          return report;
        },
        { timeoutMs: 120_000 },
      );
    },
  );

  // --- Fournisseurs ---
  type SupplierRow = Awaited<ReturnType<Tx['supplier']['findUniqueOrThrow']>>;
  const toSupplierDto = (s: SupplierRow) => ({
    id: s.id,
    name: s.name,
    enterpriseNumber: s.enterpriseNumber,
    vatNumber: s.vatNumber,
    email: s.email,
    orderEmail: s.orderEmail,
    phone: s.phone,
    city: s.city,
    paymentTermsDays: s.paymentTermsDays,
    isSubcontractor: s.isSubcontractor,
  });
  const supplierData = (b: z.infer<typeof SupplierInputSchema>) => {
    const data: Record<string, unknown> = { ...b };
    if (b.enterpriseNumber) {
      const n = normalizeEnterpriseNumber(b.enterpriseNumber);
      if (!n || !isValidEnterpriseNumber(n))
        throw badRequest('invalid_enterprise_number', "Ce numéro d'entreprise n'est pas valide.");
      data['enterpriseNumber'] = n;
      data['vatNumber'] = `BE${n}`;
      data['peppolId'] = `0208:${n}`;
    }
    return data;
  };

  app.get(
    '/suppliers',
    {
      schema: {
        tags: ['achats'],
        summary: 'Fournisseurs',
        querystring: z.object({ q: z.string().max(100).optional() }),
        response: { 200: z.object({ items: z.array(SupplierSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'library.read', async ({ tx }) => ({
        items: (
          await tx.supplier.findMany({
            where: {
              archivedAt: null,
              ...(req.query.q ? { name: { contains: req.query.q, mode: 'insensitive' as const } } : {}),
            },
            orderBy: { name: 'asc' },
            take: 200,
          })
        ).map(toSupplierDto),
      })),
  );

  app.post(
    '/suppliers',
    {
      schema: {
        tags: ['achats'],
        summary: 'Créer un fournisseur',
        body: SupplierInputSchema,
        response: { 201: SupplierSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'purchases.write', async ({ tx, auth, audit }) => {
        const s = await tx.supplier.create({
          data: {
            ...(supplierData(req.body) as object),
            tenantId: auth.tenantId,
            createdBy: auth.userId,
          } as never,
        });
        await audit('supplier.created', 'supplier', s.id, { name: s.name });
        return toSupplierDto(s);
      });
      return reply.status(201).send(dto);
    },
  );

  app.put(
    '/suppliers/:id',
    {
      schema: {
        tags: ['achats'],
        summary: 'Modifier un fournisseur',
        params: z.object({ id: z.uuid() }),
        body: SupplierInputSchema,
        response: { 200: SupplierSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'purchases.write', async ({ tx }) => {
        if (!(await tx.supplier.findUnique({ where: { id: req.params.id } })))
          throw notFound('Ce fournisseur');
        return toSupplierDto(
          await tx.supplier.update({ where: { id: req.params.id }, data: supplierData(req.body) }),
        );
      }),
  );
};
