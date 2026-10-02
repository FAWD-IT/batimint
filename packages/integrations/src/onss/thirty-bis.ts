/**
 * Article 30bis (05 §7, 07) : consultation des dettes sociales (ONSS) et fiscales (SPF Finances)
 * d'un sous-traitant, avant le contrat, à la réception de facture et avant chaque paiement.
 * L'accès logiciel aux services en ligne reste [à valider] : mock + preuve conservée.
 */

export interface ThirtyBisCheckResult {
  enterpriseNumber: string;
  hasSocialDebt: boolean;
  hasTaxDebt: boolean;
  /** Montants des dettes en centimes, quand le service les communique. */
  socialDebtAmount: bigint | null;
  taxDebtAmount: bigint | null;
  checkedAt: Date;
  /** Preuve de consultation : référence et réponse du service, à conserver. */
  proof: { reference: string; service: string; response: Record<string, unknown> };
}

export interface ThirtyBisChecker {
  readonly provider: string;
  check(enterpriseNumber: string): Promise<ThirtyBisCheckResult>;
}
