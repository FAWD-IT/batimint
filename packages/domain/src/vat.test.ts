import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sumCents } from './money';
import {
  computeDocumentTotals,
  computeLine,
  computeVatBreakdown,
  determineVatRegime,
  type TaxableLineInput,
  validateVatOverride,
  VAT_REGIME_LIST,
  vatIssuanceBlockers,
  vatRegimeInfo,
} from './vat';

describe('05 §4 — arrondis EN 16931', () => {
  it('net de ligne = quantité × PU − remise, arrondi à 2 décimales', () => {
    // 12,5 m² × 34,99 € = 437,375 € → 437,38 €
    const line = computeLine({ quantity: '12.5', unitPrice: 3499n, vatRegime: 'standard_21' });
    expect(line.grossAmount).toBe(43738n);
    expect(line.netAmount).toBe(43738n);
    // Remise de 10 % arrondie séparément : 43,738 → 43,74
    const discounted = computeLine({
      quantity: '12.5',
      unitPrice: 3499n,
      discountPercent: '10',
      vatRegime: 'standard_21',
    });
    expect(discounted.allowanceAmount).toBe(4374n);
    expect(discounted.netAmount).toBe(39364n);
    const withAmount = computeLine({
      quantity: 1,
      unitPrice: 10000n,
      discountAmount: 500n,
      vatRegime: 'reduced_6',
    });
    expect(withAmount.netAmount).toBe(9500n);
  });

  it('TVA calculée par catégorie et taux sur la somme des nets, pas par ligne', () => {
    // Trois lignes à 0,33 € à 21 % : par ligne 0,07 × 3 = 0,21 ; par catégorie 0,99 × 21 % = 0,2079 → 0,21
    // Cas discriminant : 3 × 0,05 € à 21 % → par ligne 0,01 × 3 = 0,03 ; sur la somme 0,15 × 21 % = 0,0315 → 0,03
    // Cas discriminant 2 : 2 × 0,10 € à 6 % → par ligne 0,01 × 2 = 0,02 ; sur la somme 0,20 × 6 % = 0,012 → 0,01
    const totals = computeDocumentTotals([
      { quantity: 1, unitPrice: 10n, vatRegime: 'reduced_6' },
      { quantity: 1, unitPrice: 10n, vatRegime: 'reduced_6' },
    ]);
    expect(totals.vatBreakdown).toHaveLength(1);
    expect(totals.vatBreakdown[0]?.taxableAmount).toBe(20n);
    expect(totals.vatBreakdown[0]?.taxAmount).toBe(1n);
    expect(totals.totalVat).toBe(1n);
  });

  it('les totaux sont des sommes de valeurs déjà arrondies', () => {
    const totals = computeDocumentTotals(
      [
        { quantity: '3', unitPrice: 4590n, vatRegime: 'standard_21' },
        { quantity: '12.75', unitPrice: 2899n, vatRegime: 'reduced_6' },
        { quantity: '1', unitPrice: 140000n, vatRegime: 'reduced_6' },
        { quantity: '2', unitPrice: 50000n, vatRegime: 'reverse_charge' },
      ],
      { prepaidAmount: 10000n },
    );
    expect(totals.totalNet).toBe(sumCents(totals.lines.map((l) => l.netAmount)));
    expect(totals.totalVat).toBe(sumCents(totals.vatBreakdown.map((v) => v.taxAmount)));
    expect(totals.totalGross).toBe(totals.totalNet + totals.totalVat);
    expect(totals.amountDue).toBe(totals.totalGross - 10000n);
    expect(totals.hasReverseCharge).toBe(true);
    // Ordre : 21 %, 6 %, puis 0 % (AE)
    expect(totals.vatBreakdown.map((v) => v.ratePercent)).toEqual(['21', '6', '0']);
    const ae = totals.vatBreakdown.find((v) => v.category === 'AE');
    expect(ae?.taxAmount).toBe(0n);
  });

  it('propriété : 1 000 documents aléatoires, totaux cohérents et TVA par groupe', () => {
    const lineArb = fc.record({
      quantity: fc.integer({ min: 1, max: 1_000_000 }).map((n) => (n / 100).toFixed(2)),
      unitPrice: fc.bigInt({ min: 0n, max: 5_000_000n }),
      discountPercent: fc.option(fc.integer({ min: 0, max: 50 }).map(String), { nil: undefined }),
      vatRegime: fc.constantFrom(...VAT_REGIME_LIST),
    }) as fc.Arbitrary<TaxableLineInput>;
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 30 }), (lines) => {
        const t = computeDocumentTotals(lines);
        expect(t.totalGross).toBe(t.totalNet + t.totalVat);
        expect(sumCents(t.vatBreakdown.map((v) => v.taxableAmount))).toBe(t.totalNet);
        for (const v of t.vatBreakdown) {
          // La TVA d'un groupe ne dépend que de sa base : recalcul indépendant
          const again = computeVatBreakdown([{ netAmount: v.taxableAmount, vatRegime: v.regimes[0]! }]);
          expect(again[0]?.taxAmount).toBe(v.taxAmount);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('05 §3 — détermination automatique du régime de TVA', () => {
  const base = {
    customerKind: 'individual' as const,
    customerFilesPeriodicVatReturns: false,
    isImmovableWork: true,
    isPrivateDwelling: true,
  };

  it('travaux immobiliers pour un assujetti belge déposant → autoliquidation (AE)', () => {
    const r = determineVatRegime({ ...base, customerKind: 'company', customerFilesPeriodicVatReturns: true });
    expect(r.regime).toBe('reverse_charge');
    expect(vatRegimeInfo(r.regime).category).toBe('AE');
    expect(r.legalMentionKey).toBe('reverse_charge');
  });

  it('rénovation d’un logement privé de plus de 10 ans pour un particulier → 6 % avec attestation', () => {
    const r = determineVatRegime({ ...base, dwellingAgeYears: 35 });
    expect(r.regime).toBe('reduced_6');
    expect(r.requiresCertificate).toBe(true);
    expect(determineVatRegime({ ...base, dwellingAgeYears: 10 }).regime).toBe('reduced_6');
  });

  it('logement de moins de 10 ans, âge inconnu ou non résidentiel → 21 %', () => {
    expect(determineVatRegime({ ...base, dwellingAgeYears: 9 }).regime).toBe('standard_21');
    expect(determineVatRegime(base).regime).toBe('standard_21');
    expect(determineVatRegime({ ...base, isPrivateDwelling: false, dwellingAgeYears: 50 }).regime).toBe(
      'standard_21',
    );
  });

  it('entreprise non déposante (ex. ASBL, assujetti exonéré) → pas d’autoliquidation', () => {
    expect(
      determineVatRegime({
        ...base,
        customerKind: 'company',
        customerFilesPeriodicVatReturns: false,
        isPrivateDwelling: false,
      }).regime,
    ).toBe('standard_21');
  });

  it('assujetti étranger → intracommunautaire', () => {
    expect(
      determineVatRegime({
        ...base,
        customerKind: 'company',
        customerFilesPeriodicVatReturns: true,
        customerCountry: 'fr',
      }).regime,
    ).toBe('intra_community');
  });

  it('services hors travaux immobiliers → 21 %', () => {
    expect(
      determineVatRegime({
        ...base,
        customerKind: 'company',
        customerFilesPeriodicVatReturns: true,
        isImmovableWork: false,
      }).regime,
    ).toBe('standard_21');
  });

  it('sans attestation signée, le 6 % ne peut pas être émis', () => {
    const lines = [{ vatRegime: 'reduced_6' as const }, { vatRegime: 'standard_21' as const }];
    expect(vatIssuanceBlockers(lines, { reducedRateCertificateSigned: false })).toEqual([
      'reduced_rate_certificate_missing',
    ]);
    expect(vatIssuanceBlockers(lines, { reducedRateCertificateSigned: true })).toEqual([]);
  });

  it('forcer le régime exige une justification tracée (02 P2.5)', () => {
    expect(validateVatOverride({ suggested: 'reduced_6', chosen: 'reduced_6' })).toEqual({ ok: true });
    expect(validateVatOverride({ suggested: 'reduced_6', chosen: 'standard_21' })).toEqual({
      ok: false,
      error: 'justification_required',
    });
    expect(
      validateVatOverride({
        suggested: 'reduced_6',
        chosen: 'standard_21',
        justification: 'Logement de 8 ans',
      }),
    ).toEqual({ ok: true });
  });
});
