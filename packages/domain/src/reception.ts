/**
 * Réception et clôture du chantier (03 §5, 02 P10) : PV provisoire avec réserves, réception
 * définitive à la date du contrat (libération de la retenue de garantie), rapport de rentabilité
 * et suggestions d'ajustement des prix de la bibliothèque. Logique pure, sans I/O.
 */
import { type IsoDate, addDays } from './calendar';
import { type Cents, Dec, dec, type DecimalInput, multiplyCents, ratio, sumCents } from './money';

export class ReceptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReceptionError';
  }
}

export type ReceptionKind = 'provisional' | 'final';

/** Ajoute des mois à une date (fin de mois respectée : 31 janvier + 1 mois = 28/29 février). */
export function addMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** Réception définitive prévue : réception provisoire + délai de garantie du contrat (mois). */
export function plannedFinalReception(provisionalOn: IsoDate, guaranteeMonths: number): IsoDate {
  if (!Number.isInteger(guaranteeMonths) || guaranteeMonths < 0)
    throw new ReceptionError('invalid_months', 'Le délai de garantie est un nombre entier de mois.');
  return addMonths(provisionalOn, guaranteeMonths);
}

/**
 * Peut-on signer ce PV ? Provisoire : chantier en cours. Définitive : réception provisoire faite
 * et réserves levées (la date prévue n'est qu'indicative : le client peut l'avancer).
 */
export function receptionBlockers(input: {
  kind: ReceptionKind;
  projectStatus: string;
  openReserves: number;
}): string[] {
  const out: string[] = [];
  if (input.kind === 'provisional' && !['in_progress', 'suspended'].includes(input.projectStatus))
    out.push('project_not_in_progress');
  if (input.kind === 'final' && input.projectStatus !== 'provisional_acceptance')
    out.push('provisional_missing');
  if (input.kind === 'final' && input.openReserves > 0) out.push('reserves_open');
  return out;
}

/** Après la levée de la dernière réserve, la facture finale peut être générée. */
export function finalInvoiceReady(input: { projectStatus: string; openReserves: number }): boolean {
  return input.projectStatus === 'provisional_acceptance' && input.openReserves === 0;
}

/**
 * Libération de la retenue : sommes retenues sur les factures du chantier (TVAC), à payer par le
 * client à la réception définitive, avec une échéance propre.
 */
export function retentionRelease(
  invoices: readonly { retentionAmount: Cents; released: boolean }[],
  releasedOn: IsoDate,
  paymentTermsDays: number,
): { amount: Cents; count: number; dueDate: IsoDate } {
  const pending = invoices.filter((i) => !i.released && i.retentionAmount > 0n);
  return {
    amount: sumCents(pending.map((i) => i.retentionAmount)),
    count: pending.length,
    dueDate: addDays(releasedOn, paymentTermsDays),
  };
}

/** Retenue encore retenue sur une facture (0 une fois libérée). */
export function heldRetention(i: {
  retentionAmount: Cents;
  retentionReleasedAt?: Date | string | null;
}): Cents {
  return i.retentionReleasedAt ? 0n : i.retentionAmount;
}

/* -------------------------------------------------------------------------------------------- */
/* Rapport de rentabilité                                                                       */

export interface ProfitabilityPostInput {
  id: string;
  label: string;
  revenue: Cents;
  budgetedCost: Cents;
  /** Coûts réels par catégorie (factures, heures, stock, matériel, sous-traitance…). */
  actualByCategory: Record<string, Cents>;
  plannedHours: DecimalInput;
  actualHours: DecimalInput;
}

export interface ProfitabilityPost {
  id: string;
  label: string;
  revenue: Cents;
  budgetedCost: Cents;
  actualCost: Cents;
  /** Réel − prévu (positif = dépassement). */
  costVariance: Cents;
  /** Réel / prévu − 1 (null sans budget). */
  costVarianceRatio: Dec | null;
  plannedMargin: Dec | null;
  actualMargin: Dec | null;
  plannedHours: Dec;
  actualHours: Dec;
  actualByCategory: Record<string, Cents>;
}

export interface ProfitabilityReport {
  posts: ProfitabilityPost[];
  revenue: Cents;
  budgetedCost: Cents;
  actualCost: Cents;
  plannedMargin: Dec | null;
  actualMargin: Dec | null;
  plannedHours: Dec;
  actualHours: Dec;
}

const margin = (revenue: Cents, cost: Cents) => {
  const r = ratio(revenue - cost, revenue);
  return r ? r.toDecimalPlaces(4) : null;
};

/** Prévu vs réel par poste et au total (03 §5, P10.4). */
export function profitabilityReport(posts: readonly ProfitabilityPostInput[]): ProfitabilityReport {
  const out = posts.map((p): ProfitabilityPost => {
    const actualCost = sumCents(Object.values(p.actualByCategory));
    const variance = ratio(actualCost - p.budgetedCost, p.budgetedCost);
    return {
      id: p.id,
      label: p.label,
      revenue: p.revenue,
      budgetedCost: p.budgetedCost,
      actualCost,
      costVariance: actualCost - p.budgetedCost,
      costVarianceRatio: variance ? variance.toDecimalPlaces(4) : null,
      plannedMargin: margin(p.revenue, p.budgetedCost),
      actualMargin: margin(p.revenue, actualCost),
      plannedHours: dec(p.plannedHours),
      actualHours: dec(p.actualHours),
      actualByCategory: p.actualByCategory,
    };
  });
  const revenue = sumCents(out.map((p) => p.revenue));
  const budgetedCost = sumCents(out.map((p) => p.budgetedCost));
  const actualCost = sumCents(out.map((p) => p.actualCost));
  return {
    posts: out,
    revenue,
    budgetedCost,
    actualCost,
    plannedMargin: margin(revenue, budgetedCost),
    actualMargin: margin(revenue, actualCost),
    plannedHours: out.reduce((s, p) => s.plus(p.plannedHours), new Dec(0)),
    actualHours: out.reduce((s, p) => s.plus(p.actualHours), new Dec(0)),
  };
}

export interface LibraryLineInput {
  itemId: string;
  itemName: string;
  postId: string;
  /** Prix de revient unitaire de la bibliothèque au moment du devis. */
  unitCost: Cents;
  /** Temps de pose unitaire (main-d'œuvre), en heures. */
  laborHours: DecimalInput;
}

export interface PriceSuggestion {
  itemId: string;
  itemName: string;
  field: 'unitCost' | 'laborHours';
  current: string;
  suggested: string;
  /** Écart constaté sur le poste (réel / prévu − 1). */
  variance: Dec;
}

/** Seuil de suggestion : un écart de 10 % ou plus sur le poste [paramétrable]. */
export const PRICE_SUGGESTION_THRESHOLD = '0.10';

/**
 * Suggestions d'ajustement de la bibliothèque (P10.4) : l'écart réel/prévu d'un poste est reporté
 * sur les articles du devis de ce poste — sur le prix de revient pour les fournitures et la
 * sous-traitance, sur le temps de pose pour la main-d'œuvre (heures réelles / prévues). Une seule
 * suggestion par article et par champ (le plus grand écart l'emporte). Marc décide.
 */
export function priceSuggestions(
  report: ProfitabilityReport,
  lines: readonly LibraryLineInput[],
  threshold: DecimalInput = PRICE_SUGGESTION_THRESHOLD,
): PriceSuggestion[] {
  const t = dec(threshold);
  const posts = new Map(report.posts.map((p) => [p.id, p]));
  const best = new Map<string, PriceSuggestion>();
  for (const l of lines) {
    const post = posts.get(l.postId);
    if (!post) continue;
    const candidates: PriceSuggestion[] = [];
    const nonLabour = sumCents(
      Object.entries(post.actualByCategory)
        .filter(([k]) => k !== 'labour')
        .map(([, v]) => v),
    );
    if (l.unitCost > 0n && post.costVarianceRatio && post.costVarianceRatio.abs().gte(t) && nonLabour > 0n)
      candidates.push({
        itemId: l.itemId,
        itemName: l.itemName,
        field: 'unitCost',
        current: l.unitCost.toString(),
        suggested: multiplyCents(l.unitCost, post.costVarianceRatio.plus(1)).toString(),
        variance: post.costVarianceRatio,
      });
    const hours = dec(l.laborHours);
    if (hours.gt(0) && post.plannedHours.gt(0)) {
      const hv = post.actualHours.dividedBy(post.plannedHours).minus(1).toDecimalPlaces(4);
      if (hv.abs().gte(t))
        candidates.push({
          itemId: l.itemId,
          itemName: l.itemName,
          field: 'laborHours',
          current: hours.toString(),
          suggested: hours.times(hv.plus(1)).toDecimalPlaces(2).toString(),
          variance: hv,
        });
    }
    for (const c of candidates) {
      const key = `${c.itemId}:${c.field}`;
      const prev = best.get(key);
      if (!prev || c.variance.abs().gt(prev.variance.abs())) best.set(key, c);
    }
  }
  return [...best.values()].sort((a, b) => b.variance.abs().comparedTo(a.variance.abs()));
}
