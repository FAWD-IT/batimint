/**
 * Stock et matériel (03 §11, 02 P13) : coût moyen pondéré, sorties imputées au chantier,
 * seuils de réapprovisionnement, coût d'usage journalier du matériel, entretiens à échéance.
 * Logique pure, sans I/O.
 */
import { type IsoDate, addDays, workingDaysBetween } from './calendar';
import { type Cents, Dec, dec, type DecimalInput, multiplyCents, roundHalfAwayFromZero } from './money';
import { addMonths } from './reception';

export class StockError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StockError';
  }
}

export type StockMovementKind = 'in' | 'out' | 'transfer' | 'adjustment';

export interface StockBalance {
  /** Quantité en stock (décimal). */
  quantity: Dec;
  /** Coût moyen pondéré unitaire, en centimes (arrondi au centime). */
  averageCost: Cents;
}

export const EMPTY_BALANCE: StockBalance = { quantity: new Dec(0), averageCost: 0n };

/**
 * Entrée en stock : nouveau coût moyen pondéré = (stock × CMP + entrée × prix) / (stock + entrée).
 * Un stock négatif ou nul ne pèse pas dans la moyenne (on repart du prix d'entrée).
 */
export function receiveStock(balance: StockBalance, qty: DecimalInput, unitCost: Cents): StockBalance {
  const q = dec(qty);
  if (q.lte(0)) throw new StockError('invalid_quantity', 'La quantité entrée doit être positive.');
  if (unitCost < 0n) throw new StockError('invalid_cost', 'Le prix d’entrée ne peut pas être négatif.');
  const held = balance.quantity.gt(0) ? balance.quantity : new Dec(0);
  const total = held.plus(q);
  const value = held.times(balance.averageCost.toString()).plus(q.times(unitCost.toString()));
  return {
    quantity: balance.quantity.plus(q),
    averageCost: roundHalfAwayFromZero(value.dividedBy(total)),
  };
}

/**
 * Sortie (vers un chantier, ou transfert) au coût moyen pondéré : le coût imputé vaut
 * quantité × CMP, arrondi au centime. Refusée si le stock ne suffit pas.
 */
export function issueStock(balance: StockBalance, qty: DecimalInput): { balance: StockBalance; cost: Cents } {
  const q = dec(qty);
  if (q.lte(0)) throw new StockError('invalid_quantity', 'La quantité sortie doit être positive.');
  if (balance.quantity.lt(q))
    throw new StockError(
      'insufficient_stock',
      `Stock insuffisant : ${balance.quantity.toString().replace('.', ',')} disponible.`,
    );
  return {
    balance: { quantity: balance.quantity.minus(q), averageCost: balance.averageCost },
    cost: multiplyCents(balance.averageCost, q),
  };
}

/** Inventaire : la quantité comptée remplace la quantité théorique ; l'écart est valorisé au CMP. */
export function countStock(
  balance: StockBalance,
  counted: DecimalInput,
): { balance: StockBalance; delta: Dec; value: Cents } {
  const c = dec(counted);
  if (c.lt(0)) throw new StockError('invalid_quantity', 'Une quantité comptée ne peut pas être négative.');
  const delta = c.minus(balance.quantity);
  return {
    balance: { quantity: c, averageCost: balance.averageCost },
    delta,
    value: multiplyCents(balance.averageCost, delta),
  };
}

export interface ReorderInput {
  itemId: string;
  locationId: string;
  quantity: DecimalInput;
  minQuantity: DecimalInput | null;
  reorderQuantity: DecimalInput | null;
}

/**
 * Réapprovisionnement (03 §11) : sous le seuil, on propose la quantité de réapprovisionnement
 * paramétrée, sinon de quoi revenir au double du seuil.
 */
export function reorderNeeds(
  levels: readonly ReorderInput[],
): { itemId: string; locationId: string; quantity: Dec }[] {
  const out: { itemId: string; locationId: string; quantity: Dec }[] = [];
  for (const l of levels) {
    if (l.minQuantity === null) continue;
    const min = dec(l.minQuantity);
    const q = dec(l.quantity);
    if (q.gte(min)) continue;
    const want =
      l.reorderQuantity !== null && dec(l.reorderQuantity).gt(0)
        ? dec(l.reorderQuantity)
        : min.times(2).minus(q);
    if (want.gt(0)) out.push({ itemId: l.itemId, locationId: l.locationId, quantity: want });
  }
  return out;
}

export function isBelowThreshold(quantity: DecimalInput, minQuantity: DecimalInput | null): boolean {
  return minQuantity !== null && dec(quantity).lt(dec(minQuantity));
}

/* -------------------------------------------------------------------------------------------- */
/* Matériel                                                                                     */

/**
 * Jours d'usage d'une affectation de matériel sur un chantier : jours ouvrables (hors week-ends et
 * jours fériés belges) entre le début et la fin (ou aujourd'hui si elle est en cours), inclus.
 */
export function equipmentUsageDays(from: IsoDate, to: IsoDate | null, today: IsoDate): number {
  const end = to && to < today ? to : today;
  if (end < from) return 0;
  return workingDaysBetween(from, end);
}

export function equipmentUsageCost(dailyCost: Cents, days: number): Cents {
  if (days < 0) throw new StockError('invalid_days', 'Un nombre de jours ne peut pas être négatif.');
  return dailyCost * BigInt(days);
}

export type MaintenanceStatus = 'ok' | 'due_soon' | 'overdue';

/** Entretien ou contrôle : bientôt dû (14 jours), en retard. */
export function maintenanceStatus(dueOn: IsoDate, today: IsoDate, warningDays = 14): MaintenanceStatus {
  if (dueOn < today) return 'overdue';
  if (dueOn <= addDays(today, warningDays)) return 'due_soon';
  return 'ok';
}

/** Prochaine échéance d'un entretien périodique (en mois) après sa réalisation. */
export function nextMaintenanceDue(doneOn: IsoDate, intervalMonths: number): IsoDate {
  return addMonths(doneOn, intervalMonths);
}
