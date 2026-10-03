import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  combinedDiscountPercent,
  computeQuote,
  diffQuoteVersions,
  isQuoteExpired,
  isQuoteReminderDue,
  type QuoteLineInput,
  type QuoteSectionInput,
  quoteValidUntil,
} from './quote';
import { sumCents } from './money';

const line = (id: string, over: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  id,
  kind: 'item',
  description: id,
  unit: 'm²',
  quantity: '1',
  unitPrice: 10_000n,
  unitCost: 7_000n,
  laborHours: '0',
  vatRegime: 'reduced_6',
  ...over,
});

const section = (
  id: string,
  lines: QuoteLineInput[],
  over: Partial<QuoteSectionInput> = {},
): QuoteSectionInput => ({
  id,
  title: id,
  optional: false,
  selected: false,
  lines,
  ...over,
});

describe('devis — calculs (03 §4, 05 §4)', () => {
  it('salle de bain Dupont : postes, marge, main-d’œuvre, TVA 6 % et option exclue tant que non choisie', () => {
    const sections = [
      section('demolition', [
        line('dem', { quantity: '6.2', unitPrice: 2_500n, unitCost: 1_800n, laborHours: '0.8' }),
      ]),
      section('carrelage', [
        line('fai', { quantity: '18.5', unitPrice: 9_690n, unitCost: 6_765n, laborHours: '0.9' }),
        line('note', { kind: 'text', unitPrice: 0n, unitCost: 0n }),
      ]),
      section('italienne', [line('douche', { unitPrice: 140_000n, unitCost: 100_000n })], { optional: true }),
    ];
    const t = computeQuote({ sections, deposit: { kind: 'percent', value: '30' } });
    // 6,2 × 25,00 = 155,00 ; 18,5 × 96,90 = 1 792,65 → net 1 947,65 ; TVA 6 % = 116,86
    expect(t.document.totalNet).toBe(194_765n);
    expect(t.document.vatBreakdown).toEqual([
      expect.objectContaining({ ratePercent: '6', taxableAmount: 194_765n, taxAmount: 11_686n }),
    ]);
    expect(t.document.totalGross).toBe(206_451n);
    expect(t.totalCost).toBe(11_160n + 125_153n);
    expect(t.laborHours.toString()).toBe('21.61'); // 6,2 × 0,8 + 18,5 × 0,9, exact
    expect(t.optionsAvailable).toBe(140_000n);
    expect(t.depositAmount).toBe(61_935n);
    expect(t.sections.find((s) => s.id === 'italienne')).toMatchObject({
      included: false,
      netAmount: 140_000n,
    });
    // Le texte libre ne compte pas.
    expect(t.lines.map((l) => l.id)).not.toContain('note');

    const chosen = computeQuote({
      sections: sections.map((s) => (s.id === 'italienne' ? { ...s, selected: true } : s)),
    });
    expect(chosen.document.totalNet).toBe(194_765n + 140_000n);
    expect(chosen.optionsAvailable).toBe(0n);
  });

  it('mixe 6 % et 21 % dans un même devis, TVA par taux', () => {
    const t = computeQuote({
      sections: [
        section('a', [
          line('pose', { vatRegime: 'reduced_6' }),
          line('meuble', { vatRegime: 'standard_21' }),
        ]),
      ],
    });
    expect(t.document.vatBreakdown.map((v) => [v.ratePercent, v.taxAmount])).toEqual([
      ['21', 2_100n],
      ['6', 600n],
    ]);
  });

  it('remise globale combinée à la remise de ligne : 1 − (1 − a)(1 − b)', () => {
    expect(combinedDiscountPercent('10', '5').toString()).toBe('14.5');
    expect(combinedDiscountPercent(undefined, undefined).toString()).toBe('0');
    const t = computeQuote({
      sections: [section('a', [line('x', { discountPercent: '10' })])],
      globalDiscountPercent: '5',
    });
    expect(t.document.totalNet).toBe(8_550n);
    expect(t.totalMargin).toBe(1_550n);
  });

  it('acompte en montant fixe, plafonné au total ; marge nulle si vente nulle', () => {
    const fixed = computeQuote({
      sections: [section('a', [line('x')])],
      deposit: { kind: 'amount', value: 5_000n },
    });
    expect(fixed.depositAmount).toBe(5_000n);
    const capped = computeQuote({
      sections: [section('a', [line('x')])],
      deposit: { kind: 'amount', value: 999_999n },
    });
    expect(capped.depositAmount).toBe(capped.document.totalGross);
    const empty = computeQuote({ sections: [section('a', [line('x', { unitPrice: 0n })])], deposit: null });
    expect(empty.marginRate).toBeNull();
    expect(empty.depositAmount).toBe(0n);
  });

  it('propriété : la somme des postes retenus égale le net du document (écran = PDF = UBL)', () => {
    const lineArb = fc.record({
      quantity: fc.integer({ min: 1, max: 100_000 }).map((n) => (n / 100).toFixed(2)),
      unitPrice: fc.bigInt({ min: 0n, max: 5_000_000n }),
      unitCost: fc.bigInt({ min: 0n, max: 5_000_000n }),
      vatRegime: fc.constantFrom('reduced_6', 'standard_21', 'reverse_charge', 'intermediate_12' as const),
      discountPercent: fc.integer({ min: 0, max: 50 }).map(String),
    });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            optional: fc.boolean(),
            selected: fc.boolean(),
            lines: fc.array(lineArb, { maxLength: 6 }),
          }),
          {
            minLength: 1,
            maxLength: 5,
          },
        ),
        fc.integer({ min: 0, max: 20 }).map(String),
        (secs, global) => {
          const input = secs.map((s, i) =>
            section(
              `s${i}`,
              s.lines.map((l, j) => line(`s${i}l${j}`, { ...l, vatRegime: l.vatRegime as 'reduced_6' })),
              { optional: s.optional, selected: s.selected },
            ),
          );
          const t = computeQuote({ sections: input, globalDiscountPercent: global });
          const sum = sumCents(t.sections.filter((s) => s.included).map((s) => s.netAmount));
          expect(sum).toBe(t.document.totalNet);
          expect(t.document.totalGross).toBe(t.document.totalNet + t.document.totalVat);
          expect(t.totalMargin).toBe(t.document.totalNet - t.totalCost);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('devis — versions, validité et relance', () => {
  const l = (key: string, quantity = '1', unitPrice = 1_000n) => ({
    key,
    description: key,
    unit: 'u',
    quantity,
    unitPrice,
    vatRegime: 'standard_21' as const,
    discountPercent: '0',
  });

  it('comparatif : ajoutées, retirées, modifiées (champs nommés)', () => {
    const diff = diffQuoteVersions(
      [{ title: 'Carrelage', lines: [l('a'), l('b'), l('c')] }],
      [
        { title: 'Carrelage', lines: [l('a'), l('b', '2', 1_200n)] },
        { title: 'Options', lines: [l('d')] },
      ],
    );
    expect(diff).toEqual([
      expect.objectContaining({ kind: 'changed', description: 'b', fields: ['quantity', 'unitPrice'] }),
      expect.objectContaining({ kind: 'added', description: 'd', sectionTitle: 'Options' }),
      expect.objectContaining({ kind: 'removed', description: 'c' }),
    ]);
    expect(
      diffQuoteVersions([{ title: 'A', lines: [l('a')] }], [{ title: 'B', lines: [l('a')] }])[0]?.fields,
    ).toEqual(['section']);
  });

  it('relance à J+7 si non signé, une seule fois ; expiration à la date de validité', () => {
    const sentAt = new Date('2026-10-01T10:00:00Z');
    const validUntil = quoteValidUntil(sentAt, 30);
    expect(validUntil.toISOString()).toBe('2026-10-31T10:00:00.000Z');
    const q = { status: 'sent', sentAt, reminderSentAt: null, validUntil };
    expect(isQuoteReminderDue(q, new Date('2026-10-07T10:00:00Z'))).toBe(false);
    expect(isQuoteReminderDue(q, new Date('2026-10-08T10:00:00Z'))).toBe(true);
    expect(isQuoteReminderDue({ ...q, reminderSentAt: new Date() }, new Date('2026-10-09T10:00:00Z'))).toBe(
      false,
    );
    expect(isQuoteReminderDue({ ...q, status: 'signed' }, new Date('2026-10-09T10:00:00Z'))).toBe(false);
    expect(isQuoteReminderDue(q, new Date('2026-11-02T10:00:00Z'))).toBe(false);
    expect(isQuoteReminderDue({ ...q, sentAt: null }, new Date('2026-11-02T10:00:00Z'))).toBe(false);
    expect(isQuoteExpired(q, new Date('2026-10-31T10:00:00Z'))).toBe(true);
    expect(isQuoteExpired(q, new Date('2026-10-30T10:00:00Z'))).toBe(false);
    expect(isQuoteExpired({ ...q, status: 'signed' }, new Date('2027-01-01'))).toBe(false);
  });
});
