import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  buildInvoiceStructuredCommunication,
  formatStructuredCommunication,
  isValidStructuredCommunication,
  normalizeStructuredCommunication,
  StructuredCommunicationError,
  structuredCommunicationCheckDigits,
  structuredCommunicationDigits,
} from './structured-communication';

describe('05 §5 — communication structurée belge', () => {
  it('contrôle = base mod 97', () => {
    // 0123456789 mod 97 = 39
    expect(structuredCommunicationCheckDigits('0123456789')).toBe('39');
    expect(formatStructuredCommunication(structuredCommunicationDigits('0123456789'))).toBe('+++012/3456/78939+++');
  });

  it('97 si le reste vaut 0', () => {
    // 0000000097 mod 97 = 0 → 97
    expect(structuredCommunicationCheckDigits('0000000097')).toBe('97');
    expect(structuredCommunicationCheckDigits('0000000000')).toBe('97');
  });

  it('refuse une base qui ne compte pas 10 chiffres', () => {
    expect(() => structuredCommunicationCheckDigits('123')).toThrow(StructuredCommunicationError);
    expect(() => formatStructuredCommunication('123')).toThrow(StructuredCommunicationError);
  });

  it('valide une saisie libre', () => {
    expect(isValidStructuredCommunication('+++012/3456/78939+++')).toBe(true);
    expect(isValidStructuredCommunication('***012/3456/78939***')).toBe(true);
    expect(isValidStructuredCommunication('012 3456 78938')).toBe(false);
    expect(isValidStructuredCommunication('hello')).toBe(false);
    expect(normalizeStructuredCommunication('+++012/3456/78939+++')).toBe('012345678939');
  });

  it('propriété : toute communication générée est valide', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 0, max: 99_999 }), (p, y, s) => {
        const { formatted } = buildInvoiceStructuredCommunication({ tenantPrefix: p, year: y, sequence: s });
        expect(isValidStructuredCommunication(formatted)).toBe(true);
      }),
    );
  });

  it('construit la communication d’une facture', () => {
    const r = buildInvoiceStructuredCommunication({ tenantPrefix: 104, year: 2026, sequence: 118 });
    expect(r.digits.slice(0, 10)).toBe('1042600118');
    expect(r.formatted).toMatch(/^\+\+\+104\/2600\/118\d{2}\+\+\+$/);
    expect(() => buildInvoiceStructuredCommunication({ tenantPrefix: 1000, year: 2026, sequence: 1 })).toThrow();
    expect(() => buildInvoiceStructuredCommunication({ tenantPrefix: 1, year: 2026, sequence: 100_000 })).toThrow();
  });
});
