import { isValidEnterpriseNumber, normalizeEnterpriseNumber } from '@batimint/domain';
import type { VatValidationResult, VatValidator } from './types';

/** Registre fictif : quelques entreprises connues du seed, le reste est généré de façon déterministe. */
const KNOWN: Record<string, { name: string; street: string; postalCode: string; city: string }> = {
  '0123456749': {
    name: "Rénov'Habitat SRL",
    street: 'Rue de Montigny 112',
    postalCode: '6000',
    city: 'Charleroi',
  },
  '0417497106': {
    name: 'Brico Pro SA',
    street: 'Chaussée de Bruxelles 210',
    postalCode: '6040',
    city: 'Jumet',
  },
  '0456789034': {
    name: 'Électro Pirson SPRL',
    street: 'Rue du Pont 8',
    postalCode: '6200',
    city: 'Châtelet',
  },
};

export class MockVatValidator implements VatValidator {
  readonly provider = 'mock';

  async validate(vatNumber: string): Promise<VatValidationResult> {
    const n = normalizeEnterpriseNumber(vatNumber);
    const checkedAt = new Date();
    const formatted = n ? `BE${n}` : vatNumber;
    if (!n || !isValidEnterpriseNumber(n)) {
      return { vatNumber: formatted, valid: false, name: null, address: null, checkedAt, source: 'mock' };
    }
    const known = KNOWN[n];
    const company = known ?? {
      name: `Entreprise ${n.slice(4, 7)} SRL`,
      street: `Rue de l'Industrie ${Number(n.slice(7)) || 1}`,
      postalCode: '6000',
      city: 'Charleroi',
    };
    return {
      vatNumber: formatted,
      valid: true,
      name: company.name,
      address: {
        street: company.street,
        postalCode: company.postalCode,
        city: company.city,
        raw: `${company.street}, ${company.postalCode} ${company.city}`,
      },
      checkedAt,
      source: 'mock',
    };
  }
}
