/**
 * Facturation (03 §10, 05 §2, §4, §5, §6, 02 P7) : états d'avancement, déduction des acomptes,
 * retenue de garantie, notes de crédit, paiements, QR code EPC, relances, révision de prix.
 * Logique pure : les montants sont en centimes (bigint), les quantités et taux en décimal exact.
 */
import {
  allocateProRata,
  type Cents,
  Dec,
  dec,
  type DecimalInput,
  minCents,
  multiplyCents,
  percentOf,
  roundHalfAwayFromZero,
  sumCents,
} from './money';
import { formatQuantity } from './quantity';
import type { VatRegime } from './vat';
import { VAT_REGIMES } from './vat';

export class InvoicingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvoicingError';
  }
}

// ---------------------------------------------------------------------------
// États d'avancement (02 P7.1) : cumul par poste, saisi en %, en quantité ou en €
// ---------------------------------------------------------------------------

export type ProgressInputMode = 'percent' | 'quantity' | 'amount';

export interface ProgressPost {
  /** Montant du poste au contrat (devis + avenants signés), HTVA. */
  contractAmount: Cents;
  /** Cumul déjà facturé par les états précédents. */
  previousAmount: Cents;
  /** Quantité totale du poste quand toutes ses lignes partagent une unité (ex. 24 m²). */
  totalQuantity?: DecimalInput | null;
}

export interface ProgressValue {
  cumulativeAmount: Cents;
  /** Cumul / contrat, entre 0 et 1. */
  cumulativeRatio: Dec;
  /** Quantité cumulée correspondante, si le poste est mesurable. */
  cumulativeQuantity: Dec | null;
  /** Montant de la période (cumul − précédent). */
  periodAmount: Cents;
}

function ratioOf(amount: Cents, contract: Cents): Dec {
  return contract === 0n ? new Dec(0) : new Dec(amount.toString()).dividedBy(contract.toString());
}

/**
 * Convertit une saisie en cumul du poste. Le cumul ne descend jamais sous l'état précédent (une
 * régularisation à la baisse passe par une note de crédit) et ne dépasse pas le contrat.
 */
export function progressFromInput(
  post: ProgressPost,
  mode: ProgressInputMode,
  value: DecimalInput,
): ProgressValue {
  const v = dec(value);
  if (v.isNegative()) throw new InvoicingError('negative', 'La valeur ne peut pas être négative.');
  let cumulative: Cents;
  if (mode === 'percent') {
    if (v.greaterThan(100)) throw new InvoicingError('above_contract', 'L’avancement ne dépasse pas 100 %.');
    cumulative = percentOf(post.contractAmount, v);
  } else if (mode === 'quantity') {
    const total =
      post.totalQuantity === null || post.totalQuantity === undefined ? null : dec(post.totalQuantity);
    if (!total || total.isZero())
      throw new InvoicingError(
        'not_measurable',
        'Ce poste ne se mesure pas en quantité : saisissez un % ou un montant.',
      );
    if (v.greaterThan(total))
      throw new InvoicingError(
        'above_contract',
        `La quantité dépasse celle du contrat (${formatQuantity(total)}).`,
      );
    cumulative = multiplyCents(post.contractAmount, v.dividedBy(total));
  } else {
    cumulative = roundHalfAwayFromZero(v);
    if (cumulative > post.contractAmount)
      throw new InvoicingError('above_contract', 'Le montant cumulé dépasse le montant du poste au contrat.');
  }
  if (cumulative < post.previousAmount)
    throw new InvoicingError(
      'below_previous',
      'Le cumul est inférieur à l’état précédent : pour régulariser, émettez une note de crédit.',
    );
  const ratio = ratioOf(cumulative, post.contractAmount);
  const total =
    post.totalQuantity === null || post.totalQuantity === undefined ? null : dec(post.totalQuantity);
  return {
    cumulativeAmount: cumulative,
    cumulativeRatio: ratio,
    cumulativeQuantity:
      total && !total.isZero() ? (mode === 'quantity' ? v : total.times(ratio).toDecimalPlaces(4)) : null,
    periodAmount: cumulative - post.previousAmount,
  };
}

/**
 * Pré-remplissage (P7.1) : l'avancement des tâches cochées du poste, jamais sous ce qui est déjà
 * facturé. Le résultat est un cumul exprimé en % (arrondi à 0,1 %).
 */
export function suggestProgressPercent(post: ProgressPost & { taskProgress: DecimalInput }): Dec {
  const fromTasks = dec(post.taskProgress).times(100);
  const previous = ratioOf(post.previousAmount, post.contractAmount).times(100);
  const pct = Dec.max(fromTasks, previous);
  // Arrondi supérieur au dixième pour ne jamais redescendre sous l'état précédent.
  return Dec.min(new Dec(100), pct.toDecimalPlaces(1, Dec.ROUND_UP));
}

export interface StatementSummary {
  contractAmount: Cents;
  previousAmount: Cents;
  cumulativeAmount: Cents;
  periodAmount: Cents;
  cumulativeRatio: Dec;
}

export function summarizeStatement(
  lines: readonly { contractAmount: Cents; previousAmount: Cents; cumulativeAmount: Cents }[],
): StatementSummary {
  const contractAmount = sumCents(lines.map((l) => l.contractAmount));
  const previousAmount = sumCents(lines.map((l) => l.previousAmount));
  const cumulativeAmount = sumCents(lines.map((l) => l.cumulativeAmount));
  return {
    contractAmount,
    previousAmount,
    cumulativeAmount,
    periodAmount: cumulativeAmount - previousAmount,
    cumulativeRatio: ratioOf(cumulativeAmount, contractAmount),
  };
}

// ---------------------------------------------------------------------------
// Lignes de facture d'avancement, déduction de l'acompte
// ---------------------------------------------------------------------------

export interface RegimeAmount {
  vatRegime: VatRegime;
  net: Cents;
}

/** Répartit un montant de poste entre ses régimes de TVA, au prorata des ventes du poste. */
export function splitByRegime(amount: Cents, shares: readonly RegimeAmount[]): RegimeAmount[] {
  const positive = shares.filter((s) => s.net > 0n);
  if (!positive.length) return [{ vatRegime: shares[0]?.vatRegime ?? 'standard_21', net: amount }];
  const parts = allocateProRata(
    amount,
    positive.map((s) => s.net),
  );
  return positive.map((s, i) => ({ vatRegime: s.vatRegime, net: parts[i]! })).filter((p) => p.net !== 0n);
}

/**
 * Déduction de l'acompte (P7.3) : au prorata de ce que la facture couvre du contrat, par régime de
 * TVA (l'acompte a été facturé aux taux du devis). La facture finale déduit tout le solde restant.
 */
export function depositDeduction(input: {
  deposit: readonly RegimeAmount[];
  alreadyDeducted: readonly RegimeAmount[];
  periodAmount: Cents;
  contractAmount: Cents;
  final?: boolean;
}): RegimeAmount[] {
  const out: RegimeAmount[] = [];
  for (const d of input.deposit) {
    const done = sumCents(input.alreadyDeducted.filter((a) => a.vatRegime === d.vatRegime).map((a) => a.net));
    const remaining = d.net - done;
    if (remaining <= 0n) continue;
    const share =
      input.final || input.contractAmount === 0n
        ? remaining
        : minCents(
            remaining,
            roundHalfAwayFromZero(
              new Dec(d.net.toString())
                .times(input.periodAmount.toString())
                .dividedBy(input.contractAmount.toString()),
            ),
          );
    if (share > 0n) out.push({ vatRegime: d.vatRegime, net: share });
  }
  return out;
}

export type InvoiceLineKind = 'item' | 'deduction';

export interface DraftInvoiceLine {
  kind: InvoiceLineKind;
  description: string;
  unit: string;
  /** Quantité décimale ; « -1 » pour une déduction (BR-27 : le prix unitaire reste positif). */
  quantity: string;
  unitPrice: Cents;
  vatRegime: VatRegime;
  budgetLineId: string | null;
}

const pctLabel = (ratio: Dec) => `${ratio.times(100).toDecimalPlaces(1).toString().replace('.', ',')} %`;

export function progressInvoiceLines(input: {
  posts: readonly {
    budgetLineId: string;
    label: string;
    periodAmount: Cents;
    cumulativeRatio: Dec;
    regimes: readonly RegimeAmount[];
  }[];
  deduction: readonly RegimeAmount[];
  depositLabel: string;
}): DraftInvoiceLine[] {
  const lines: DraftInvoiceLine[] = [];
  for (const p of input.posts) {
    if (p.periodAmount === 0n) continue;
    const parts = splitByRegime(p.periodAmount, p.regimes);
    for (const part of parts)
      lines.push({
        kind: 'item',
        description: `${p.label} — avancement cumulé ${pctLabel(p.cumulativeRatio)}${
          parts.length > 1 ? ` (TVA ${VAT_REGIMES[part.vatRegime].ratePercent} %)` : ''
        }`,
        unit: 'forfait',
        quantity: '1',
        unitPrice: part.net,
        vatRegime: part.vatRegime,
        budgetLineId: p.budgetLineId,
      });
  }
  for (const d of input.deduction)
    lines.push({
      kind: 'deduction',
      description: `${input.depositLabel}${
        input.deduction.length > 1 ? ` (TVA ${VAT_REGIMES[d.vatRegime].ratePercent} %)` : ''
      }`,
      unit: 'forfait',
      quantity: '-1',
      unitPrice: d.net,
      vatRegime: d.vatRegime,
      budgetLineId: null,
    });
  return lines;
}

// ---------------------------------------------------------------------------
// Retenue de garantie, solde, statut de paiement
// ---------------------------------------------------------------------------

/**
 * Retenue de garantie (03 §10) : un pourcentage du TVAC retenu au paiement jusqu'à la réception
 * définitive. Elle ne change ni la base ni la TVA de la facture : seulement le montant à payer.
 */
export function retentionOf(totalGross: Cents, percent: DecimalInput): Cents {
  if (dec(percent).isZero() || totalGross <= 0n) return 0n;
  return percentOf(totalGross, percent);
}

/** Montant exigible maintenant (TVAC − retenue). */
export function amountDue(invoice: { totalGross: Cents; retentionAmount: Cents }): Cents {
  return invoice.totalGross - invoice.retentionAmount;
}

/** Solde restant à encaisser (notes de crédit et paiements déduits), jamais négatif. */
export function invoiceBalance(invoice: {
  totalGross: Cents;
  retentionAmount: Cents;
  paid: Cents;
  credited?: Cents;
}): Cents {
  const rest = amountDue(invoice) - invoice.paid - (invoice.credited ?? 0n);
  return rest > 0n ? rest : 0n;
}

export type PaymentState = 'unpaid' | 'partially_paid' | 'paid';

export function paymentState(invoice: {
  totalGross: Cents;
  retentionAmount: Cents;
  paid: Cents;
  credited?: Cents;
}): PaymentState {
  if (invoiceBalance(invoice) === 0n) return 'paid';
  return invoice.paid > 0n ? 'partially_paid' : 'unpaid';
}

/** Un paiement ne dépasse pas le solde (un trop-perçu se traite à part, par remboursement). */
export function validatePayment(amount: Cents, balance: Cents): void {
  if (amount <= 0n) throw new InvoicingError('invalid_amount', 'Le montant du paiement doit être positif.');
  if (amount > balance)
    throw new InvoicingError('overpayment', 'Le paiement dépasse le solde de la facture.');
}

export function isInvoiceOverdue(input: { dueDate: string | null; today: string; balance: Cents }): boolean {
  return input.balance > 0n && input.dueDate !== null && input.dueDate < input.today;
}

export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 05 §2 [à valider] : facture émise au plus tard le 15 du mois qui suit la prestation. */
export function issuanceDeadline(serviceDate: string): string {
  const [y, m] = serviceDate.split('-').map(Number) as [number, number];
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-15`;
}

// ---------------------------------------------------------------------------
// Notes de crédit (05 §2 : une facture émise se corrige par note de crédit)
// ---------------------------------------------------------------------------

/**
 * Lignes d'une note de crédit : toute la facture, ou une partie des lignes (quantité ou montant).
 * Le total crédité cumulé ne dépasse jamais le net de la facture d'origine.
 */
export function creditNoteLines(input: {
  original: readonly DraftInvoiceLine[];
  originalNet: Cents;
  alreadyCredited: Cents;
  partial?: readonly { index: number; amount: Cents }[];
  reason: string;
}): DraftInvoiceLine[] {
  const lines: DraftInvoiceLine[] = input.partial
    ? input.partial.map((p) => {
        const o = input.original[p.index];
        if (!o) throw new InvoicingError('invalid_line', 'Ligne inconnue sur la facture d’origine.');
        if (p.amount <= 0n)
          throw new InvoicingError('invalid_amount', 'Chaque montant crédité doit être positif.');
        return {
          ...o,
          kind: 'item',
          description: `${o.description} — ${input.reason}`,
          quantity: '1',
          unitPrice: p.amount,
        };
      })
    : input.original.map((o) => ({ ...o }));
  const net = sumCents(
    lines.map((l) => roundHalfAwayFromZero(dec(l.quantity).times(l.unitPrice.toString()))),
  );
  if (net <= 0n)
    throw new InvoicingError('invalid_amount', 'La note de crédit doit avoir un montant positif.');
  if (net + input.alreadyCredited > input.originalNet)
    throw new InvoicingError(
      'over_credit',
      'La note de crédit dépasse ce qui reste à créditer sur la facture.',
    );
  return lines;
}

// ---------------------------------------------------------------------------
// QR code de virement EPC (05 §5) — EPC069-12, version 002, SEPA Credit Transfer
// ---------------------------------------------------------------------------

export function epcQrPayload(input: {
  name: string;
  iban: string;
  bic?: string | null;
  amount: Cents;
  /** Communication structurée formatée (+++123/4567/89012+++) ou texte libre. */
  remittance: string;
}): string {
  if (input.amount <= 0n || input.amount > 99_999_999_999n)
    throw new InvoicingError('invalid_amount', 'Montant hors limites pour un QR code de virement.');
  const euros = `${input.amount / 100n}.${String(input.amount % 100n).padStart(2, '0')}`;
  // La communication structurée belge n'est pas une référence ISO 11649 : elle va dans le champ
  // « non structuré », que les banques belges reconnaissent au format +++…+++ [à valider].
  return [
    'BCD',
    '002',
    '1',
    'SCT',
    (input.bic ?? '').replace(/\s/g, ''),
    input.name.slice(0, 70),
    input.iban.replace(/\s/g, '').toUpperCase(),
    `EUR${euros}`,
    '',
    '',
    input.remittance.slice(0, 140),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Relances (05 §6) — régime B2B ou B2C selon le client
// ---------------------------------------------------------------------------

export interface DunningPolicy {
  /** Jours de retard déclenchant chaque relance (ex. 3, 15, 30). */
  days: readonly number[];
  lateInterestEnabled: boolean;
  lumpSumIndemnityEnabled: boolean;
  /** Taux d'intérêt annuel B2B (loi du 2 août 2002) [à valider : taux du semestre]. */
  b2bInterestRatePercent: DecimalInput;
  /** Indemnité forfaitaire B2B minimale [à valider]. */
  b2bLumpSum: Cents;
  /** Taux d'intérêt légal B2C [à valider]. */
  b2cInterestRatePercent: DecimalInput;
}

export const DEFAULT_DUNNING_POLICY: DunningPolicy = {
  days: [3, 15, 30],
  lateInterestEnabled: false,
  lumpSumIndemnityEnabled: false,
  b2bInterestRatePercent: '10.15',
  b2bLumpSum: 4_000n,
  b2cInterestRatePercent: '4.5',
};

export interface DunningStepDue {
  step: number;
  kind: 'reminder' | 'formal_notice';
  daysLate: number;
  /** Frais réclamés à ce stade (indemnité B2B ou frais plafonnés B2C). */
  fee: Cents;
  /** Intérêts de retard courus jusqu'à aujourd'hui. */
  interest: Cents;
}

/**
 * Frais B2C (Code de droit économique, livre XIX) [à valider] : le premier rappel est gratuit ;
 * ensuite, plafond selon le solde : 20 € (≤ 150 €), 30 € + 10 % au-delà de 150 € (≤ 500 €),
 * 65 € + 5 % au-delà de 500 €, maximum 2 000 €.
 */
export function b2cMaxFee(balance: Cents): Cents {
  if (balance <= 15_000n) return 2_000n;
  if (balance <= 50_000n) return 3_000n + percentOf(balance - 15_000n, 10);
  return minCents(200_000n, 6_500n + percentOf(balance - 50_000n, 5));
}

export function lateInterest(balance: Cents, ratePercent: DecimalInput, daysLate: number): Cents {
  if (daysLate <= 0 || balance <= 0n) return 0n;
  return roundHalfAwayFromZero(
    new Dec(balance.toString()).times(dec(ratePercent)).dividedBy(100).times(daysLate).dividedBy(365),
  );
}

/**
 * Prochaine relance due, s'il y en a une : une seule à la fois, dans l'ordre du calendrier, et
 * jamais pour une facture soldée. La dernière étape est une mise en demeure.
 */
export function dueDunningStep(input: {
  dueDate: string;
  today: string;
  stepsSent: number;
  balance: Cents;
  customerKind: 'individual' | 'company';
  policy: DunningPolicy;
}): DunningStepDue | null {
  const { policy } = input;
  if (input.balance <= 0n) return null;
  const daysLate = daysBetween(input.dueDate, input.today);
  const next = input.stepsSent + 1;
  const threshold = policy.days[next - 1];
  if (threshold === undefined || daysLate < threshold) return null;
  const kind = next === policy.days.length && next > 1 ? 'formal_notice' : 'reminder';
  let fee = 0n;
  let interest = 0n;
  if (input.customerKind === 'company') {
    if (policy.lumpSumIndemnityEnabled) fee = policy.b2bLumpSum;
    if (policy.lateInterestEnabled)
      interest = lateInterest(input.balance, policy.b2bInterestRatePercent, daysLate);
  } else if (next > 1) {
    // B2C : aucun frais au premier rappel.
    if (policy.lumpSumIndemnityEnabled) fee = b2cMaxFee(input.balance);
    if (policy.lateInterestEnabled)
      interest = lateInterest(input.balance, policy.b2cInterestRatePercent, daysLate);
  }
  return { step: next, kind, daysLate, fee, interest };
}

// ---------------------------------------------------------------------------
// Révision de prix (formule belge p = P × (a × s/S + b × i/I + c))
// ---------------------------------------------------------------------------

export interface PriceRevisionFormula {
  /** Part main-d'œuvre, part matériaux, part fixe : a + b + c = 1. */
  a: DecimalInput;
  b: DecimalInput;
  c: DecimalInput;
  /** Salaire et indice matériaux de référence (date de l'offre). */
  S: DecimalInput;
  I: DecimalInput;
}

export function priceRevisionFactor(
  f: PriceRevisionFormula,
  current: { s: DecimalInput; i: DecimalInput },
): Dec {
  const sum = dec(f.a).plus(dec(f.b)).plus(dec(f.c));
  if (!sum.equals(1))
    throw new InvoicingError('invalid_formula', 'Les coefficients a + b + c doivent valoir 1.');
  if (dec(f.S).isZero() || dec(f.I).isZero())
    throw new InvoicingError('invalid_formula', 'Les indices de référence ne peuvent pas être nuls.');
  return dec(f.a)
    .times(dec(current.s).dividedBy(dec(f.S)))
    .plus(dec(f.b).times(dec(current.i).dividedBy(dec(f.I))))
    .plus(dec(f.c));
}

/** Montant de révision à ajouter (ou déduire) sur une période facturée. */
export function priceRevisionAmount(periodAmount: Cents, factor: DecimalInput): Cents {
  return multiplyCents(periodAmount, dec(factor).minus(1));
}
