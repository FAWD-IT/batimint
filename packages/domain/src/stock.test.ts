import { describe, expect, it } from 'vitest';
import { Dec } from './money';
import {
  countStock,
  EMPTY_BALANCE,
  equipmentUsageCost,
  equipmentUsageDays,
  isBelowThreshold,
  issueStock,
  maintenanceStatus,
  nextMaintenanceDue,
  receiveStock,
  reorderNeeds,
  StockError,
} from './stock';

describe('stock au coût moyen pondéré', () => {
  it('pondère les entrées et sort au coût moyen', () => {
    let b = receiveStock(EMPTY_BALANCE, '10', 1_000n);
    expect(b).toEqual({ quantity: new Dec(10), averageCost: 1_000n });
    b = receiveStock(b, '30', 1_400n);
    expect(b.averageCost).toBe(1_300n);
    const out = issueStock(b, '4');
    expect(out.cost).toBe(5_200n);
    expect(out.balance.quantity.toString()).toBe('36');
    expect(out.balance.averageCost).toBe(1_300n);
  });

  it('arrondit le coût moyen au centime', () => {
    const b = receiveStock(receiveStock(EMPTY_BALANCE, '3', 1_000n), '1', 1_001n);
    expect(b.averageCost).toBe(1_000n);
    expect(issueStock(b, '0.5').cost).toBe(500n);
  });

  it('refuse une sortie au-delà du stock et les quantités nulles', () => {
    const b = receiveStock(EMPTY_BALANCE, '2', 500n);
    expect(() => issueStock(b, '3')).toThrow(/Stock insuffisant : 2 disponible/);
    expect(() => issueStock(b, '0')).toThrow(StockError);
    expect(() => receiveStock(b, '-1', 100n)).toThrow(StockError);
    expect(() => receiveStock(b, '1', -1n)).toThrow(StockError);
  });

  it('un stock négatif ne pèse pas dans la moyenne', () => {
    const b = receiveStock({ quantity: new Dec(-2), averageCost: 9_999n }, '5', 1_000n);
    expect(b).toEqual({ quantity: new Dec(3), averageCost: 1_000n });
  });

  it('inventaire : l’écart est valorisé au coût moyen', () => {
    const r = countStock({ quantity: new Dec(10), averageCost: 250n }, '8');
    expect(r.delta.toString()).toBe('-2');
    expect(r.value).toBe(-500n);
    expect(() => countStock(r.balance, '-1')).toThrow(StockError);
  });

  it('seuils et quantités à commander', () => {
    expect(isBelowThreshold('3', '5')).toBe(true);
    expect(isBelowThreshold('5', '5')).toBe(false);
    expect(isBelowThreshold('0', null)).toBe(false);
    expect(
      reorderNeeds([
        { itemId: 'a', locationId: 'd', quantity: '3', minQuantity: '5', reorderQuantity: '20' },
        { itemId: 'b', locationId: 'd', quantity: '1', minQuantity: '4', reorderQuantity: null },
        { itemId: 'c', locationId: 'd', quantity: '9', minQuantity: '4', reorderQuantity: '10' },
        { itemId: 'e', locationId: 'd', quantity: '0', minQuantity: null, reorderQuantity: null },
      ]).map((x) => [x.itemId, x.quantity.toString()]),
    ).toEqual([
      ['a', '20'],
      ['b', '7'],
    ]);
  });
});

describe('matériel', () => {
  it('compte les jours ouvrables d’usage, fériés belges exclus', () => {
    // Du lundi 2 au vendredi 13 novembre 2026, avec le 11 novembre férié : 9 jours.
    expect(equipmentUsageDays('2026-11-02', '2026-11-13', '2026-12-01')).toBe(9);
    // En cours : jusqu'à aujourd'hui.
    expect(equipmentUsageDays('2026-11-02', null, '2026-11-04')).toBe(3);
    expect(equipmentUsageDays('2026-11-10', null, '2026-11-02')).toBe(0);
    expect(equipmentUsageCost(4_500n, 9)).toBe(40_500n);
    expect(() => equipmentUsageCost(100n, -1)).toThrow(StockError);
  });

  it('échéances d’entretien', () => {
    expect(maintenanceStatus('2026-10-01', '2026-10-03')).toBe('overdue');
    expect(maintenanceStatus('2026-10-17', '2026-10-03')).toBe('due_soon');
    expect(maintenanceStatus('2026-10-18', '2026-10-03')).toBe('ok');
    expect(nextMaintenanceDue('2026-08-31', 6)).toBe('2027-02-28');
  });
});
