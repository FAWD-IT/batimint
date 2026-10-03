import { describe, expect, it } from 'vitest';
import {
  buildInstallments,
  documentCompliance,
  documentValidity,
  hasThirtyBisDebt,
  isThirtyBisCheckFresh,
  subcontractCommitment,
  SubcontractingError,
  thirtyBisWithholding,
  worksDeclarationRequirement,
} from './subcontracting';

describe('retenue 30bis', () => {
  const clean = { hasSocialDebt: false, hasTaxDebt: false };

  it('ne retient rien sans dette', () => {
    expect(thirtyBisWithholding({ net: 1_000_000n, gross: 1_210_000n, check: clean })).toEqual({
      social: 0n,
      tax: 0n,
      total: 0n,
      payableToSubcontractor: 1_210_000n,
    });
    expect(hasThirtyBisDebt(clean)).toBe(false);
  });

  it('retient 35 % du HTVA pour une dette sociale et 15 % pour une dette fiscale', () => {
    const r = thirtyBisWithholding({
      net: 1_000_000n,
      gross: 1_000_000n,
      check: { hasSocialDebt: true, hasTaxDebt: true },
    });
    expect(r.social).toBe(350_000n);
    expect(r.tax).toBe(150_000n);
    expect(r.total).toBe(500_000n);
    expect(r.payableToSubcontractor).toBe(500_000n);
  });

  it('laisse la TVA au sous-traitant', () => {
    const r = thirtyBisWithholding({
      net: 1_000_000n,
      gross: 1_210_000n,
      check: { hasSocialDebt: true, hasTaxDebt: false },
    });
    expect(r.payableToSubcontractor).toBe(860_000n);
  });

  it('arrondit au centime, 0,5 s’éloignant de zéro', () => {
    const r = thirtyBisWithholding({
      net: 1n,
      gross: 1n,
      check: { hasSocialDebt: true, hasTaxDebt: true },
    });
    expect(r.social).toBe(0n);
    expect(
      thirtyBisWithholding({ net: 10n, gross: 10n, check: { hasSocialDebt: false, hasTaxDebt: true } }).tax,
    ).toBe(2n);
  });

  it('se limite au montant de la dette quand il est connu', () => {
    const r = thirtyBisWithholding({
      net: 1_000_000n,
      gross: 1_210_000n,
      check: { hasSocialDebt: true, hasTaxDebt: true, socialDebtAmount: 120_000n, taxDebtAmount: null },
    });
    expect(r.social).toBe(120_000n);
    expect(r.tax).toBe(150_000n);
  });

  it('suit une politique paramétrée', () => {
    const r = thirtyBisWithholding(
      { net: 100_000n, gross: 100_000n, check: { hasSocialDebt: true, hasTaxDebt: false } },
      { socialPercent: '30', taxPercent: '10' },
    );
    expect(r.social).toBe(30_000n);
  });

  it('refuse un montant négatif', () => {
    expect(() => thirtyBisWithholding({ net: -1n, gross: 0n, check: clean })).toThrow(SubcontractingError);
  });

  it('ne vaut que pour le jour de la consultation', () => {
    expect(isThirtyBisCheckFresh('2026-10-02', '2026-10-02')).toBe(true);
    expect(isThirtyBisCheckFresh('2026-10-01', '2026-10-02')).toBe(false);
    expect(isThirtyBisCheckFresh(null, '2026-10-02')).toBe(false);
  });
});

describe('documents du sous-traitant', () => {
  const today = '2026-10-02';

  it('classe la validité selon l’échéance', () => {
    expect(documentValidity(null, today)).toBe('valid');
    expect(documentValidity('2026-10-01', today)).toBe('expired');
    expect(documentValidity('2026-10-02', today)).toBe('expiring');
    expect(documentValidity('2026-11-01', today)).toBe('expiring');
    expect(documentValidity('2026-11-02', today)).toBe('valid');
  });

  it('retient le document qui expire le plus tard et signale les manques', () => {
    const r = documentCompliance(
      [
        { id: 'a', kind: 'rc_insurance', expiresOn: '2026-09-30' },
        { id: 'b', kind: 'rc_insurance', expiresOn: '2027-09-30' },
        { id: 'c', kind: 'social_certificate', expiresOn: '2026-09-01' },
      ],
      today,
    );
    expect(r.requirements).toEqual([
      { kind: 'rc_insurance', status: 'valid', expiresOn: '2027-09-30', documentId: 'b' },
      { kind: 'social_certificate', status: 'expired', expiresOn: '2026-09-01', documentId: 'c' },
      { kind: 'tax_certificate', status: 'missing', expiresOn: null, documentId: null },
    ]);
    expect(r.compliant).toBe(false);
    expect(r.issues).toBe(2);
  });

  it('un document sans échéance l’emporte', () => {
    const r = documentCompliance(
      [
        { id: 'a', kind: 'tax_certificate', expiresOn: '2027-01-01' },
        { id: 'b', kind: 'tax_certificate', expiresOn: null },
      ],
      today,
      ['tax_certificate'],
    );
    expect(r.requirements[0]!.documentId).toBe('b');
    expect(r.compliant).toBe(true);
  });

  it('un document qui expire bientôt reste conforme', () => {
    const r = documentCompliance([{ id: 'a', kind: 'rc_insurance', expiresOn: '2026-10-10' }], today, [
      'rc_insurance',
    ]);
    expect(r.requirements[0]!.status).toBe('expiring');
    expect(r.compliant).toBe(true);
  });
});

describe('déclaration de travaux', () => {
  it('requise dès 30 000 € HTVA', () => {
    expect(worksDeclarationRequirement({ contractAmount: 2_999_999n, subcontractorCount: 0 })).toEqual({
      required: false,
      reasons: [],
    });
    expect(
      worksDeclarationRequirement({ contractAmount: 3_000_000n, subcontractorCount: 0 }).reasons,
    ).toEqual(['amount']);
  });

  it('requise quel que soit le montant avec un sous-traitant', () => {
    expect(worksDeclarationRequirement({ contractAmount: 500_000n, subcontractorCount: 1 }).reasons).toEqual([
      'subcontractor',
    ]);
  });

  it('se base sur le chantier entier quand nous sommes sous-traitants', () => {
    expect(
      worksDeclarationRequirement({
        contractAmount: 1_000_000n,
        workplaceTotalAmount: 9_000_000n,
        subcontractorCount: 0,
      }).required,
    ).toBe(true);
  });
});

describe('échéancier du contrat', () => {
  it('répartit le montant sans perdre un centime', () => {
    const r = buildInstallments(1_000_001n, [
      { label: 'À la commande', percent: '30' },
      { label: 'Mi-parcours', percent: '30', dueOn: '2026-11-01' },
      { label: 'À la réception', percent: '40' },
    ]);
    expect(r.map((i) => i.amount)).toEqual([300_000n, 300_000n, 400_001n]);
    expect(r.reduce((s, i) => s + i.amount, 0n)).toBe(1_000_001n);
    expect(r[1]!.dueOn).toBe('2026-11-01');
  });

  it('un seul versement par défaut', () => {
    expect(buildInstallments(500n, [])).toEqual([
      { label: 'Paiement unique', percent: '100', amount: 500n, dueOn: null },
    ]);
  });

  it('refuse un échéancier qui ne fait pas 100 %', () => {
    expect(() => buildInstallments(100n, [{ label: 'a', percent: '50' }])).toThrow(/50 %/);
    expect(() => buildInstallments(100n, [{ label: 'a', percent: '0' }])).toThrow(SubcontractingError);
    expect(() => buildInstallments(0n, [])).toThrow(SubcontractingError);
  });

  it('nomme un versement sans libellé', () => {
    expect(buildInstallments(100n, [{ label: ' ', percent: '100' }])[0]!.label).toBe('Versement 1');
  });

  it('engagement restant', () => {
    expect(subcontractCommitment(1000n, 400n)).toBe(600n);
    expect(subcontractCommitment(1000n, 1200n)).toBe(0n);
  });
});
