/** CRM (03 §2) : nom affiché, dédoublonnage, pipeline d'opportunités. */
import { normalizeEnterpriseNumber } from './belgium';

export const OPPORTUNITY_STAGES = ['new', 'visit_planned', 'quoting', 'sent', 'won', 'lost'] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export function customerDisplayName(c: {
  kind: 'individual' | 'company';
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
}): string {
  if (c.kind === 'company')
    return (c.companyName ?? '').trim() || [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || (c.companyName ?? '').trim();
}

export interface DedupCandidate {
  id: string;
  email?: string | null;
  vatNumber?: string | null;
  enterpriseNumber?: string | null;
  phone?: string | null;
}

function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  let d = p.replace(/[^\d+]/g, '');
  if (d.startsWith('0032')) d = `+32${d.slice(4)}`;
  else if (d.startsWith('0') && !d.startsWith('00')) d = `+32${d.slice(1)}`;
  return d.length >= 9 ? d : null;
}

/**
 * 03 §2 — doublons probables : même TVA/BCE, même e-mail ou même téléphone.
 * Renvoie les identifiants des candidats et la raison.
 */
export function findDuplicates(
  input: Omit<DedupCandidate, 'id'>,
  candidates: readonly DedupCandidate[],
): { id: string; reason: 'vat' | 'email' | 'phone' }[] {
  const vat = normalizeEnterpriseNumber(input.vatNumber ?? input.enterpriseNumber ?? '') ?? null;
  const email = input.email?.trim().toLowerCase() || null;
  const phone = normPhone(input.phone);
  const out: { id: string; reason: 'vat' | 'email' | 'phone' }[] = [];
  for (const c of candidates) {
    const cVat = normalizeEnterpriseNumber(c.vatNumber ?? c.enterpriseNumber ?? '');
    if (vat && cVat && vat === cVat) out.push({ id: c.id, reason: 'vat' });
    else if (email && c.email?.trim().toLowerCase() === email) out.push({ id: c.id, reason: 'email' });
    else if (phone && normPhone(c.phone) === phone) out.push({ id: c.id, reason: 'phone' });
  }
  return out;
}

/** Âge du logement à partir de l'année de première occupation (critère du 6 %, 05 §3). */
export function dwellingAge(
  firstOccupancyYear: number | null | undefined,
  now: Date = new Date(),
): number | undefined {
  if (!firstOccupancyYear) return undefined;
  return now.getFullYear() - firstOccupancyYear;
}

/** Score anti-spam simple d'une demande web (honeypot, liens, délai de saisie). */
export function leadSpamScore(input: {
  honeypot?: string | null;
  message?: string | null;
  fillMs?: number | null;
}): number {
  let score = 0;
  if (input.honeypot) score += 100;
  const links = (input.message?.match(/https?:\/\//g) ?? []).length;
  score += links * 20;
  if (input.fillMs !== null && input.fillMs !== undefined && input.fillMs < 2500) score += 40;
  return score;
}
