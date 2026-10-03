import { describe, expect, it } from 'vitest';
import {
  cashForecast,
  groupMargins,
  hoursVsPlanned,
  lastWorkingDayOfMonth,
  monthlyPayroll,
  orderBook,
  payrollOutflows,
  periodBounds,
  quoteConversion,
  ReportingError,
} from './reporting';

describe('périodes', () => {
  it('mois, trimestre, année et période libre', () => {
    expect(periodBounds('month', '2026-02-14')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodBounds('quarter', '2026-08-03')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(periodBounds('quarter', '2026-12-31')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodBounds('year', '2026-10-03')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodBounds('custom', '2026-10-03', { from: '2026-09-01', to: '2026-09-15' })).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
    expect(() => periodBounds('custom', '2026-10-03', { from: '2026-09-15', to: '2026-09-01' })).toThrow(
      ReportingError,
    );
  });
});

describe('devis et carnet de commandes', () => {
  it('transformation : signés sur décidés, montants', () => {
    const r = quoteConversion([
      { status: 'signed', amount: 1_000_000n },
      { status: 'signed', amount: 500_000n },
      { status: 'refused', amount: 300_000n },
      { status: 'expired', amount: 200_000n },
      { status: 'sent', amount: 400_000n },
      { status: 'viewed', amount: 100_000n },
    ]);
    expect(r).toMatchObject({ sent: 6, signed: 2, refused: 1, expired: 1, open: 2, rate: '0.5' });
    expect(r.amountSigned).toBe(1_500_000n);
    expect(r.amountSent).toBe(2_500_000n);
    expect(quoteConversion([{ status: 'sent', amount: 1n }]).rate).toBeNull();
  });

  it('carnet : reste à facturer, jamais négatif', () => {
    expect(
      orderBook([
        { contractAmount: 1_000_000n, invoicedNet: 400_000n },
        { contractAmount: 200_000n, invoicedNet: 250_000n },
      ]),
    ).toBe(600_000n);
  });
});

describe('marges et heures', () => {
  it('marges regroupées par clé, taux arrondi, tri par vendu', () => {
    const g = groupMargins([
      { key: 'c1', label: 'Dupont', sold: 1_000_000n, cost: 700_000n },
      { key: 'c2', label: 'Lemaire', sold: 3_000_000n, cost: 2_900_000n },
      { key: 'c1', label: 'Dupont', sold: 500_000n, cost: 400_000n },
      { key: 'c3', label: 'Vide', sold: 0n, cost: 10_000n },
    ]);
    expect(g.map((x) => x.key)).toEqual(['c2', 'c1', 'c3']);
    expect(g[1]).toMatchObject({
      count: 2,
      sold: 1_500_000n,
      cost: 1_100_000n,
      margin: 400_000n,
      marginRate: '0.2667',
    });
    expect(g[2]!.marginRate).toBeNull();
  });

  it('heures réelles contre prévues', () => {
    const h = hoursVsPlanned([
      { key: 'k', label: 'Karim', actualMinutes: 2_400, plannedMinutes: 2_280 },
      { key: 'l', label: 'Luca', actualMinutes: 600, plannedMinutes: 0 },
      { key: 'k', label: 'Karim', actualMinutes: 120, plannedMinutes: 240 },
    ]);
    expect(h[0]).toMatchObject({
      key: 'k',
      actualMinutes: 2_520,
      plannedMinutes: 2_520,
      varianceMinutes: 0,
      ratio: '1',
    });
    expect(h[1]!.ratio).toBeNull();
  });
});

describe('trésorerie à 90 jours', () => {
  it('semaines, retards attendus aujourd’hui, horizon, point bas', () => {
    const f = cashForecast({
      today: '2026-10-05',
      openingBalance: 1_000_000n,
      inflows: [
        { date: '2026-09-20', amount: 300_000n, kind: 'receivable', label: 'Facture échue' },
        { date: '2026-10-20', amount: 500_000n, kind: 'receivable', label: 'Facture' },
        { date: '2027-03-01', amount: 900_000n, kind: 'retention', label: 'Hors horizon' },
      ],
      outflows: [
        { date: '2026-10-08', amount: 1_200_000n, kind: 'payable', label: 'Fournisseur' },
        { date: '2026-10-30', amount: 800_000n, kind: 'payroll', label: 'Salaires' },
      ],
    });
    expect(f.from).toBe('2026-10-05');
    expect(f.to).toBe('2027-01-03');
    expect(f.weeks).toHaveLength(13);
    expect(f.weeks[0]).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-11',
      inflow: 300_000n,
      outflow: 1_200_000n,
      balance: 100_000n,
    });
    expect(f.weeks[2]).toMatchObject({ inflow: 500_000n, balance: 600_000n });
    expect(f.weeks.at(-1)!.end).toBe('2027-01-03');
    expect(f.totals).toEqual({ inflow: 800_000n, outflow: 2_000_000n, net: -1_200_000n });
    expect(f.overdue).toEqual({ inflow: 300_000n, outflow: 0n });
    expect(f.lowest).toEqual({ date: '2026-11-01', balance: -200_000n });
    expect(f.items.find((i) => i.label === 'Facture échue')).toMatchObject({
      overdue: true,
      expectedOn: '2026-10-05',
    });
    expect(f.items.some((i) => i.label === 'Hors horizon')).toBe(false);
  });

  it('sans solde de départ : cumul des flux nets ; montant négatif refusé', () => {
    const f = cashForecast({
      today: '2026-10-05',
      inflows: [],
      outflows: [{ date: '2026-10-06', amount: 100n, kind: 'payable', label: 'x' }],
    });
    expect(f.openingBalance).toBeNull();
    expect(f.weeks[0]!.balance).toBe(-100n);
    expect(() =>
      cashForecast({
        today: '2026-10-05',
        inflows: [{ date: '2026-10-06', amount: -1n, kind: 'receivable', label: 'x' }],
        outflows: [],
      }),
    ).toThrow(ReportingError);
  });

  it('salaires : masse mensuelle et dernier jour ouvré de chaque mois', () => {
    // 44 € × 38 h × 52 / 12 = 7 245,33 €
    expect(monthlyPayroll([{ hourlyCost: 4_400n }])).toBe(724_533n);
    expect(monthlyPayroll([{ hourlyCost: 4_400n, weeklyHours: '19' }, { hourlyCost: 3_000n }])).toBe(
      362_267n + 494_000n,
    );
    expect(lastWorkingDayOfMonth('2026-10-10')).toBe('2026-10-30');
    // 31 janvier 2027 est un dimanche
    expect(lastWorkingDayOfMonth('2027-01-04')).toBe('2027-01-29');
    expect(payrollOutflows(100n, '2026-10-05').map((i) => i.date)).toEqual([
      '2026-10-30',
      '2026-11-30',
      '2026-12-31',
    ]);
    expect(payrollOutflows(0n, '2026-10-05')).toEqual([]);
  });
});
