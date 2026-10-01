/**
 * TVA belge et calcul des totaux selon EN 16931 (docs/05 §3 et §4).
 *
 * §4 : montant net de ligne = quantité × prix unitaire − remise, arrondi à 2 décimales ;
 *      TVA par catégorie et taux sur la somme des nets, arrondie à 2 décimales ;
 *      totaux = sommes de valeurs déjà arrondies.
 */
import { type Cents, Dec, dec, type DecimalInput, percentOf, roundHalfAwayFromZero, sumCents } from './money';

/** Codes de catégorie TVA UNCL5305 utilisés par Peppol BIS Billing 3.0. */
export type VatCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O';

/** Régime de TVA d'une ligne, tel que l'utilisateur le voit. */
export type VatRegime =
  | 'standard_21'
  | 'intermediate_12'
  | 'reduced_6'
  | 'zero'
  | 'reverse_charge'
  | 'exempt'
  | 'intra_community'
  | 'export';

export interface VatRegimeInfo {
  regime: VatRegime;
  category: VatCategory;
  /** Taux en pourcentage, ex. "21". */
  ratePercent: string;
}

export const VAT_REGIMES: Record<VatRegime, VatRegimeInfo> = {
  standard_21: { regime: 'standard_21', category: 'S', ratePercent: '21' },
  intermediate_12: { regime: 'intermediate_12', category: 'S', ratePercent: '12' },
  reduced_6: { regime: 'reduced_6', category: 'S', ratePercent: '6' },
  zero: { regime: 'zero', category: 'Z', ratePercent: '0' },
  reverse_charge: { regime: 'reverse_charge', category: 'AE', ratePercent: '0' },
  exempt: { regime: 'exempt', category: 'E', ratePercent: '0' },
  intra_community: { regime: 'intra_community', category: 'K', ratePercent: '0' },
  export: { regime: 'export', category: 'G', ratePercent: '0' },
};

export const VAT_REGIME_LIST = Object.keys(VAT_REGIMES) as VatRegime[];

export function vatRegimeInfo(regime: VatRegime): VatRegimeInfo {
  return VAT_REGIMES[regime];
}

/** Ligne de document vue par le calcul fiscal. */
export interface TaxableLineInput {
  quantity: DecimalInput;
  unitPrice: Cents;
  /** Remise de ligne en pourcentage (ex. "10" pour 10 %). */
  discountPercent?: DecimalInput;
  /** Remise de ligne en montant absolu (centimes), cumulable avec le pourcentage. */
  discountAmount?: Cents;
  vatRegime: VatRegime;
}

export interface ComputedLine {
  /** quantité × prix unitaire, arrondi au centime. */
  grossAmount: Cents;
  /** Remise totale de la ligne (déjà arrondie). */
  allowanceAmount: Cents;
  /** Montant net HTVA de la ligne. */
  netAmount: Cents;
  vatRegime: VatRegime;
}

/** 05 §4 — net de ligne = quantité × PU − remise, arrondi à 2 décimales. */
export function computeLine(line: TaxableLineInput): ComputedLine {
  const exactGross = dec(line.quantity).times(new Dec(line.unitPrice.toString()));
  const grossAmount = roundHalfAwayFromZero(exactGross);
  let allowanceAmount = 0n;
  if (line.discountPercent !== undefined && !dec(line.discountPercent).isZero()) {
    allowanceAmount += percentOf(grossAmount, line.discountPercent);
  }
  if (line.discountAmount) allowanceAmount += line.discountAmount;
  return {
    grossAmount,
    allowanceAmount,
    netAmount: grossAmount - allowanceAmount,
    vatRegime: line.vatRegime,
  };
}

export interface VatBreakdownEntry {
  category: VatCategory;
  ratePercent: string;
  /** Régimes regroupés dans cette entrée (ex. plusieurs régimes AE). */
  regimes: VatRegime[];
  taxableAmount: Cents;
  taxAmount: Cents;
}

/** 05 §4 — TVA calculée par catégorie et taux sur la somme des nets, arrondie à 2 décimales. */
export function computeVatBreakdown(
  lines: readonly { netAmount: Cents; vatRegime: VatRegime }[],
): VatBreakdownEntry[] {
  const groups = new Map<string, VatBreakdownEntry>();
  for (const line of lines) {
    const info = VAT_REGIMES[line.vatRegime];
    const key = `${info.category}|${info.ratePercent}`;
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        category: info.category,
        ratePercent: info.ratePercent,
        regimes: [],
        taxableAmount: 0n,
        taxAmount: 0n,
      };
      groups.set(key, entry);
    }
    if (!entry.regimes.includes(line.vatRegime)) entry.regimes.push(line.vatRegime);
    entry.taxableAmount += line.netAmount;
  }
  const result = [...groups.values()];
  for (const entry of result) {
    entry.taxAmount = percentOf(entry.taxableAmount, entry.ratePercent);
  }
  // Ordre stable : taux décroissant puis catégorie.
  result.sort((a, b) => {
    const diff = dec(b.ratePercent).comparedTo(dec(a.ratePercent));
    return diff !== 0 ? diff : a.category.localeCompare(b.category);
  });
  return result;
}

export interface DocumentTotals {
  lines: ComputedLine[];
  vatBreakdown: VatBreakdownEntry[];
  /** Somme des nets de ligne (EN 16931 BT-106). */
  totalNet: Cents;
  /** Somme des TVA par catégorie (BT-110). */
  totalVat: Cents;
  /** Total TVAC (BT-112). */
  totalGross: Cents;
  /** Montant déjà payé (acomptes) (BT-113). */
  prepaidAmount: Cents;
  /** Montant à payer (BT-115). */
  amountDue: Cents;
  /** Vrai si au moins une ligne est en autoliquidation. */
  hasReverseCharge: boolean;
}

/**
 * 05 §4 — totaux du document. Les mêmes fonctions servent pour l'écran, le PDF et l'UBL.
 */
export function computeDocumentTotals(
  lines: readonly TaxableLineInput[],
  options: { prepaidAmount?: Cents } = {},
): DocumentTotals {
  const computed = lines.map(computeLine);
  const vatBreakdown = computeVatBreakdown(computed);
  const totalNet = sumCents(computed.map((l) => l.netAmount));
  const totalVat = sumCents(vatBreakdown.map((v) => v.taxAmount));
  const totalGross = totalNet + totalVat;
  const prepaidAmount = options.prepaidAmount ?? 0n;
  return {
    lines: computed,
    vatBreakdown,
    totalNet,
    totalVat,
    totalGross,
    prepaidAmount,
    amountDue: totalGross - prepaidAmount,
    hasReverseCharge: computed.some((l) => VAT_REGIMES[l.vatRegime].category === 'AE'),
  };
}

// ---------------------------------------------------------------------------
// Détermination automatique du régime (05 §3)
// ---------------------------------------------------------------------------

export interface VatContext {
  customerKind: 'individual' | 'company';
  /** Assujetti belge déposant des déclarations périodiques. */
  customerFilesPeriodicVatReturns: boolean;
  /** Pays du client (ISO 3166-1 alpha-2). */
  customerCountry?: string;
  /** Prestation = travaux immobiliers (au sens TVA). */
  isImmovableWork: boolean;
  /** Bâtiment = logement privé. */
  isPrivateDwelling: boolean;
  /** Âge du logement (années depuis la première occupation). */
  dwellingAgeYears?: number;
  /** Le client final est le consommateur final (et non un promoteur, etc.). */
  billedToFinalConsumer?: boolean;
}

export interface VatDetermination {
  regime: VatRegime;
  /** Raison lisible (clé i18n) pour l'interface et l'audit. */
  reason:
    | 'reverse_charge_immovable_work'
    | 'renovation_dwelling_over_10_years'
    | 'intra_community_service'
    | 'default_standard';
  /** Le 6 % exige une attestation signée du client (05 §3). */
  requiresCertificate: boolean;
  /** Mention légale à porter sur le document (paramétrable, [à valider]). */
  legalMentionKey?: 'reverse_charge' | 'reduced_rate_certificate';
}

/** Âge minimum d'un logement pour le taux réduit de 6 % en rénovation (05 §3). */
export const RENOVATION_MIN_DWELLING_AGE_YEARS = 10;

/**
 * 05 §3 — détermine le régime par défaut d'une prestation.
 *  1. Travaux immobiliers pour un assujetti belge déposant → autoliquidation (AE).
 *  2. Rénovation d'un logement privé de plus de 10 ans facturée au consommateur final → 6 % avec attestation.
 *  3. Sinon 21 %.
 */
export function determineVatRegime(ctx: VatContext): VatDetermination {
  const country = (ctx.customerCountry ?? 'BE').toUpperCase();
  if (ctx.customerKind === 'company' && country !== 'BE' && ctx.customerFilesPeriodicVatReturns) {
    return { regime: 'intra_community', reason: 'intra_community_service', requiresCertificate: false };
  }
  if (ctx.isImmovableWork && ctx.customerKind === 'company' && ctx.customerFilesPeriodicVatReturns) {
    return {
      regime: 'reverse_charge',
      reason: 'reverse_charge_immovable_work',
      requiresCertificate: false,
      legalMentionKey: 'reverse_charge',
    };
  }
  if (
    ctx.isImmovableWork &&
    ctx.isPrivateDwelling &&
    (ctx.billedToFinalConsumer ?? ctx.customerKind === 'individual') &&
    ctx.dwellingAgeYears !== undefined &&
    ctx.dwellingAgeYears >= RENOVATION_MIN_DWELLING_AGE_YEARS
  ) {
    return {
      regime: 'reduced_6',
      reason: 'renovation_dwelling_over_10_years',
      requiresCertificate: true,
      legalMentionKey: 'reduced_rate_certificate',
    };
  }
  return { regime: 'standard_21', reason: 'default_standard', requiresCertificate: false };
}

/**
 * 05 §3 — sans attestation signée, le 6 % ne peut pas être émis.
 * Renvoie la liste des problèmes bloquant l'émission.
 */
export function vatIssuanceBlockers(
  lines: readonly { vatRegime: VatRegime }[],
  ctx: { reducedRateCertificateSigned: boolean },
): Array<'reduced_rate_certificate_missing'> {
  const blockers: Array<'reduced_rate_certificate_missing'> = [];
  if (lines.some((l) => l.vatRegime === 'reduced_6') && !ctx.reducedRateCertificateSigned) {
    blockers.push('reduced_rate_certificate_missing');
  }
  return blockers;
}

/** Vérifie qu'un forçage manuel de régime est accompagné d'une justification (traçabilité, 02 P2.5). */
export function validateVatOverride(input: {
  suggested: VatRegime;
  chosen: VatRegime;
  justification?: string | null;
}): { ok: true } | { ok: false; error: 'justification_required' } {
  if (input.suggested === input.chosen) return { ok: true };
  if (!input.justification || input.justification.trim().length < 5) {
    return { ok: false, error: 'justification_required' };
  }
  return { ok: true };
}
