/**
 * Communication structurée belge (05 §5) :
 * 10 chiffres de base + 2 chiffres de contrôle = base mod 97 (97 si le reste vaut 0),
 * au format +++123/4567/89012+++.
 */

export class StructuredCommunicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredCommunicationError';
  }
}

export function structuredCommunicationCheckDigits(base: string): string {
  if (!/^\d{10}$/.test(base)) throw new StructuredCommunicationError('La base doit compter exactement 10 chiffres.');
  const remainder = Number(BigInt(base) % 97n);
  return (remainder === 0 ? 97 : remainder).toString().padStart(2, '0');
}

/** Chaîne de 12 chiffres (base + contrôle). */
export function structuredCommunicationDigits(base: string): string {
  return `${base}${structuredCommunicationCheckDigits(base)}`;
}

/** Format affiché « +++123/4567/89012+++ ». */
export function formatStructuredCommunication(digits12: string): string {
  if (!/^\d{12}$/.test(digits12)) throw new StructuredCommunicationError('12 chiffres attendus.');
  return `+++${digits12.slice(0, 3)}/${digits12.slice(3, 7)}/${digits12.slice(7)}+++`;
}

/** Extrait les 12 chiffres d'une saisie libre (« +++123/4567/89012+++ », « ***…*** », espaces). */
export function normalizeStructuredCommunication(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  return digits.length === 12 ? digits : null;
}

export function isValidStructuredCommunication(input: string): boolean {
  const digits = normalizeStructuredCommunication(input);
  if (!digits) return false;
  const base = digits.slice(0, 10);
  return structuredCommunicationCheckDigits(base) === digits.slice(10);
}

/**
 * Construit la communication d'une facture : préfixe tenant (3 chiffres) + année (2) + séquence (5).
 * Ex. préfixe 104, année 2026, séquence 118 → base 1042600118.
 */
export function buildInvoiceStructuredCommunication(input: {
  tenantPrefix: number;
  year: number;
  sequence: number;
}): { digits: string; formatted: string } {
  const { tenantPrefix, year, sequence } = input;
  if (!Number.isInteger(tenantPrefix) || tenantPrefix < 0 || tenantPrefix > 999) {
    throw new StructuredCommunicationError('Préfixe tenant hors limites (0–999).');
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 99_999) {
    throw new StructuredCommunicationError('Séquence hors limites (0–99 999).');
  }
  const base = `${tenantPrefix.toString().padStart(3, '0')}${(year % 100).toString().padStart(2, '0')}${sequence
    .toString()
    .padStart(5, '0')}`;
  const digits = structuredCommunicationDigits(base);
  return { digits, formatted: formatStructuredCommunication(digits) };
}
