import { describe, expect, it } from 'vitest';
import {
  belgianPeppolId,
  formatEnterpriseNumber,
  formatIban,
  isValidBic,
  isValidEnterpriseNumber,
  isValidIban,
  normalizeEnterpriseNumber,
  vatNumberFromEnterpriseNumber,
} from './belgium';

describe('identifiants belges', () => {
  it('normalise et valide le numéro d’entreprise (mod 97)', () => {
    expect(normalizeEnterpriseNumber('BE 0123.456.749')).toBe('0123456749');
    expect(normalizeEnterpriseNumber('123456749')).toBe('0123456749');
    expect(normalizeEnterpriseNumber('12')).toBeNull();
    expect(isValidEnterpriseNumber('0123.456.749')).toBe(true);
    expect(isValidEnterpriseNumber('0123.456.748')).toBe(false);
    expect(isValidEnterpriseNumber('2123456749')).toBe(false);
    expect(isValidEnterpriseNumber('abc')).toBe(false);
    expect(formatEnterpriseNumber('BE0123456749')).toBe('0123.456.749');
    expect(formatEnterpriseNumber('x')).toBe('x');
  });

  it('dérive TVA et identifiant Peppol (schéma 0208, 05 §1)', () => {
    expect(vatNumberFromEnterpriseNumber('0123.456.749')).toBe('BE0123456749');
    expect(vatNumberFromEnterpriseNumber('1')).toBeNull();
    expect(belgianPeppolId('BE0123456749')).toEqual({ scheme: '0208', id: '0123456749' });
    expect(belgianPeppolId('?')).toBeNull();
  });

  it('valide les IBAN et BIC', () => {
    expect(isValidIban('BE68 5390 0754 7034')).toBe(true);
    expect(isValidIban('BE68 5390 0754 7035')).toBe(false);
    expect(isValidIban('BE68539007547')).toBe(false);
    expect(isValidIban('FR1420041010050500013M02606')).toBe(true);
    expect(formatIban('be68539007547034')).toBe('BE68 5390 0754 7034');
    expect(isValidBic('GEBABEBB')).toBe(true);
    expect(isValidBic('GEBABEBB36A')).toBe(true);
    expect(isValidBic('GEB')).toBe(false);
  });
});
