import { describe, expect, it } from 'vitest';
import { formatPercent, formatQuantity, quantity, quantityToString, rate } from './quantity';

describe('quantités et taux décimaux', () => {
  it('limite les quantités à 4 décimales (numeric(14,4))', () => {
    expect(quantityToString('12.34567')).toBe('12.3457');
    expect(quantity('1,5').toString()).toBe('1.5');
    expect(rate('0.123456').toString()).toBe('0.1235');
  });

  it('formate à la belge', () => {
    expect(formatQuantity('1234.5')).toBe('1 234,5');
    expect(formatQuantity('-2')).toBe('−2');
    expect(formatPercent('0.218')).toBe('21,8 %');
    expect(formatPercent('0.24')).toBe('24 %');
    expect(formatPercent('-0.05')).toBe('−5 %');
  });
});
