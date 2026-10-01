import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  absCents,
  allocateProRata,
  cents,
  centsToDecimalString,
  centsToEuros,
  dec,
  eurosToCents,
  formatEuros,
  maxCents,
  minCents,
  MoneyError,
  multiplyCents,
  percentOf,
  ratio,
  roundHalfAwayFromZero,
  sumCents,
} from './money';

describe('money — centimes entiers (CLAUDE.md règle n°2)', () => {
  it('construit des centimes uniquement à partir d’entiers', () => {
    expect(cents(1234)).toBe(1234n);
    expect(cents('-42')).toBe(-42n);
    expect(cents(7n)).toBe(7n);
    expect(() => cents(12.5)).toThrow(MoneyError);
    expect(() => cents('12.5')).toThrow(MoneyError);
  });

  it('convertit des euros saisis à la belge', () => {
    expect(eurosToCents('1234,56')).toBe(123456n);
    expect(eurosToCents('12.345')).toBe(1235n);
    expect(eurosToCents('12.344')).toBe(1234n);
    expect(eurosToCents(' 1 400 ')).toBe(140000n);
    expect(eurosToCents(0.1 + 0.2)).toBe(30n);
    expect(() => eurosToCents('abc')).toThrow(MoneyError);
    expect(() => dec(Number.NaN)).toThrow(MoneyError);
  });

  it('arrondit 0,5 en s’éloignant de zéro (05 §4)', () => {
    expect(roundHalfAwayFromZero('2.5')).toBe(3n);
    expect(roundHalfAwayFromZero('-2.5')).toBe(-3n);
    expect(roundHalfAwayFromZero('2.4999')).toBe(2n);
    expect(eurosToCents('-0.005')).toBe(-1n);
  });

  it('formate les montants exactement, même très grands', () => {
    expect(formatEuros(123456n)).toBe('1 234,56 €');
    expect(formatEuros(-5n)).toBe('−0,05 €');
    expect(formatEuros(123456789012345678n, { withSymbol: false })).toBe(
      '1 234 567 890 123 456,78',
    );
    expect(formatEuros(4_812_350n, { decimals: false })).toBe('48 124 €');
    expect(centsToDecimalString(-123456n)).toBe('-1234.56');
    expect(centsToDecimalString(5n)).toBe('0.05');
    expect(centsToEuros(150n).toString()).toBe('1.5');
  });

  it('multiplie et calcule des pourcentages au centime près', () => {
    expect(multiplyCents(1000n, '1.35')).toBe(1350n);
    expect(multiplyCents(333n, '0.5')).toBe(167n);
    expect(percentOf(10000n, '21')).toBe(2100n);
    expect(percentOf(1n, '50')).toBe(1n);
  });

  it('fournit min, max, abs, somme et ratio', () => {
    expect(maxCents(1n, 2n)).toBe(2n);
    expect(minCents(1n, 2n)).toBe(1n);
    expect(absCents(-3n)).toBe(3n);
    expect(sumCents([1n, 2n, 3n])).toBe(6n);
    expect(ratio(1n, 4n)?.toString()).toBe('0.25');
    expect(ratio(1n, 0n)).toBeNull();
  });

  it('répartit au prorata sans perdre un centime (propriété)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
        fc.array(fc.bigInt({ min: 0n, max: 1_000_000n }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocateProRata(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(sumCents(parts)).toBe(total);
        },
      ),
    );
    expect(allocateProRata(100n, [])).toEqual([]);
    expect(allocateProRata(10n, [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
    expect(allocateProRata(10n, [0n, 0n])).toEqual([5n, 5n]);
  });
});
