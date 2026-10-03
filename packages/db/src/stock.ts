/**
 * Mouvements de stock partagés par l'API, la réception des bons de commande et le seed
 * (03 §11, P13) : verrou sur le niveau, coût moyen pondéré de l'article, mouvement idempotent
 * (identifiant client), événement de sortie vers un chantier et alerte de seuil.
 */
import {
  countStock,
  type Dec,
  dec,
  isBelowThreshold,
  issueStock,
  receiveStock,
  type StockMovementKind,
} from '@batimint/domain';
import type { Tx } from './client';
import { emitEvent, type EventActor } from './outbox';

export interface StockMovementInput {
  id: string;
  tenantId: string;
  kind: StockMovementKind;
  itemId: string;
  locationId: string;
  quantity: string;
  /** Entrée : prix d'achat unitaire (centimes). */
  unitCost?: bigint | null;
  toLocationId?: string | null;
  projectId?: string | null;
  budgetLineId?: string | null;
  purchaseOrderId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  userId?: string | null;
  actor: EventActor;
}

async function lockLevel(tx: Tx, tenantId: string, locationId: string, itemId: string) {
  await tx.stockLevel.upsert({
    where: { locationId_itemId: { locationId, itemId } },
    create: { tenantId, locationId, itemId },
    update: {},
  });
  await tx.$queryRaw`SELECT id FROM stock_levels WHERE location_id = ${locationId}::uuid AND item_id = ${itemId}::uuid FOR UPDATE`;
  return tx.stockLevel.findUniqueOrThrow({ where: { locationId_itemId: { locationId, itemId } } });
}

async function totalQuantity(tx: Tx, itemId: string): Promise<Dec> {
  const levels = await tx.stockLevel.findMany({ where: { itemId }, select: { quantity: true } });
  return levels.reduce((s, l) => s.plus(l.quantity.toString()), dec(0));
}

/** Alerte de seuil : une seule fois sous le seuil, réarmée au-dessus. */
async function checkThreshold(tx: Tx, levelId: string, actor: EventActor) {
  const l = await tx.stockLevel.findUniqueOrThrow({ where: { id: levelId } });
  const below = isBelowThreshold(l.quantity.toString(), l.minQuantity?.toString() ?? null);
  if (below && !l.alertedAt) {
    await tx.stockLevel.update({ where: { id: l.id }, data: { alertedAt: new Date() } });
    await emitEvent(tx, {
      tenantId: l.tenantId,
      type: 'stock.level_low.v1',
      aggregateType: 'stock_level',
      aggregateId: l.id,
      payload: { levelId: l.id, itemId: l.itemId, locationId: l.locationId },
      actor,
    });
  } else if (!below && l.alertedAt) {
    await tx.stockLevel.update({ where: { id: l.id }, data: { alertedAt: null } });
  }
}

/**
 * Enregistre un mouvement. Entrée : le coût moyen de l'article est repondéré. Sortie vers un
 * chantier : coût = quantité × coût moyen, imputé au poste par l'événement. Transfert : au coût
 * moyen, sans effet sur la valeur. Inventaire : la quantité comptée remplace la quantité.
 */
export async function recordStockMovement(tx: Tx, input: StockMovementInput) {
  const existing = await tx.stockMovement.findUnique({ where: { id: input.id } });
  if (existing) return existing;
  const item = await tx.item.findUniqueOrThrow({ where: { id: input.itemId } });
  const level = await lockLevel(tx, input.tenantId, input.locationId, input.itemId);
  const qty = dec(input.quantity);
  const base = { quantity: dec(level.quantity.toString()), averageCost: item.stockAverageCost };
  let unitCost = item.stockAverageCost;
  let totalCost = 0n;
  let newQty: Dec;
  switch (input.kind) {
    case 'in': {
      const global = { quantity: await totalQuantity(tx, item.id), averageCost: item.stockAverageCost };
      unitCost = input.unitCost ?? item.purchasePrice;
      const after = receiveStock(global, qty, unitCost);
      await tx.item.update({ where: { id: item.id }, data: { stockAverageCost: after.averageCost } });
      newQty = base.quantity.plus(qty);
      totalCost = BigInt(qty.times(unitCost.toString()).toDecimalPlaces(0).toFixed(0));
      break;
    }
    case 'out':
    case 'transfer': {
      const r = issueStock(base, qty);
      totalCost = r.cost;
      newQty = r.balance.quantity;
      break;
    }
    case 'adjustment': {
      const r = countStock(base, qty);
      totalCost = r.value;
      newQty = r.balance.quantity;
      break;
    }
  }
  await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: newQty.toString() } });
  if (input.kind === 'transfer' && input.toLocationId) {
    const to = await lockLevel(tx, input.tenantId, input.toLocationId, input.itemId);
    await tx.stockLevel.update({
      where: { id: to.id },
      data: { quantity: dec(to.quantity.toString()).plus(qty).toString() },
    });
    await checkThreshold(tx, to.id, input.actor);
  }
  const movement = await tx.stockMovement.create({
    data: {
      id: input.id,
      tenantId: input.tenantId,
      itemId: input.itemId,
      kind: input.kind,
      quantity: input.kind === 'adjustment' ? newQty.minus(base.quantity).toString() : qty.toString(),
      unitCost,
      totalCost,
      locationId: input.locationId,
      toLocationId: input.kind === 'transfer' ? (input.toLocationId ?? null) : null,
      projectId: input.kind === 'out' ? (input.projectId ?? null) : null,
      budgetLineId: input.kind === 'out' ? (input.budgetLineId ?? null) : null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      createdBy: input.userId ?? null,
    },
  });
  await checkThreshold(tx, level.id, input.actor);
  if (movement.projectId)
    await emitEvent(tx, {
      tenantId: input.tenantId,
      type: 'stock.moved_to_project.v1',
      aggregateType: 'project',
      aggregateId: movement.projectId,
      payload: { movementId: movement.id, projectId: movement.projectId },
      actor: input.actor,
    });
  return movement;
}
