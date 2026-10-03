import { describe, expect, it } from 'vitest';
import {
  addMonths,
  finalInvoiceReady,
  heldRetention,
  plannedFinalReception,
  priceSuggestions,
  profitabilityReport,
  receptionBlockers,
  ReceptionError,
  retentionRelease,
} from './reception';

describe('réceptions', () => {
  it('ajoute des mois en respectant la fin du mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-10-03', 12)).toBe('2027-10-03');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('réception définitive prévue à la fin de la garantie', () => {
    expect(plannedFinalReception('2026-10-03', 12)).toBe('2027-10-03');
    expect(() => plannedFinalReception('2026-10-03', -1)).toThrow(ReceptionError);
  });

  it('freins à la signature d’un PV', () => {
    expect(receptionBlockers({ kind: 'provisional', projectStatus: 'in_progress', openReserves: 0 })).toEqual(
      [],
    );
    expect(receptionBlockers({ kind: 'provisional', projectStatus: 'preparation', openReserves: 0 })).toEqual(
      ['project_not_in_progress'],
    );
    expect(receptionBlockers({ kind: 'final', projectStatus: 'in_progress', openReserves: 0 })).toEqual([
      'provisional_missing',
    ]);
    expect(
      receptionBlockers({ kind: 'final', projectStatus: 'provisional_acceptance', openReserves: 2 }),
    ).toEqual(['reserves_open']);
  });

  it('facture finale quand toutes les réserves sont levées', () => {
    expect(finalInvoiceReady({ projectStatus: 'provisional_acceptance', openReserves: 0 })).toBe(true);
    expect(finalInvoiceReady({ projectStatus: 'provisional_acceptance', openReserves: 1 })).toBe(false);
    expect(finalInvoiceReady({ projectStatus: 'in_progress', openReserves: 0 })).toBe(false);
  });

  it('libère les retenues non encore libérées, avec une échéance propre', () => {
    const r = retentionRelease(
      [
        { retentionAmount: 50_000n, released: false },
        { retentionAmount: 25_000n, released: true },
        { retentionAmount: 0n, released: false },
        { retentionAmount: 12_345n, released: false },
      ],
      '2027-10-03',
      30,
    );
    expect(r).toEqual({ amount: 62_345n, count: 2, dueDate: '2027-11-02' });
    expect(heldRetention({ retentionAmount: 100n, retentionReleasedAt: null })).toBe(100n);
    expect(heldRetention({ retentionAmount: 100n, retentionReleasedAt: '2027-10-03' })).toBe(0n);
  });
});

describe('rapport de rentabilité', () => {
  const report = profitabilityReport([
    {
      id: 'carrelage',
      label: 'Carrelage',
      revenue: 1_000_000n,
      budgetedCost: 700_000n,
      actualByCategory: { supplier_invoice: 500_000n, labour: 310_000n },
      plannedHours: '40',
      actualHours: '50',
    },
    {
      id: 'plomberie',
      label: 'Plomberie',
      revenue: 500_000n,
      budgetedCost: 400_000n,
      actualByCategory: { supplier_invoice: 380_000n },
      plannedHours: '0',
      actualHours: '0',
    },
  ]);

  it('compare le prévu et le réel par poste et au total', () => {
    const c = report.posts[0]!;
    expect(c.actualCost).toBe(810_000n);
    expect(c.costVariance).toBe(110_000n);
    expect(c.costVarianceRatio!.toString()).toBe('0.1571');
    expect(c.plannedMargin!.toString()).toBe('0.3');
    expect(c.actualMargin!.toString()).toBe('0.19');
    expect(report.actualCost).toBe(1_190_000n);
    expect(report.plannedMargin!.toString()).toBe('0.2667');
    expect(report.actualMargin!.toString()).toBe('0.2067');
    expect(report.actualHours.toString()).toBe('50');
  });

  it('suggère d’ajuster les articles des postes qui dérivent', () => {
    const s = priceSuggestions(report, [
      { itemId: 'faience', itemName: 'Faïence', postId: 'carrelage', unitCost: 2_500n, laborHours: '0' },
      { itemId: 'pose', itemName: 'Pose', postId: 'carrelage', unitCost: 0n, laborHours: '0.8' },
      { itemId: 'mitigeur', itemName: 'Mitigeur', postId: 'plomberie', unitCost: 18_000n, laborHours: '0' },
    ]);
    expect(s.map((x) => [x.itemId, x.field, x.suggested])).toEqual([
      ['pose', 'laborHours', '1'],
      ['faience', 'unitCost', '2893'],
    ]);
  });

  it('pas de suggestion sous le seuil', () => {
    expect(
      priceSuggestions(report, [
        { itemId: 'm', itemName: 'M', postId: 'plomberie', unitCost: 100n, laborHours: '0' },
      ]),
    ).toEqual([]);
  });
});
