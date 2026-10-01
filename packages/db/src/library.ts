/**
 * Opérations de bibliothèque partagées (API, seed) : installation des bibliothèques types,
 * recalcul du prix de revient des ouvrages.
 */
import {
  type CostableItem,
  computeItemCost,
  eurosToCents,
  type ItemKind,
  multiplyCents,
} from '@batimint/domain';
import type { Tx } from './client';
import {
  DEFAULT_LABOUR_RATE_EUROS,
  STARTER_LIBRARIES,
  type StarterTrade,
  TRADE_DEPENDENCIES,
} from './data/starter-libraries';

type ItemWithComponents = Awaited<ReturnType<typeof loadAssembly>>;

async function loadAssembly(tx: Tx, id: string) {
  return tx.item.findUniqueOrThrow({
    where: { id },
    include: {
      components: {
        orderBy: { position: 'asc' },
        include: { item: { include: { components: { include: { item: true } } } } },
      },
    },
  });
}

function toCostable(
  item: ItemWithComponents | ItemWithComponents['components'][number]['item'],
): CostableItem {
  const components = 'components' in item ? item.components : [];
  return {
    id: item.id,
    kind: item.kind as ItemKind,
    purchasePrice: item.purchasePrice,
    laborHours: item.laborHours.toString(),
    components: components.map((c) => ({
      quantity: c.quantity.toString(),
      item: toCostable(c.item as ItemWithComponents),
    })),
  };
}

/** Recalcule (et enregistre) le prix de revient et le temps de pose d'un ouvrage. */
export async function recomputeAssembly(
  tx: Tx,
  assemblyId: string,
): Promise<{ cost: bigint; laborHours: string }> {
  const a = await loadAssembly(tx, assemblyId);
  const { cost, laborHours } = computeItemCost(toCostable(a));
  await tx.item.update({
    where: { id: a.id },
    data: { purchasePrice: cost, laborHours: laborHours.toDecimalPlaces(4).toString() },
  });
  return { cost, laborHours: laborHours.toString() };
}

/** Recalcule tous les ouvrages qui utilisent un article (après changement de prix). */
export async function recomputeAssembliesUsing(tx: Tx, itemId: string): Promise<number> {
  const parents = await tx.assemblyComponent.findMany({ where: { itemId }, select: { assemblyId: true } });
  const ids = [...new Set(parents.map((p) => p.assemblyId))];
  for (const id of ids) {
    await recomputeAssembly(tx, id);
    // Un sous-ouvrage peut lui-même être utilisé (un niveau d'imbrication).
    const grand = await tx.assemblyComponent.findMany({
      where: { itemId: id },
      select: { assemblyId: true },
    });
    for (const g of grand) await recomputeAssembly(tx, g.assemblyId);
  }
  return ids.length;
}

/**
 * Installe une ou plusieurs bibliothèques types dans le tenant (articles et ouvrages).
 * Idempotent : un code déjà présent n'est ni dupliqué ni écrasé.
 */
export async function installStarterLibraries(
  tx: Tx,
  tenantId: string,
  trades: readonly StarterTrade[],
  userId: string | null,
): Promise<{ created: number; skipped: number }> {
  const wanted = new Set<StarterTrade>(trades);
  for (const t of trades) for (const dep of TRADE_DEPENDENCIES[t] ?? []) wanted.add(dep);
  const libs = STARTER_LIBRARIES.filter((l) => wanted.has(l.trade));
  const existing = new Set((await tx.item.findMany({ select: { code: true } })).map((i) => i.code));
  let created = 0;
  let skipped = 0;
  const rows = libs.flatMap((lib) => lib.items.map((r) => ({ lib, r })));
  const toCreate = rows.filter(({ r }) => {
    if (existing.has(r[0])) {
      skipped++;
      return false;
    }
    existing.add(r[0]);
    return true;
  });
  if (toCreate.length) {
    await tx.item.createMany({
      data: toCreate.map(({ lib, r }) => ({
        tenantId,
        code: r[0],
        name: r[1],
        unit: r[2],
        // Prestation au temps sans prix propre : temps de pose × taux horaire de référence.
        purchasePrice:
          r[3] === 0 && r[4] === 'labour'
            ? multiplyCents(eurosToCents(DEFAULT_LABOUR_RATE_EUROS), r[5].toString())
            : eurosToCents(r[3]),
        kind: r[4],
        laborHours: r[5].toString(),
        category: r[6],
        trade: lib.trade,
        createdBy: userId,
      })),
    });
    created += toCreate.length;
  }
  const byCode = new Map(
    (await tx.item.findMany({ select: { id: true, code: true } })).map((i) => [i.code, i.id]),
  );
  for (const lib of libs) {
    for (const a of lib.assemblies) {
      if (byCode.has(a.code)) {
        skipped++;
        continue;
      }
      const assembly = await tx.item.create({
        data: {
          tenantId,
          code: a.code,
          name: a.name,
          unit: a.unit,
          kind: 'assembly',
          category: a.category,
          trade: lib.trade,
          createdBy: userId,
        },
      });
      byCode.set(a.code, assembly.id);
      await tx.assemblyComponent.createMany({
        data: a.components
          .filter(([code]) => byCode.has(code))
          .map(([code, quantity], position) => ({
            tenantId,
            assemblyId: assembly.id,
            itemId: byCode.get(code)!,
            quantity: quantity.toString(),
            position,
          })),
      });
      await recomputeAssembly(tx, assembly.id);
      created++;
    }
  }
  return { created, skipped };
}
