import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkSequenceContinuity,
  DEFAULT_NUMBER_PATTERNS,
  formatDocumentNumber,
  isValidNumberPattern,
  NumberingError,
} from './numbering';

describe('05 §2 — numérotation continue par série et par année', () => {
  it('formate selon le modèle', () => {
    expect(formatDocumentNumber(DEFAULT_NUMBER_PATTERNS.invoice, { year: 2026, sequence: 118 })).toBe('2026-118');
    expect(formatDocumentNumber(DEFAULT_NUMBER_PATTERNS.quote, { year: 2026, sequence: 7 })).toBe('D2026-007');
    expect(formatDocumentNumber('F{YY}/{SEQ:5}', { year: 2027, sequence: 42 })).toBe('F27/00042');
    expect(formatDocumentNumber('{SEQ}', { year: 2027, sequence: 1234 })).toBe('1234');
  });

  it('refuse une séquence invalide ou un modèle sans {SEQ}', () => {
    expect(() => formatDocumentNumber('{YYYY}', { year: 2026, sequence: 1 })).toThrow(NumberingError);
    expect(() => formatDocumentNumber('{SEQ}', { year: 2026, sequence: 0 })).toThrow(NumberingError);
  });

  it('valide les modèles saisis', () => {
    expect(isValidNumberPattern('FA-{YYYY}-{SEQ:4}')).toBe(true);
    expect(isValidNumberPattern('FA {SEQ}')).toBe(false);
    expect(isValidNumberPattern('{YYYY}')).toBe(false);
    expect(isValidNumberPattern('')).toBe(false);
  });

  it('détecte trous et doublons', () => {
    expect(checkSequenceContinuity([1, 2, 3])).toEqual({ ok: true, gaps: [], duplicates: [] });
    expect(checkSequenceContinuity([3, 1, 5, 5])).toEqual({ ok: false, gaps: [2, 4], duplicates: [5] });
    expect(checkSequenceContinuity([])).toEqual({ ok: true, gaps: [], duplicates: [] });
  });

  it('propriété : une permutation de 1..n est continue', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (n) => {
        const seq = Array.from({ length: n }, (_, i) => i + 1).reverse();
        expect(checkSequenceContinuity(seq).ok).toBe(true);
      }),
    );
  });
});
