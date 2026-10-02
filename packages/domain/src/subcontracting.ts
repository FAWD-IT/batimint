/**
 * Sous-traitance (03 §9, 05 §7) : retenue 30bis, validité des documents obligatoires,
 * déclaration de travaux et échéancier des contrats. Logique pure, sans I/O.
 */
import { type IsoDate, addDays } from './calendar';
import { type Cents, type DecimalInput, dec, minCents, percentOf, sumCents } from './money';

export class SubcontractingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SubcontractingError';
  }
}

/** Taux de retenue 30bis (05 §7) **[à valider]** : social 35 %, fiscal 15 % du HTVA. */
export interface ThirtyBisPolicy {
  socialPercent: string;
  taxPercent: string;
}

export const DEFAULT_THIRTY_BIS_POLICY: ThirtyBisPolicy = { socialPercent: '35', taxPercent: '15' };

/** Résultat d'une consultation 30bis (montants des dettes en centimes quand ils sont connus). */
export interface ThirtyBisResult {
  hasSocialDebt: boolean;
  hasTaxDebt: boolean;
  socialDebtAmount?: Cents | null;
  taxDebtAmount?: Cents | null;
}

export interface ThirtyBisWithholding {
  social: Cents;
  tax: Cents;
  total: Cents;
  /** Ce qui est versé au sous-traitant (TVAC − retenues). */
  payableToSubcontractor: Cents;
}

/**
 * Retenue 30bis sur un paiement : un pourcentage du montant HTVA facturé, versé à l'ONSS
 * (dettes sociales) et au SPF Finances (dettes fiscales), limité au montant de la dette quand
 * celui-ci est connu. La TVA reste due au sous-traitant.
 */
export function thirtyBisWithholding(
  input: { net: Cents; gross: Cents; check: ThirtyBisResult },
  policy: ThirtyBisPolicy = DEFAULT_THIRTY_BIS_POLICY,
): ThirtyBisWithholding {
  if (input.net < 0n || input.gross < 0n)
    throw new SubcontractingError('negative_amount', 'Une retenue ne se calcule pas sur un montant négatif.');
  const cap = (amount: Cents, debt: Cents | null | undefined) =>
    debt !== null && debt !== undefined ? minCents(amount, debt < 0n ? 0n : debt) : amount;
  const social = input.check.hasSocialDebt
    ? cap(percentOf(input.net, policy.socialPercent), input.check.socialDebtAmount)
    : 0n;
  const tax = input.check.hasTaxDebt
    ? cap(percentOf(input.net, policy.taxPercent), input.check.taxDebtAmount)
    : 0n;
  const total = social + tax;
  return { social, tax, total, payableToSubcontractor: input.gross - total };
}

export function hasThirtyBisDebt(check: ThirtyBisResult): boolean {
  return check.hasSocialDebt || check.hasTaxDebt;
}

/** Une consultation vaut pour le jour où elle a été faite (« avant chaque paiement »). */
export function isThirtyBisCheckFresh(checkedOn: IsoDate | null, today: IsoDate): boolean {
  return checkedOn === today;
}

/* -------------------------------------------------------------------------------------------- */
/* Documents obligatoires                                                                       */

export const SUBCONTRACTOR_DOCUMENT_KINDS = [
  'rc_insurance',
  'social_certificate',
  'tax_certificate',
  'access_certificate',
  'other',
] as const;
export type SubcontractorDocumentKind = (typeof SUBCONTRACTOR_DOCUMENT_KINDS)[number];

/** Documents exigés par défaut d'un sous-traitant (paramétrables par tenant). */
export const DEFAULT_REQUIRED_DOCUMENTS: readonly SubcontractorDocumentKind[] = [
  'rc_insurance',
  'social_certificate',
  'tax_certificate',
];

export type DocumentValidity = 'valid' | 'expiring' | 'expired' | 'missing';

/** Alerte d'expiration : 30 jours avant l'échéance. */
export const DOCUMENT_EXPIRY_WARNING_DAYS = 30;

export function documentValidity(
  expiresOn: IsoDate | null | undefined,
  today: IsoDate,
  warningDays = DOCUMENT_EXPIRY_WARNING_DAYS,
): Exclude<DocumentValidity, 'missing'> {
  if (!expiresOn) return 'valid';
  if (expiresOn < today) return 'expired';
  if (expiresOn <= addDays(today, warningDays)) return 'expiring';
  return 'valid';
}

export interface DocumentRequirement {
  kind: SubcontractorDocumentKind;
  status: DocumentValidity;
  expiresOn: IsoDate | null;
  documentId: string | null;
}

/**
 * État de chaque document exigé : on retient, par type, le document qui expire le plus tard.
 * `compliant` = aucun document manquant ni expiré.
 */
export function documentCompliance(
  documents: readonly { id: string; kind: SubcontractorDocumentKind; expiresOn: IsoDate | null }[],
  today: IsoDate,
  required: readonly SubcontractorDocumentKind[] = DEFAULT_REQUIRED_DOCUMENTS,
): { requirements: DocumentRequirement[]; compliant: boolean; issues: number } {
  const requirements = required.map((kind): DocumentRequirement => {
    const candidates = documents.filter((d) => d.kind === kind);
    if (candidates.length === 0) return { kind, status: 'missing', expiresOn: null, documentId: null };
    const best = [...candidates].sort((a, b) => {
      if (a.expiresOn === b.expiresOn) return 0;
      if (a.expiresOn === null) return -1;
      if (b.expiresOn === null) return 1;
      return a.expiresOn > b.expiresOn ? -1 : 1;
    })[0]!;
    return {
      kind,
      status: documentValidity(best.expiresOn, today),
      expiresOn: best.expiresOn,
      documentId: best.id,
    };
  });
  const issues = requirements.filter((r) => r.status === 'missing' || r.status === 'expired').length;
  return { requirements, compliant: issues === 0, issues };
}

/* -------------------------------------------------------------------------------------------- */
/* Déclaration de travaux (art. 30bis §7)                                                       */

/** Seuil de la déclaration de travaux **[à valider]** : 30 000 € HTVA. */
export const WORKS_DECLARATION_THRESHOLD: Cents = 3_000_000n;

/**
 * La déclaration de travaux est probablement requise dès 30 000 € HTVA, ou quel que soit le
 * montant dès qu'un sous-traitant intervient **[à valider]**. Renvoie les raisons affichées.
 */
export function worksDeclarationRequirement(input: {
  contractAmount: Cents;
  workplaceTotalAmount?: Cents | null;
  subcontractorCount: number;
}): { required: boolean; reasons: ('amount' | 'subcontractor')[] } {
  const total =
    input.workplaceTotalAmount && input.workplaceTotalAmount > input.contractAmount
      ? input.workplaceTotalAmount
      : input.contractAmount;
  const reasons: ('amount' | 'subcontractor')[] = [];
  if (total >= WORKS_DECLARATION_THRESHOLD) reasons.push('amount');
  if (input.subcontractorCount > 0) reasons.push('subcontractor');
  return { required: reasons.length > 0, reasons };
}

/* -------------------------------------------------------------------------------------------- */
/* Contrat de sous-traitance                                                                    */

export interface InstallmentInput {
  label: string;
  /** Pourcentage du contrat (« 30 ») ; le dernier versement absorbe l'arrondi. */
  percent: string;
  dueOn?: IsoDate | null;
}

export interface Installment {
  label: string;
  percent: string;
  amount: Cents;
  dueOn: IsoDate | null;
}

/**
 * Échéancier d'un contrat : la somme des pourcentages vaut 100 et la somme des montants vaut
 * exactement le montant du contrat (le dernier versement absorbe l'arrondi).
 */
export function buildInstallments(amount: Cents, input: readonly InstallmentInput[]): Installment[] {
  if (amount <= 0n)
    throw new SubcontractingError('invalid_amount', 'Le montant du contrat doit être positif.');
  if (input.length === 0) return [{ label: 'Paiement unique', percent: '100', amount, dueOn: null }];
  let totalPercent = dec(0);
  for (const i of input) {
    const p = dec(i.percent as DecimalInput);
    if (p.lte(0) || p.gt(100))
      throw new SubcontractingError(
        'invalid_installment',
        'Chaque versement est un pourcentage entre 0 et 100 % du contrat.',
      );
    totalPercent = totalPercent.plus(p);
  }
  if (!totalPercent.eq(100))
    throw new SubcontractingError(
      'installments_total',
      `L'échéancier totalise ${totalPercent.toString().replace('.', ',')} % : il doit faire 100 %.`,
    );
  const amounts = input.map((i) => percentOf(amount, i.percent));
  const drift = amount - sumCents(amounts);
  amounts[amounts.length - 1] = amounts[amounts.length - 1]! + drift;
  return input.map((i, k) => ({
    label: i.label.trim() || `Versement ${k + 1}`,
    percent: dec(i.percent).toString(),
    amount: amounts[k]!,
    dueOn: i.dueOn ?? null,
  }));
}

/**
 * Engagement restant d'un contrat dans le budget du chantier (04 « Engagé ») : le contrat
 * engage son montant ; les factures du sous-traitant imputées prennent le relais.
 */
export function subcontractCommitment(amount: Cents, invoiced: Cents): Cents {
  return amount > invoiced ? amount - invoiced : 0n;
}
