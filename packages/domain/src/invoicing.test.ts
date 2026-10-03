import { describe, expect, it } from 'vitest';
import {
  amountDue,
  b2cMaxFee,
  creditNoteLines,
  DEFAULT_DUNNING_POLICY,
  depositDeduction,
  dueDunningStep,
  epcQrPayload,
  invoiceBalance,
  InvoicingError,
  isInvoiceOverdue,
  issuanceDeadline,
  lateInterest,
  paymentState,
  priceRevisionAmount,
  priceRevisionFactor,
  progressFromInput,
  progressInvoiceLines,
  retentionOf,
  splitByRegime,
  suggestProgressPercent,
  summarizeStatement,
  validatePayment,
} from './invoicing';
import { dec } from './money';
import { computeDocumentTotals } from './vat';

describe('états d’avancement (02 P7.1)', () => {
  const post = { contractAmount: 1_000_000n, previousAmount: 250_000n, totalQuantity: '40' };

  it('saisie en %, en quantité ou en € donne le même cumul', () => {
    const byPct = progressFromInput(post, 'percent', '40');
    const byQty = progressFromInput(post, 'quantity', '16');
    const byAmount = progressFromInput(post, 'amount', '400000');
    for (const v of [byPct, byQty, byAmount]) {
      expect(v.cumulativeAmount).toBe(400_000n);
      expect(v.periodAmount).toBe(150_000n);
      expect(v.cumulativeRatio.toString()).toBe('0.4');
      expect(v.cumulativeQuantity?.toString()).toBe('16');
    }
  });

  it('refuse un cumul sous l’état précédent (régularisation = note de crédit) ou au-delà du contrat', () => {
    expect(() => progressFromInput(post, 'percent', '20')).toThrow(/note de crédit/);
    expect(() => progressFromInput(post, 'percent', '101')).toThrow(InvoicingError);
    expect(() => progressFromInput(post, 'amount', '1000001')).toThrow(/dépasse/);
    expect(() => progressFromInput({ ...post, totalQuantity: null }, 'quantity', '3')).toThrow(/quantité/);
  });

  it('pré-remplit depuis les tâches cochées, jamais sous le déjà facturé', () => {
    expect(suggestProgressPercent({ ...post, taskProgress: '0.6' }).toString()).toBe('60');
    expect(suggestProgressPercent({ ...post, taskProgress: '0.1' }).toString()).toBe('25');
    expect(suggestProgressPercent({ ...post, previousAmount: 333_333n, taskProgress: 0 }).toString()).toBe(
      '33.4',
    );
  });

  it('résume un état : contrat, précédent, cumul, période', () => {
    const s = summarizeStatement([
      { contractAmount: 1_000_000n, previousAmount: 250_000n, cumulativeAmount: 400_000n },
      { contractAmount: 500_000n, previousAmount: 0n, cumulativeAmount: 100_000n },
    ]);
    expect(s).toMatchObject({
      contractAmount: 1_500_000n,
      periodAmount: 250_000n,
      cumulativeAmount: 500_000n,
    });
    expect(s.cumulativeRatio.toDecimalPlaces(4).toString()).toBe('0.3333');
  });
});

describe('facture d’avancement : TVA par poste et déduction de l’acompte (02 P7.3)', () => {
  it('répartit un poste mixte 6 % / 21 % au prorata, sans perdre un centime', () => {
    const parts = splitByRegime(100_001n, [
      { vatRegime: 'reduced_6', net: 300n },
      { vatRegime: 'standard_21', net: 100n },
    ]);
    expect(parts.reduce((s, p) => s + p.net, 0n)).toBe(100_001n);
    expect(parts[0]).toEqual({ vatRegime: 'reduced_6', net: 75_001n });
  });

  it('déduit l’acompte au prorata de la période, puis le solde sur la finale', () => {
    const deposit = [{ vatRegime: 'reduced_6' as const, net: 300_000n }];
    const first = depositDeduction({
      deposit,
      alreadyDeducted: [],
      periodAmount: 400_000n,
      contractAmount: 1_000_000n,
    });
    expect(first).toEqual([{ vatRegime: 'reduced_6', net: 120_000n }]);
    const last = depositDeduction({
      deposit,
      alreadyDeducted: first,
      periodAmount: 100_000n,
      contractAmount: 1_000_000n,
      final: true,
    });
    expect(last).toEqual([{ vatRegime: 'reduced_6', net: 180_000n }]);
    expect(
      depositDeduction({
        deposit,
        alreadyDeducted: [...first, ...last],
        periodAmount: 1n,
        contractAmount: 1n,
      }),
    ).toEqual([]);
  });

  it('produit des lignes conformes EN 16931 : déduction en quantité −1, prix positif (BR-27)', () => {
    const lines = progressInvoiceLines({
      posts: [
        {
          budgetLineId: 'b1',
          label: 'Carrelage',
          periodAmount: 150_000n,
          cumulativeRatio: dec('0.4'),
          regimes: [{ vatRegime: 'reduced_6', net: 1n }],
        },
        { budgetLineId: 'b2', label: 'Plomberie', periodAmount: 0n, cumulativeRatio: dec('0'), regimes: [] },
      ],
      deduction: [{ vatRegime: 'reduced_6', net: 45_000n }],
      depositLabel: 'Déduction de l’acompte (facture 2026-101)',
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      description: 'Carrelage — avancement cumulé 40 %',
      unitPrice: 150_000n,
    });
    expect(lines[1]).toMatchObject({ kind: 'deduction', quantity: '-1', unitPrice: 45_000n });
    const totals = computeDocumentTotals(lines);
    expect(totals.totalNet).toBe(105_000n);
    expect(totals.totalVat).toBe(6_300n);
  });
});

describe('retenue de garantie, solde et paiements', () => {
  it('la retenue réduit le montant exigible, pas la base ni la TVA', () => {
    const retention = retentionOf(121_000n, '5');
    expect(retention).toBe(6_050n);
    expect(amountDue({ totalGross: 121_000n, retentionAmount: retention })).toBe(114_950n);
    expect(retentionOf(121_000n, '0')).toBe(0n);
  });

  it('paiements partiels puis soldés ; jamais au-delà du solde', () => {
    const inv = { totalGross: 100_000n, retentionAmount: 0n };
    expect(paymentState({ ...inv, paid: 0n })).toBe('unpaid');
    expect(paymentState({ ...inv, paid: 40_000n })).toBe('partially_paid');
    expect(paymentState({ ...inv, paid: 100_000n })).toBe('paid');
    expect(invoiceBalance({ ...inv, paid: 30_000n, credited: 20_000n })).toBe(50_000n);
    expect(() => validatePayment(60_001n, 60_000n)).toThrow(/dépasse/);
    expect(() => validatePayment(0n, 60_000n)).toThrow(/positif/);
  });

  it('retard et délai d’émission (15 du mois suivant) [à valider]', () => {
    expect(isInvoiceOverdue({ dueDate: '2026-09-30', today: '2026-10-02', balance: 1n })).toBe(true);
    expect(isInvoiceOverdue({ dueDate: '2026-09-30', today: '2026-10-02', balance: 0n })).toBe(false);
    expect(issuanceDeadline('2026-09-12')).toBe('2026-10-15');
    expect(issuanceDeadline('2026-12-31')).toBe('2027-01-15');
  });
});

describe('notes de crédit (05 §2)', () => {
  const original = [
    {
      kind: 'item' as const,
      description: 'Carrelage',
      unit: 'forfait',
      quantity: '1',
      unitPrice: 100_000n,
      vatRegime: 'reduced_6' as const,
      budgetLineId: 'b1',
    },
    {
      kind: 'item' as const,
      description: 'Plomberie',
      unit: 'forfait',
      quantity: '1',
      unitPrice: 50_000n,
      vatRegime: 'reduced_6' as const,
      budgetLineId: 'b2',
    },
  ];
  it('totale : reprend toutes les lignes', () => {
    expect(
      creditNoteLines({ original, originalNet: 150_000n, alreadyCredited: 0n, reason: 'erreur' }),
    ).toHaveLength(2);
  });
  it('partielle : un montant par ligne, sans dépasser ce qui reste à créditer', () => {
    const lines = creditNoteLines({
      original,
      originalNet: 150_000n,
      alreadyCredited: 0n,
      partial: [{ index: 1, amount: 20_000n }],
      reason: 'geste commercial',
    });
    expect(lines).toEqual([
      expect.objectContaining({
        description: 'Plomberie — geste commercial',
        unitPrice: 20_000n,
        budgetLineId: 'b2',
      }),
    ]);
    expect(() =>
      creditNoteLines({
        original,
        originalNet: 150_000n,
        alreadyCredited: 140_000n,
        partial: [{ index: 0, amount: 20_000n }],
        reason: 'x',
      }),
    ).toThrow(/dépasse/);
  });
});

describe('QR code EPC (05 §5)', () => {
  it('suit EPC069-12 v002 avec la communication structurée', () => {
    const payload = epcQrPayload({
      name: "Rénov'Habitat SRL",
      iban: 'BE71 0961 2345 6769',
      bic: 'GKCCBEBB',
      amount: 1_628_160n,
      remittance: '+++104/2600/11893+++',
    });
    expect(payload.split('\n')).toEqual([
      'BCD',
      '002',
      '1',
      'SCT',
      'GKCCBEBB',
      "Rénov'Habitat SRL",
      'BE71096123456769',
      'EUR16281.60',
      '',
      '',
      '+++104/2600/11893+++',
    ]);
    expect(() => epcQrPayload({ name: 'x', iban: 'BE71', amount: 0n, remittance: '' })).toThrow();
  });
});

describe('relances (05 §6) [à valider : taux et plafonds]', () => {
  const base = { dueDate: '2026-09-01', balance: 100_000n, policy: DEFAULT_DUNNING_POLICY };
  it('une étape à la fois selon le calendrier J+3, J+15, J+30 ; la dernière est une mise en demeure', () => {
    expect(
      dueDunningStep({ ...base, today: '2026-09-03', stepsSent: 0, customerKind: 'company' }),
    ).toBeNull();
    expect(
      dueDunningStep({ ...base, today: '2026-09-04', stepsSent: 0, customerKind: 'company' }),
    ).toMatchObject({ step: 1, kind: 'reminder', daysLate: 3 });
    expect(
      dueDunningStep({ ...base, today: '2026-09-10', stepsSent: 1, customerKind: 'company' }),
    ).toBeNull();
    expect(
      dueDunningStep({ ...base, today: '2026-10-02', stepsSent: 2, customerKind: 'company' }),
    ).toMatchObject({ step: 3, kind: 'formal_notice' });
    expect(
      dueDunningStep({ ...base, today: '2026-12-01', stepsSent: 3, customerKind: 'company' }),
    ).toBeNull();
  });
  it('s’arrête dès que la facture est payée', () => {
    expect(
      dueDunningStep({ ...base, balance: 0n, today: '2026-10-02', stepsSent: 0, customerKind: 'company' }),
    ).toBeNull();
  });
  it('B2B : indemnité forfaitaire et intérêts si activés', () => {
    const policy = { ...DEFAULT_DUNNING_POLICY, lateInterestEnabled: true, lumpSumIndemnityEnabled: true };
    const s = dueDunningStep({
      ...base,
      policy,
      today: '2026-09-16',
      stepsSent: 1,
      customerKind: 'company',
    })!;
    expect(s.fee).toBe(4_000n);
    expect(s.interest).toBe(lateInterest(100_000n, '10.15', 15));
    expect(s.interest).toBe(417n);
  });
  it('B2C : premier rappel gratuit, frais plafonnés ensuite', () => {
    const policy = { ...DEFAULT_DUNNING_POLICY, lumpSumIndemnityEnabled: true };
    expect(
      dueDunningStep({ ...base, policy, today: '2026-09-04', stepsSent: 0, customerKind: 'individual' }),
    ).toMatchObject({ fee: 0n, interest: 0n });
    expect(
      dueDunningStep({ ...base, policy, today: '2026-09-16', stepsSent: 1, customerKind: 'individual' })!.fee,
    ).toBe(b2cMaxFee(100_000n));
    expect(b2cMaxFee(10_000n)).toBe(2_000n);
    expect(b2cMaxFee(40_000n)).toBe(5_500n);
    expect(b2cMaxFee(100_000n)).toBe(9_000n);
    expect(b2cMaxFee(100_000_000n)).toBe(200_000n);
  });
});

describe('révision de prix', () => {
  it('p = P × (a·s/S + b·i/I + c)', () => {
    const f = { a: '0.4', b: '0.4', c: '0.2', S: '100', I: '200' };
    const factor = priceRevisionFactor(f, { s: '105', i: '210' });
    expect(factor.toString()).toBe('1.04');
    expect(priceRevisionAmount(1_000_000n, factor)).toBe(40_000n);
    expect(() => priceRevisionFactor({ ...f, c: '0.3' }, { s: 1, i: 1 })).toThrow(/a \+ b \+ c/);
  });
});
