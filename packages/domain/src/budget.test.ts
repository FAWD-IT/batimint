import { describe, expect, it } from 'vitest';
import {
  clampRatio,
  committedTotal,
  computeBudgetLine,
  computeProjectFinancials,
  EMPTY_COMMITTED,
  isDrifting,
  progressFromTasks,
  projectedCost,
} from './budget';

describe('04 — calcul budgétaire', () => {
  it('engagé = somme de toutes les sources de coût', () => {
    expect(
      committedTotal({
        supplierInvoices: 1n,
        openPurchaseOrders: 2n,
        labour: 3n,
        stock: 4n,
        equipment: 5n,
        subcontracts: 6n,
      }),
    ).toBe(21n);
  });

  it('coût projeté : jamais de marge flatteuse en début de chantier', () => {
    // Avancement 0, rien d'engagé : projeté = budgété
    expect(projectedCost(10000n, 0n, 0)).toBe(10000n);
    // Avancement 50 %, engagé 3 000 sur 10 000 : la part consommée vaut au moins 5 000
    expect(projectedCost(10000n, 3000n, '0.5')).toBe(10000n);
    // Avancement 50 %, engagé 7 000 : dépassement → 7 000 + reste 5 000
    expect(projectedCost(10000n, 7000n, '0.5')).toBe(12000n);
    // Avancement borné à [0, 1]
    expect(projectedCost(10000n, 0n, 2)).toBe(10000n);
    expect(clampRatio(-1).toString()).toBe('0');
  });

  it('alerte de dérive : engagé > budgété × (1 + seuil)', () => {
    expect(isDrifting(10000n, 11000n)).toBe(false);
    expect(isDrifting(10000n, 11001n)).toBe(true);
    expect(isDrifting(10000n, 10600n, '0.05')).toBe(true);
    expect(isDrifting(0n, 1n)).toBe(true);
    expect(isDrifting(0n, 0n)).toBe(false);
  });

  it('marge prévue et marge réelle estimée du chantier', () => {
    const f = computeProjectFinancials([
      {
        id: 'carrelage',
        revenue: 1000000n,
        budgetedCost: 760000n,
        committed: { ...EMPTY_COMMITTED, supplierInvoices: 600000n, labour: 300000n },
        progress: '0.8',
        invoiced: 500000n,
        collected: 400000n,
      },
      { id: 'plomberie', revenue: 500000n, budgetedCost: 380000n, committed: EMPTY_COMMITTED, progress: 0 },
    ]);
    expect(f.contractAmount).toBe(1500000n);
    expect(f.budgetedCost).toBe(1140000n);
    expect(f.plannedMargin?.toString()).toBe('0.24');
    // carrelage : max(900 000, 608 000) + 152 000 = 1 052 000 ; plomberie : 380 000
    expect(f.projectedCost).toBe(1432000n);
    expect(f.estimatedMarginAmount).toBe(68000n);
    expect(f.driftingLineIds).toEqual(['carrelage']);
    expect(f.invoiced).toBe(500000n);
    expect(f.collected).toBe(400000n);
    expect(f.progress.toFixed(4)).toBe('0.5333');
  });

  it('chantier vide : pas de division par zéro', () => {
    const f = computeProjectFinancials([]);
    expect(f.plannedMargin).toBeNull();
    expect(f.progress.toString()).toBe('0');
    const line = computeBudgetLine({
      id: 'x',
      revenue: 0n,
      budgetedCost: 0n,
      committed: EMPTY_COMMITTED,
      progress: 0,
    });
    expect(line.consumption).toBeNull();
  });

  it('avancement d’un poste depuis ses tâches pondérées', () => {
    expect(progressFromTasks([]).toString()).toBe('0');
    expect(progressFromTasks([{ done: true }, { done: false }]).toString()).toBe('0.5');
    expect(
      progressFromTasks([
        { done: true, weight: 3 },
        { done: false, weight: 1, progress: '0.5' },
      ]).toString(),
    ).toBe('0.875');
    expect(progressFromTasks([{ done: true, weight: 0 }]).toString()).toBe('0');
  });
});
