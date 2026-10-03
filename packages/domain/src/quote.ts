/**
 * Devis (03 §4, 04) : postes (sections) et lignes, options choisies par le client, remises,
 * coût, marge, temps de main-d'œuvre et acompte. Pur : les mêmes fonctions servent pour
 * l'éditeur, le portail client, le PDF et, plus tard, l'UBL.
 *
 * Remise globale : appliquée comme remise de ligne supplémentaire, au prorata, pour que la
 * TVA reste calculée par catégorie sur des nets déjà remisés (05 §4).
 */
import { type Cents, Dec, dec, type DecimalInput, multiplyCents, percentOf, sumCents } from './money';
import { computeDocumentTotals, type DocumentTotals, type VatRegime } from './vat';

export const QUOTE_LINE_KINDS = ['item', 'text'] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export interface QuoteLineInput {
  id: string;
  kind: QuoteLineKind;
  description: string;
  unit: string;
  quantity: DecimalInput;
  /** Prix de vente unitaire HTVA (centimes). */
  unitPrice: Cents;
  /** Prix de revient unitaire (centimes). */
  unitCost: Cents;
  /** Heures de main-d'œuvre par unité. */
  laborHours: DecimalInput;
  vatRegime: VatRegime;
  discountPercent?: DecimalInput;
}

export interface QuoteSectionInput {
  id: string;
  title: string;
  /** Poste optionnel : le client l'ajoute ou non sur le portail. */
  optional: boolean;
  /** Choix courant (pour un poste optionnel). */
  selected: boolean;
  lines: QuoteLineInput[];
}

export interface QuoteInput {
  sections: QuoteSectionInput[];
  /** Remise globale en pourcentage. */
  globalDiscountPercent?: DecimalInput;
  /** Acompte : pourcentage du total TVAC, ou montant fixe TVAC. */
  deposit?: { kind: 'percent'; value: DecimalInput } | { kind: 'amount'; value: Cents } | null;
}

export interface QuoteLineTotals {
  id: string;
  sectionId: string;
  included: boolean;
  netAmount: Cents;
  cost: Cents;
  margin: Cents;
  /** Marge sur prix de vente (null si vente nulle). */
  marginRate: Dec | null;
  laborHours: Dec;
}

export interface QuoteSectionTotals {
  id: string;
  included: boolean;
  netAmount: Cents;
  cost: Cents;
  margin: Cents;
  marginRate: Dec | null;
  laborHours: Dec;
}

export interface QuoteTotals {
  lines: QuoteLineTotals[];
  sections: QuoteSectionTotals[];
  document: DocumentTotals;
  totalCost: Cents;
  totalMargin: Cents;
  marginRate: Dec | null;
  laborHours: Dec;
  /** Acompte TVAC demandé à la signature. */
  depositAmount: Cents;
  /** Montant des postes optionnels non retenus (pour l'affichage « options »). */
  optionsAvailable: Cents;
}

function rate(margin: Cents, sale: Cents): Dec | null {
  return sale === 0n ? null : new Dec(margin.toString()).dividedBy(new Dec(sale.toString()));
}

export function isSectionIncluded(s: Pick<QuoteSectionInput, 'optional' | 'selected'>): boolean {
  return !s.optional || s.selected;
}

/** Combine une remise de ligne et la remise globale : 1 − (1 − a)(1 − b). */
export function combinedDiscountPercent(line?: DecimalInput, global?: DecimalInput): Dec {
  const a = dec(line ?? 0).dividedBy(100);
  const b = dec(global ?? 0).dividedBy(100);
  return new Dec(1).minus(new Dec(1).minus(a).times(new Dec(1).minus(b))).times(100);
}

/** Calcule tout le devis. Les postes optionnels non choisis sont exclus des totaux. */
export function computeQuote(input: QuoteInput): QuoteTotals {
  const flat = input.sections.flatMap((s) =>
    s.lines
      .filter((l) => l.kind === 'item')
      .map((l) => ({ section: s, line: l, included: isSectionIncluded(s) })),
  );
  const included = flat.filter((f) => f.included);
  const document = computeDocumentTotals(
    included.map(({ line }) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: combinedDiscountPercent(line.discountPercent, input.globalDiscountPercent),
      vatRegime: line.vatRegime,
    })),
  );
  const netById = new Map(included.map((f, i) => [f.line.id, document.lines[i]!.netAmount]));

  const lines: QuoteLineTotals[] = flat.map(({ section, line, included: inc }) => {
    const netAmount =
      netById.get(line.id) ??
      computeDocumentTotals([
        {
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: combinedDiscountPercent(line.discountPercent, input.globalDiscountPercent),
          vatRegime: line.vatRegime,
        },
      ]).totalNet;
    const cost = multiplyCents(line.unitCost, line.quantity);
    const margin = netAmount - cost;
    return {
      id: line.id,
      sectionId: section.id,
      included: inc,
      netAmount,
      cost,
      margin,
      marginRate: rate(margin, netAmount),
      laborHours: dec(line.quantity).times(dec(line.laborHours)),
    };
  });

  const sections: QuoteSectionTotals[] = input.sections.map((s) => {
    const ls = lines.filter((l) => l.sectionId === s.id);
    const netAmount = sumCents(ls.map((l) => l.netAmount));
    const cost = sumCents(ls.map((l) => l.cost));
    return {
      id: s.id,
      included: isSectionIncluded(s),
      netAmount,
      cost,
      margin: netAmount - cost,
      marginRate: rate(netAmount - cost, netAmount),
      laborHours: ls.reduce((h, l) => h.plus(l.laborHours), new Dec(0)),
    };
  });

  const inc = lines.filter((l) => l.included);
  const totalCost = sumCents(inc.map((l) => l.cost));
  const totalMargin = document.totalNet - totalCost;
  const deposit = input.deposit;
  const depositAmount = !deposit
    ? 0n
    : deposit.kind === 'percent'
      ? percentOf(document.totalGross, deposit.value)
      : deposit.value > document.totalGross
        ? document.totalGross
        : deposit.value;

  return {
    lines,
    sections,
    document,
    totalCost,
    totalMargin,
    marginRate: rate(totalMargin, document.totalNet),
    laborHours: inc.reduce((h, l) => h.plus(l.laborHours), new Dec(0)),
    depositAmount,
    optionsAvailable: sumCents(sections.filter((s) => !s.included).map((s) => s.netAmount)),
  };
}

// ---------------------------------------------------------------------------
// Comparaison de versions (03 §4 : « comparatif entre versions »)
// ---------------------------------------------------------------------------

export interface QuoteDiffLine {
  kind: 'added' | 'removed' | 'changed';
  sectionTitle: string;
  description: string;
  /** Champs modifiés (quantité, prix, TVA…). */
  fields: string[];
  before?: { quantity: string; unitPrice: Cents };
  after?: { quantity: string; unitPrice: Cents };
}

interface DiffableLine {
  /** Identifiant stable d'une version à l'autre (la ligne copiée garde sa clé). */
  key: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: Cents;
  vatRegime: VatRegime;
  discountPercent: string;
}

export function diffQuoteVersions(
  before: { title: string; lines: DiffableLine[] }[],
  after: { title: string; lines: DiffableLine[] }[],
): QuoteDiffLine[] {
  const index = (doc: typeof before) =>
    new Map(doc.flatMap((s) => s.lines.map((l) => [l.key, { section: s.title, line: l }] as const)));
  const a = index(before);
  const b = index(after);
  const out: QuoteDiffLine[] = [];
  for (const [key, { section, line }] of b) {
    const old = a.get(key);
    if (!old) {
      out.push({
        kind: 'added',
        sectionTitle: section,
        description: line.description,
        fields: [],
        after: { quantity: line.quantity, unitPrice: line.unitPrice },
      });
      continue;
    }
    const fields: string[] = [];
    if (old.line.description !== line.description) fields.push('description');
    if (!dec(old.line.quantity).equals(dec(line.quantity))) fields.push('quantity');
    if (old.line.unit !== line.unit) fields.push('unit');
    if (old.line.unitPrice !== line.unitPrice) fields.push('unitPrice');
    if (old.line.vatRegime !== line.vatRegime) fields.push('vatRegime');
    if (!dec(old.line.discountPercent || 0).equals(dec(line.discountPercent || 0))) fields.push('discount');
    if (old.section !== section) fields.push('section');
    if (fields.length)
      out.push({
        kind: 'changed',
        sectionTitle: section,
        description: line.description,
        fields,
        before: { quantity: old.line.quantity, unitPrice: old.line.unitPrice },
        after: { quantity: line.quantity, unitPrice: line.unitPrice },
      });
  }
  for (const [key, { section, line }] of a) {
    if (!b.has(key))
      out.push({
        kind: 'removed',
        sectionTitle: section,
        description: line.description,
        fields: [],
        before: { quantity: line.quantity, unitPrice: line.unitPrice },
      });
  }
  return out;
}

/** Date de validité : émission + n jours (03 §4). */
export function quoteValidUntil(sentAt: Date, validityDays: number): Date {
  return new Date(sentAt.getTime() + validityDays * 86_400_000);
}

/** Relance automatique à J+7 si le devis n'est pas signé (03 §4). */
export const QUOTE_REMINDER_DAYS = 7;

export function isQuoteReminderDue(
  q: { status: string; sentAt: Date | null; reminderSentAt: Date | null; validUntil: Date | null },
  now: Date = new Date(),
): boolean {
  if (!['sent', 'viewed'].includes(q.status) || !q.sentAt || q.reminderSentAt) return false;
  if (q.validUntil && q.validUntil <= now) return false;
  return now.getTime() - q.sentAt.getTime() >= QUOTE_REMINDER_DAYS * 86_400_000;
}

export function isQuoteExpired(
  q: { status: string; validUntil: Date | null },
  now: Date = new Date(),
): boolean {
  return ['sent', 'viewed'].includes(q.status) && q.validUntil !== null && q.validUntil <= now;
}
