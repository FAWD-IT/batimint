/**
 * Identifiants belges : numéro d'entreprise (BCE), numéro de TVA, IBAN, identifiant Peppol (05 §1).
 */

/** Normalise une saisie (« BE 0123.456.749 », « 123456749 ») en 10 chiffres, ou null. */
export function normalizeEnterpriseNumber(input: string): string | null {
  let digits = input.toUpperCase().replace(/^BE/, '').replace(/[^\d]/g, '');
  if (digits.length === 9) digits = `0${digits}`;
  return digits.length === 10 ? digits : null;
}

/** Contrôle modulo 97 du numéro d'entreprise : 97 − (8 premiers chiffres mod 97) = 2 derniers. */
export function isValidEnterpriseNumber(input: string): boolean {
  const n = normalizeEnterpriseNumber(input);
  if (!n || !/^[01]/.test(n)) return false;
  const base = Number(n.slice(0, 8));
  const check = Number(n.slice(8));
  return 97 - (base % 97) === check;
}

/** Format affiché « 0123.456.749 ». */
export function formatEnterpriseNumber(input: string): string {
  const n = normalizeEnterpriseNumber(input);
  if (!n) return input;
  return `${n.slice(0, 4)}.${n.slice(4, 7)}.${n.slice(7)}`;
}

/** Numéro de TVA belge « BE0123456749 » à partir du numéro d'entreprise. */
export function vatNumberFromEnterpriseNumber(input: string): string | null {
  const n = normalizeEnterpriseNumber(input);
  return n ? `BE${n}` : null;
}

/** Identifiant Peppol d'un participant belge : schéma 0208 + numéro BCE (05 §1). */
export function belgianPeppolId(enterpriseNumber: string): { scheme: '0208'; id: string } | null {
  const n = normalizeEnterpriseNumber(enterpriseNumber);
  return n ? { scheme: '0208', id: n } : null;
}

/** Normalise un IBAN (majuscules, sans espaces). */
export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/** Validation ISO 13616 (mod 97 = 1). */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('BE') && iban.length !== 16) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  const numeric = rearranged.replace(/[A-Z]/g, (c) => (c.charCodeAt(0) - 55).toString());
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}

/** Format affiché par groupes de 4. */
export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})/g, '$1 ').trim();
}

export function isValidBic(input: string): boolean {
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(input.replace(/\s+/g, '').toUpperCase());
}
