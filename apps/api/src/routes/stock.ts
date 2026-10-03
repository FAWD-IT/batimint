/**
 * Stock et matériel (03 §11, 02 P13) : emplacements (dépôt, camionnettes), niveaux et seuils,
 * mouvements au coût moyen pondéré (sortie imputée au chantier), réapprovisionnement en bon de
 * commande, matériel affecté aux chantiers (coût d'usage journalier), entretiens et contrôles.
 */
import {
  AssignmentInputSchema,
  EquipmentInputSchema,
  EquipmentSchema,
  EquipmentSummarySchema,
  MaintenanceDoneSchema,
  MaintenanceInputSchema,
  ReorderOrderInputSchema,
  ReorderProposalSchema,
  StockItemSchema,
  StockLevelInputSchema,
  StockLocationInputSchema,
  StockLocationSchema,
  StockMovementInputSchema,
  StockMovementSchema,
} from '@batimint/contracts';
import { emitEvent, recordStockMovement, type Tx } from '@batimint/db';
import {
  brusselsDate,
  can,
  dec,
  equipmentUsageCost,
  equipmentUsageDays,
  isBelowThreshold,
  lineTotal,
  maintenanceStatus,
  multiplyCents,
  nextMaintenanceDue,
  reorderNeeds,
  StockError,
  sumCents,
} from '@batimint/domain';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../context';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../lib/errors';
import { inTenant, isoDate, type TenantScope } from '../lib/tenant';

const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function locationDtos(tx: Tx, where: { id?: string } = {}) {
  const locations = await tx.stockLocation.findMany({
    where: { ...where, archivedAt: null },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  });
  const levels = await tx.stockLevel.findMany({ where: { locationId: { in: locations.map((l) => l.id) } } });
  const items = new Map(
    (
      await tx.item.findMany({
        where: { id: { in: [...new Set(levels.map((l) => l.itemId))] } },
        select: { id: true, stockAverageCost: true },
      })
    ).map((i) => [i.id, i.stockAverageCost]),
  );
  const employees = new Map(
    (
      await tx.employee.findMany({
        where: { id: { in: locations.flatMap((l) => (l.employeeId ? [l.employeeId] : [])) } },
        select: { id: true, firstName: true, lastName: true },
      })
    ).map((e) => [e.id, `${e.firstName} ${e.lastName}`]),
  );
  return locations.map((l) => {
    const mine = levels.filter((x) => x.locationId === l.id);
    return {
      id: l.id,
      name: l.name,
      kind: l.kind as 'depot' | 'van',
      address: l.address,
      employee: l.employeeId ? { id: l.employeeId, name: employees.get(l.employeeId) ?? '—' } : null,
      itemCount: mine.filter((x) => dec(x.quantity.toString()).gt(0)).length,
      value: Number(
        sumCents(mine.map((x) => multiplyCents(items.get(x.itemId) ?? 0n, x.quantity.toString()))),
      ),
      lowCount: mine.filter((x) => isBelowThreshold(x.quantity.toString(), x.minQuantity?.toString() ?? null))
        .length,
    };
  });
}

type MovementRow = Awaited<ReturnType<Tx['stockMovement']['findUniqueOrThrow']>>;

async function movementDtos(tx: Tx, rows: MovementRow[]) {
  const items = new Map(
    (
      await tx.item.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.itemId))] } },
        select: { id: true, code: true, name: true, unit: true },
      })
    ).map((i) => [i.id, i]),
  );
  const locations = new Map(
    (
      await tx.stockLocation.findMany({
        where: {
          id: { in: [...new Set(rows.flatMap((r) => [r.locationId, r.toLocationId ?? r.locationId]))] },
        },
        select: { id: true, name: true },
      })
    ).map((l) => [l.id, l]),
  );
  const projects = new Map(
    (
      await tx.project.findMany({
        where: { id: { in: rows.flatMap((r) => (r.projectId ? [r.projectId] : [])) } },
        select: { id: true, number: true, name: true },
      })
    ).map((p) => [p.id, p]),
  );
  const users = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    item: items.get(r.itemId) ?? { id: r.itemId, code: '', name: '—', unit: '' },
    quantity: r.quantity.toString(),
    unitCost: Number(r.unitCost),
    totalCost: Number(r.totalCost),
    location: locations.get(r.locationId) ?? { id: r.locationId, name: '—' },
    toLocation: r.toLocationId ? (locations.get(r.toLocationId) ?? null) : null,
    project: r.projectId ? (projects.get(r.projectId) ?? null) : null,
    note: r.note,
    occurredAt: r.occurredAt.toISOString(),
    by: r.createdBy ? (users.get(r.createdBy) ?? null) : null,
  }));
}

type AssignmentRow = Awaited<ReturnType<Tx['equipmentAssignment']['findUniqueOrThrow']>> & {
  project: { id: string; number: string; name: string };
};

function assignmentDto(a: AssignmentRow, posts: Map<string, string>, today: string) {
  const days = equipmentUsageDays(isoDate(a.startDate)!, isoDate(a.endDate), today);
  return {
    id: a.id,
    project: a.project,
    budgetLine: a.budgetLineId ? { id: a.budgetLineId, label: posts.get(a.budgetLineId) ?? '—' } : null,
    startDate: isoDate(a.startDate)!,
    endDate: isoDate(a.endDate),
    dailyCost: Number(a.dailyCost),
    days,
    cost: Number(equipmentUsageCost(a.dailyCost, days)),
  };
}

type MaintenanceRow = Awaited<ReturnType<Tx['maintenanceEvent']['findUniqueOrThrow']>>;

function maintenanceDto(m: MaintenanceRow, today: string) {
  const dueOn = isoDate(m.dueOn)!;
  return {
    id: m.id,
    kind: m.kind as 'maintenance' | 'inspection',
    label: m.label,
    dueOn,
    doneOn: isoDate(m.doneOn),
    intervalMonths: m.intervalMonths,
    cost: m.cost === null ? null : Number(m.cost),
    notes: m.notes,
    status: m.doneOn ? null : maintenanceStatus(dueOn, today),
  };
}

async function equipmentDtos(tx: Tx, where: { id?: string }, detailed: boolean) {
  const today = brusselsDate(new Date());
  const rows = await tx.equipment.findMany({
    where: { ...where, archivedAt: null },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
    include: {
      assignments: {
        include: { project: { select: { id: true, number: true, name: true } } },
        orderBy: { startDate: 'desc' },
      },
      maintenance: { orderBy: { dueOn: 'asc' } },
    },
  });
  const posts = new Map(
    (
      await tx.budgetLine.findMany({
        where: {
          id: {
            in: rows.flatMap((e) => e.assignments.flatMap((a) => (a.budgetLineId ? [a.budgetLineId] : []))),
          },
        },
        select: { id: true, label: true },
      })
    ).map((b) => [b.id, b.label]),
  );
  return rows.map((e) => {
    const current = e.assignments.find((a) => !a.endDate || isoDate(a.endDate)! >= today) ?? null;
    const next = e.maintenance.find((m) => !m.doneOn) ?? null;
    const base = {
      id: e.id,
      code: e.code,
      name: e.name,
      category: e.category,
      serialNumber: e.serialNumber,
      dailyCost: Number(e.dailyCost),
      purchasedOn: isoDate(e.purchasedOn),
      notes: e.notes,
      current: current ? assignmentDto(current, posts, today) : null,
      nextMaintenance: next ? maintenanceDto(next, today) : null,
    };
    return detailed
      ? {
          ...base,
          assignments: e.assignments.map((a) => assignmentDto(a, posts, today)),
          maintenance: [...e.maintenance].reverse().map((m) => maintenanceDto(m, today)),
        }
      : base;
  });
}

function stockError(err: unknown): never {
  if (err instanceof StockError) throw unprocessable(err.code, err.message);
  throw err;
}

/**
 * Mouvement de stock (bureau ou terrain hors ligne) : contrôles, mouvement au CMP, audit.
 * Un renvoi du même identifiant renvoie le mouvement déjà enregistré.
 */
export async function createStockMovement(
  { tx, auth, actor, audit }: TenantScope,
  b: z.infer<typeof StockMovementInputSchema>,
) {
  if (!can(auth.role, 'stock.write')) throw forbidden();
  const existing = await tx.stockMovement.findUnique({ where: { id: b.id } });
  if (existing) return existing;
  if (!(await tx.stockLocation.findFirst({ where: { id: b.locationId, archivedAt: null } })))
    throw notFound('Cet emplacement');
  if (
    b.toLocationId &&
    !(await tx.stockLocation.findFirst({ where: { id: b.toLocationId, archivedAt: null } }))
  )
    throw notFound('Cet emplacement de destination');
  const item = await tx.item.findUnique({ where: { id: b.itemId } });
  if (!item) throw notFound('Cet article');
  if (b.kind === 'out') {
    const p = await tx.project.findUnique({ where: { id: b.projectId! } });
    if (!p) throw notFound('Ce chantier');
    if (['closed'].includes(p.status))
      throw conflict('project_closed', 'Ce chantier est clôturé : on n’y impute plus de coût.');
    if (
      b.budgetLineId &&
      !(await tx.budgetLine.findFirst({ where: { id: b.budgetLineId, projectId: p.id } }))
    )
      throw badRequest('invalid_budget_line', 'Ce poste ne fait pas partie du chantier.');
  }
  const m = await recordStockMovement(tx, {
    id: b.id,
    tenantId: auth.tenantId,
    kind: b.kind,
    itemId: b.itemId,
    locationId: b.locationId,
    quantity: b.quantity,
    unitCost: b.unitCost === undefined || b.unitCost === null ? null : BigInt(b.unitCost),
    toLocationId: b.toLocationId ?? null,
    projectId: b.projectId ?? null,
    budgetLineId: b.budgetLineId ?? null,
    note: b.note ?? null,
    userId: auth.userId,
    actor,
  }).catch(stockError);
  await audit(`stock.${b.kind}`, 'item', b.itemId, {
    movementId: m.id,
    quantity: m.quantity.toString(),
    totalCost: m.totalCost.toString(),
    projectId: m.projectId,
  });
  return m;
}

export const stockRoutes: FastifyPluginAsyncZod<{ deps: AppDeps }> = async (app, { deps }) => {
  // -------------------------------------------------------------------------
  // Emplacements et niveaux
  // -------------------------------------------------------------------------
  app.get(
    '/stock/locations',
    {
      schema: {
        tags: ['stock'],
        summary: 'Emplacements : dépôt et camionnettes, valeur et articles sous le seuil',
        response: { 200: z.object({ items: z.array(StockLocationSchema) }) },
      },
    },
    (req) => inTenant(deps, req, 'stock.read', async ({ tx }) => ({ items: await locationDtos(tx) })),
  );

  app.post(
    '/stock/locations',
    {
      schema: {
        tags: ['stock'],
        summary: 'Créer un emplacement',
        body: StockLocationInputSchema,
        response: { 201: StockLocationSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'stock.write', async ({ tx, auth, audit }) => {
        const l = await tx.stockLocation.create({
          data: {
            tenantId: auth.tenantId,
            name: req.body.name,
            kind: req.body.kind,
            address: req.body.address ?? null,
            employeeId: req.body.employeeId ?? null,
          },
        });
        await audit('stock_location.created', 'stock_location', l.id, req.body);
        return (await locationDtos(tx, { id: l.id }))[0]!;
      });
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/stock',
    {
      schema: {
        tags: ['stock'],
        summary: 'Articles en stock par emplacement (quantités, coût moyen, valeur, seuils)',
        querystring: z.object({
          locationId: z.uuid().optional(),
          q: z.string().trim().max(100).optional(),
          low: z.stringbool().optional(),
        }),
        response: { 200: z.object({ items: z.array(StockItemSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'stock.read', async ({ tx }) => {
        const levels = await tx.stockLevel.findMany({
          where: req.query.locationId ? { locationId: req.query.locationId } : {},
        });
        const term = req.query.q;
        const items = await tx.item.findMany({
          where: {
            id: { in: [...new Set(levels.map((l) => l.itemId))] },
            ...(term
              ? {
                  OR: [
                    { name: { contains: term, mode: 'insensitive' } },
                    { code: { contains: term, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true, unit: true, stockAverageCost: true },
        });
        const out = items.map((i) => {
          const mine = levels.filter((l) => l.itemId === i.id);
          const quantity = mine.reduce((s, l) => s.plus(l.quantity.toString()), dec(0));
          return {
            item: { id: i.id, code: i.code, name: i.name, unit: i.unit },
            averageCost: Number(i.stockAverageCost),
            quantity: quantity.toString(),
            value: Number(multiplyCents(i.stockAverageCost, quantity)),
            levels: mine.map((l) => ({
              locationId: l.locationId,
              quantity: l.quantity.toString(),
              minQuantity: l.minQuantity?.toString() ?? null,
              reorderQuantity: l.reorderQuantity?.toString() ?? null,
              below: isBelowThreshold(l.quantity.toString(), l.minQuantity?.toString() ?? null),
            })),
          };
        });
        return { items: req.query.low ? out.filter((i) => i.levels.some((l) => l.below)) : out };
      }),
  );

  app.put(
    '/stock/levels',
    {
      schema: {
        tags: ['stock'],
        summary: 'Seuil d’alerte et quantité de réapprovisionnement d’un article dans un emplacement',
        body: StockLevelInputSchema,
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'stock.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        if (!(await tx.stockLocation.findUnique({ where: { id: b.locationId } })))
          throw notFound('Cet emplacement');
        if (!(await tx.item.findUnique({ where: { id: b.itemId } }))) throw notFound('Cet article');
        await tx.stockLevel.upsert({
          where: { locationId_itemId: { locationId: b.locationId, itemId: b.itemId } },
          create: {
            tenantId: auth.tenantId,
            locationId: b.locationId,
            itemId: b.itemId,
            minQuantity: b.minQuantity,
            reorderQuantity: b.reorderQuantity,
          },
          update: { minQuantity: b.minQuantity, reorderQuantity: b.reorderQuantity, alertedAt: null },
        });
        await audit('stock_level.threshold', 'item', b.itemId, b);
        return { ok: true as const };
      }),
  );

  // -------------------------------------------------------------------------
  // Mouvements
  // -------------------------------------------------------------------------
  app.post(
    '/stock/movements',
    {
      schema: {
        tags: ['stock'],
        summary: 'Entrée, sortie vers un chantier, transfert ou inventaire (identifiant client)',
        body: StockMovementInputSchema,
        response: { 201: StockMovementSchema },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'stock.write', async (scope) => {
        const m = await createStockMovement(scope, req.body);
        const { tx } = scope;
        return (await movementDtos(tx, [m]))[0]!;
      });
      return reply.status(201).send(dto);
    },
  );

  app.get(
    '/stock/movements',
    {
      schema: {
        tags: ['stock'],
        summary: 'Historique des mouvements (article, emplacement, chantier)',
        querystring: z.object({
          itemId: z.uuid().optional(),
          locationId: z.uuid().optional(),
          projectId: z.uuid().optional(),
        }),
        response: { 200: z.object({ items: z.array(StockMovementSchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'stock.read', async ({ tx }) => {
        const q = req.query;
        const rows = await tx.stockMovement.findMany({
          where: {
            ...(q.itemId ? { itemId: q.itemId } : {}),
            ...(q.projectId ? { projectId: q.projectId } : {}),
            ...(q.locationId ? { OR: [{ locationId: q.locationId }, { toLocationId: q.locationId }] } : {}),
          },
          orderBy: { occurredAt: 'desc' },
          take: 200,
        });
        return { items: await movementDtos(tx, rows) };
      }),
  );

  // -------------------------------------------------------------------------
  // Réapprovisionnement
  // -------------------------------------------------------------------------
  app.get(
    '/stock/reorder',
    {
      schema: {
        tags: ['stock'],
        summary: 'Articles sous le seuil, groupés par fournisseur et emplacement',
        response: { 200: ReorderProposalSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'stock.read', async ({ tx }) => {
        const levels = await tx.stockLevel.findMany({ where: { minQuantity: { not: null } } });
        const needs = reorderNeeds(
          levels.map((l) => ({
            itemId: l.itemId,
            locationId: l.locationId,
            quantity: l.quantity.toString(),
            minQuantity: l.minQuantity?.toString() ?? null,
            reorderQuantity: l.reorderQuantity?.toString() ?? null,
          })),
        );
        const items = new Map(
          (
            await tx.item.findMany({
              where: { id: { in: needs.map((n) => n.itemId) } },
              include: { supplier: { select: { id: true, name: true } } },
            })
          ).map((i) => [i.id, i]),
        );
        const locations = new Map(
          (await tx.stockLocation.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l]),
        );
        const groups = new Map<
          string,
          {
            supplier: { id: string; name: string } | null;
            location: { id: string; name: string };
            lines: {
              itemId: string;
              code: string;
              name: string;
              unit: string;
              quantity: string;
              stock: string;
              minQuantity: string;
              unitPrice: number;
            }[];
          }
        >();
        for (const n of needs) {
          const item = items.get(n.itemId);
          const level = levels.find((l) => l.itemId === n.itemId && l.locationId === n.locationId)!;
          if (!item) continue;
          const key = `${item.supplierId ?? 'none'}:${n.locationId}`;
          const g = groups.get(key) ?? {
            supplier: item.supplier ?? null,
            location: locations.get(n.locationId)!,
            lines: [],
          };
          g.lines.push({
            itemId: item.id,
            code: item.code,
            name: item.name,
            unit: item.unit,
            quantity: n.quantity.toString(),
            stock: level.quantity.toString(),
            minQuantity: level.minQuantity!.toString(),
            unitPrice: Number(item.purchasePrice),
          });
          groups.set(key, g);
        }
        return {
          groups: [...groups.values()].map((g) => ({
            ...g,
            total: Number(sumCents(g.lines.map((l) => lineTotal(l.quantity, BigInt(l.unitPrice))))),
          })),
        };
      }),
  );

  app.post(
    '/stock/reorder',
    {
      schema: {
        tags: ['stock'],
        summary: 'Préparer le bon de commande de réapprovisionnement (brouillon, livré au dépôt)',
        body: ReorderOrderInputSchema,
        response: { 201: z.object({ purchaseOrderId: z.uuid() }) },
      },
    },
    async (req, reply) => {
      const dto = await inTenant(deps, req, 'purchases.write', async ({ tx, auth, audit }) => {
        const b = req.body;
        const existing = await tx.purchaseOrder.findUnique({ where: { id: b.id } });
        if (existing) return { purchaseOrderId: existing.id };
        const location = await tx.stockLocation.findUnique({ where: { id: b.locationId } });
        if (!location) throw notFound('Cet emplacement');
        if (!(await tx.supplier.findFirst({ where: { id: b.supplierId, archivedAt: null } })))
          throw notFound('Ce fournisseur');
        const items = new Map(
          (await tx.item.findMany({ where: { id: { in: b.lines.map((l) => l.itemId) } } })).map((i) => [
            i.id,
            i,
          ]),
        );
        if (items.size !== new Set(b.lines.map((l) => l.itemId)).size) throw notFound('Un article');
        const total = sumCents(b.lines.map((l) => lineTotal(l.quantity, BigInt(l.unitPrice))));
        await tx.purchaseOrder.create({
          data: {
            id: b.id,
            tenantId: auth.tenantId,
            projectId: null,
            stockLocationId: location.id,
            supplierId: b.supplierId,
            deliveryAddress: location.address,
            totalNet: total,
            createdBy: auth.userId,
            lines: {
              create: b.lines.map((l, position) => {
                const item = items.get(l.itemId)!;
                return {
                  tenantId: auth.tenantId,
                  position,
                  description: item.name,
                  supplierCode: null,
                  unit: item.unit,
                  quantity: l.quantity,
                  unitPrice: BigInt(l.unitPrice),
                  itemId: item.id,
                };
              }),
            },
          },
        });
        await audit('purchase_order.created', 'purchase_order', b.id, {
          total: total.toString(),
          stockLocationId: location.id,
        });
        return { purchaseOrderId: b.id };
      });
      return reply.status(201).send(dto);
    },
  );

  // -------------------------------------------------------------------------
  // Matériel
  // -------------------------------------------------------------------------
  app.get(
    '/equipment',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Matériel : affectation en cours, prochain entretien',
        querystring: z.object({ projectId: z.uuid().optional() }),
        response: { 200: z.object({ items: z.array(EquipmentSummarySchema) }) },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.read', async ({ tx }) => {
        const all = await equipmentDtos(tx, {}, false);
        return {
          items: req.query.projectId ? all.filter((e) => e.current?.project.id === req.query.projectId) : all,
        };
      }),
  );

  app.get(
    '/equipment/:id',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Fiche matériel : affectations, coût d’usage, entretiens',
        params: z.object({ id: z.uuid() }),
        response: { 200: EquipmentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.read', async ({ tx }) => {
        const [e] = await equipmentDtos(tx, { id: req.params.id }, true);
        if (!e) throw notFound('Ce matériel');
        return e as z.infer<typeof EquipmentSchema>;
      }),
  );

  app.put(
    '/equipment/:id',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Créer ou modifier un matériel (identifiant client)',
        params: z.object({ id: z.uuid() }),
        body: EquipmentInputSchema,
        response: { 200: EquipmentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.write', async ({ tx, auth, audit }) => {
        if (req.body.id !== req.params.id) throw badRequest('id_mismatch', 'Identifiant incohérent.');
        const b = req.body;
        const data = {
          code: b.code ?? null,
          name: b.name,
          category: b.category ?? null,
          serialNumber: b.serialNumber ?? null,
          dailyCost: BigInt(b.dailyCost),
          purchasedOn: b.purchasedOn ? day(b.purchasedOn) : null,
          notes: b.notes ?? null,
        };
        const existing = await tx.equipment.findUnique({ where: { id: b.id } });
        if (existing) await tx.equipment.update({ where: { id: b.id }, data });
        else
          await tx.equipment.create({
            data: { id: b.id, tenantId: auth.tenantId, createdBy: auth.userId, ...data },
          });
        await audit(existing ? 'equipment.updated' : 'equipment.created', 'equipment', b.id, {
          dailyCost: String(b.dailyCost),
        });
        const [e] = await equipmentDtos(tx, { id: b.id }, true);
        return e as z.infer<typeof EquipmentSchema>;
      }),
  );

  app.post(
    '/equipment/:id/assignments',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Affecter le matériel à un chantier (coût d’usage journalier imputé au poste)',
        params: z.object({ id: z.uuid() }),
        body: AssignmentInputSchema,
        response: { 200: EquipmentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.write', async ({ tx, auth, actor, audit }) => {
        const e = await tx.equipment.findUnique({ where: { id: req.params.id } });
        if (!e) throw notFound('Ce matériel');
        const b = req.body;
        if (!(await tx.equipmentAssignment.findUnique({ where: { id: b.id } }))) {
          const p = await tx.project.findUnique({ where: { id: b.projectId } });
          if (!p) throw notFound('Ce chantier');
          if (
            b.budgetLineId &&
            !(await tx.budgetLine.findFirst({ where: { id: b.budgetLineId, projectId: p.id } }))
          )
            throw badRequest('invalid_budget_line', 'Ce poste ne fait pas partie du chantier.');
          if (b.endDate && b.endDate < b.startDate)
            throw badRequest('invalid_dates', 'Le retour précède l’affectation.');
          const overlap = await tx.equipmentAssignment.findFirst({
            where: {
              equipmentId: e.id,
              startDate: { lte: b.endDate ? day(b.endDate) : day('9999-12-31') },
              OR: [{ endDate: null }, { endDate: { gte: day(b.startDate) } }],
            },
            include: { project: { select: { name: true } } },
          });
          if (overlap)
            throw conflict(
              'equipment_busy',
              `Ce matériel est déjà affecté à « ${overlap.project.name} » sur cette période : rendez-le d’abord.`,
            );
          await tx.equipmentAssignment.create({
            data: {
              id: b.id,
              tenantId: auth.tenantId,
              equipmentId: e.id,
              projectId: p.id,
              budgetLineId: b.budgetLineId ?? null,
              startDate: day(b.startDate),
              endDate: b.endDate ? day(b.endDate) : null,
              dailyCost: e.dailyCost,
              createdBy: auth.userId,
            },
          });
          await audit('equipment.assigned', 'equipment', e.id, { assignmentId: b.id, projectId: p.id });
          await emitEvent(tx, {
            tenantId: auth.tenantId,
            type: 'equipment.assignment_changed.v1',
            aggregateType: 'project',
            aggregateId: p.id,
            payload: { assignmentId: b.id, projectId: p.id, action: 'assigned' },
            actor,
          });
        }
        const [dto] = await equipmentDtos(tx, { id: e.id }, true);
        return dto as z.infer<typeof EquipmentSchema>;
      }),
  );

  app.post(
    '/equipment-assignments/:id/return',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Retour du matériel : fin de l’affectation (coût d’usage arrêté)',
        params: z.object({ id: z.uuid() }),
        body: z.object({ endDate: z.iso.date() }),
        response: { 200: EquipmentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.write', async ({ tx, auth, actor, audit }) => {
        const a = await tx.equipmentAssignment.findUnique({ where: { id: req.params.id } });
        if (!a) throw notFound('Cette affectation');
        if (req.body.endDate < isoDate(a.startDate)!)
          throw badRequest('invalid_dates', 'Le retour précède l’affectation.');
        await tx.equipmentAssignment.update({
          where: { id: a.id },
          data: { endDate: day(req.body.endDate) },
        });
        await audit('equipment.returned', 'equipment', a.equipmentId, {
          assignmentId: a.id,
          endDate: req.body.endDate,
        });
        await emitEvent(tx, {
          tenantId: auth.tenantId,
          type: 'equipment.assignment_changed.v1',
          aggregateType: 'project',
          aggregateId: a.projectId,
          payload: { assignmentId: a.id, projectId: a.projectId, action: 'returned' },
          actor,
        });
        const [dto] = await equipmentDtos(tx, { id: a.equipmentId }, true);
        return dto as z.infer<typeof EquipmentSchema>;
      }),
  );

  app.post(
    '/equipment/:id/maintenance',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Planifier un entretien ou un contrôle à échéance',
        params: z.object({ id: z.uuid() }),
        body: MaintenanceInputSchema,
        response: { 200: EquipmentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.write', async ({ tx, auth, audit }) => {
        const e = await tx.equipment.findUnique({ where: { id: req.params.id } });
        if (!e) throw notFound('Ce matériel');
        const b = req.body;
        if (!(await tx.maintenanceEvent.findUnique({ where: { id: b.id } }))) {
          await tx.maintenanceEvent.create({
            data: {
              id: b.id,
              tenantId: auth.tenantId,
              equipmentId: e.id,
              kind: b.kind,
              label: b.label,
              dueOn: day(b.dueOn),
              intervalMonths: b.intervalMonths ?? null,
              createdBy: auth.userId,
            },
          });
          await audit('maintenance.planned', 'equipment', e.id, b);
        }
        const [dto] = await equipmentDtos(tx, { id: e.id }, true);
        return dto as z.infer<typeof EquipmentSchema>;
      }),
  );

  app.post(
    '/maintenance/:id/done',
    {
      schema: {
        tags: ['matériel'],
        summary: 'Entretien fait : le suivant est planifié s’il est périodique',
        params: z.object({ id: z.uuid() }),
        body: MaintenanceDoneSchema,
        response: { 200: EquipmentSchema },
      },
    },
    (req) =>
      inTenant(deps, req, 'equipment.write', async ({ tx, auth, audit }) => {
        const m = await tx.maintenanceEvent.findUnique({ where: { id: req.params.id } });
        if (!m) throw notFound('Cet entretien');
        if (!m.doneOn) {
          await tx.maintenanceEvent.update({
            where: { id: m.id },
            data: {
              doneOn: day(req.body.doneOn),
              cost: req.body.cost === undefined || req.body.cost === null ? null : BigInt(req.body.cost),
              notes: req.body.notes ?? null,
            },
          });
          if (m.intervalMonths)
            await tx.maintenanceEvent.create({
              data: {
                id: crypto.randomUUID(),
                tenantId: auth.tenantId,
                equipmentId: m.equipmentId,
                kind: m.kind,
                label: m.label,
                dueOn: day(nextMaintenanceDue(req.body.doneOn, m.intervalMonths)),
                intervalMonths: m.intervalMonths,
                createdBy: auth.userId,
              },
            });
          await audit('maintenance.done', 'equipment', m.equipmentId, { maintenanceId: m.id, ...req.body });
        }
        const [dto] = await equipmentDtos(tx, { id: m.equipmentId }, true);
        return dto as z.infer<typeof EquipmentSchema>;
      }),
  );
};
