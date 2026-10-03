export interface VatValidationResult {
  vatNumber: string;
  valid: boolean;
  name: string | null;
  address: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
    raw: string | null;
  } | null;
  checkedAt: Date;
  /** « unavailable » : VIES injoignable, le formulaire reste utilisable (07). */
  source: 'vies' | 'mock' | 'unavailable';
}

export interface VatValidator {
  readonly provider: string;
  validate(vatNumber: string): Promise<VatValidationResult>;
}
