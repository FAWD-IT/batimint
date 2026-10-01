/**
 * Budget et marge du chantier (04 « Calcul budgétaire »). Définition unique, utilisée partout.
 *
 * Coût projeté d'un poste (voir ADR 0004) :
 *   projeté = max(engagé, budgété × avancement) + budgété × (1 − avancement)
 * La part consommée vaut au moins ce que l'avancement laisse prévoir (on ne compte pas
 * d'économie avant la fin du poste) et on ajoute le reste à faire au coût budgété :
 * en début de chantier, la marge affichée vaut donc la marge prévue et jamais davantage.
 */
import { type Cents, Dec, dec, type DecimalInput, maxCents, multiplyCents, ratio, sumCents } from './money';

export interface CommittedCosts {
  supplierInvoices: Cents;
  openPurchaseOrders: Cents;
  labour: Cents;
  stock: Cents;
  equipment: Cents;
  subcontracts: Cents;
}

export const EMPTY_COMMITTED: CommittedCosts = {
  supplierInvoices: 0n,
  openPurchaseOrders: 0n,
  labour: 0n,
  stock: 0n,
  equipment: 0n,
  subcontracts: 0n,
};

export interface BudgetLineInput {
  id: string;
  /** Montant de vente HTVA du poste (devis signé + avenants signés). */
  revenue: Cents;
  /** Coût budgété du poste (prix de revient du devis + avenants). */
  budgetedCost: Cents;
  committed: CommittedCosts;
  /** Avancement du poste, ratio entre 0 et 1. */
  progress: DecimalInput;
  invoiced?: Cents;
  collected?: Cents;
}

export interface BudgetLineResult {
  id: string;
  revenue: Cents;
  budgetedCost: Cents;
  committedTotal: Cents;
  projectedCost: Cents;
  progress: Dec;
  invoiced: Cents;
  collected: Cents;
  /** Engagé / budgété (null si budget nul). */
  consumption: Dec | null;
  drift: boolean;
}

export const DEFAULT_DRIFT_THRESHOLD = '0.10';

export function clampRatio(value: DecimalInput): Dec {
  const d = dec(value);
  if (d.isNegative()) return new Dec(0);
  if (d.greaterThan(1)) return new Dec(1);
  return d;
}

export function committedTotal(c: CommittedCosts): Cents {
  return c.supplierInvoices + c.openPurchaseOrders + c.labour + c.stock + c.equipment + c.subcontracts;
}

export function projectedCost(budgetedCost: Cents, committed: Cents, progress: DecimalInput): Cents {
  const p = clampRatio(progress);
  const expectedSoFar = multiplyCents(budgetedCost, p);
  const remaining = multiplyCents(budgetedCost, new Dec(1).minus(p));
  return maxCents(committed, expectedSoFar) + remaining;
}

/** 04 — alerte de dérive : engagé > budgété × (1 + seuil). */
export function isDrifting(budgetedCost: Cents, committed: Cents, threshold: DecimalInput = DEFAULT_DRIFT_THRESHOLD): boolean {
  if (committed <= 0n) return false;
  if (budgetedCost <= 0n) return committed > 0n;
  return new Dec(committed.toString()).greaterThan(new Dec(budgetedCost.toString()).times(new Dec(1).plus(dec(threshold))));
}

export function computeBudgetLine(line: BudgetLineInput, threshold: DecimalInput = DEFAULT_DRIFT_THRESHOLD): BudgetLineResult {
  const total = committedTotal(line.committed);
  return {
    id: line.id,
    revenue: line.revenue,
    budgetedCost: line.budgetedCost,
    committedTotal: total,
    projectedCost: projectedCost(line.budgetedCost, total, line.progress),
    progress: clampRatio(line.progress),
    invoiced: line.invoiced ?? 0n,
    collected: line.collected ?? 0n,
    consumption: ratio(total, line.budgetedCost),
    drift: isDrifting(line.budgetedCost, total, threshold),
  };
}

export interface ProjectFinancials {
  lines: BudgetLineResult[];
  contractAmount: Cents;
  budgetedCost: Cents;
  committed: Cents;
  projectedCost: Cents;
  invoiced: Cents;
  collected: Cents;
  /** Avancement global pondéré par le montant de vente des postes. */
  progress: Dec;
  /** (contrat − coût budgété) / contrat. */
  plannedMargin: Dec | null;
  /** (contrat − coût projeté) / contrat. */
  estimatedMargin: Dec | null;
  plannedMarginAmount: Cents;
  estimatedMarginAmount: Cents;
  driftingLineIds: string[];
}

export function computeProjectFinancials(
  lines: readonly BudgetLineInput[],
  options: { driftThreshold?: DecimalInput; contractAmount?: Cents } = {},
): ProjectFinancials {
  const results = lines.map((l) => computeBudgetLine(l, options.driftThreshold));
  const contractAmount = options.contractAmount ?? sumCents(results.map((l) => l.revenue));
  const budgetedCost = sumCents(results.map((l) => l.budgetedCost));
  const projected = sumCents(results.map((l) => l.projectedCost));
  const revenueTotal = sumCents(results.map((l) => l.revenue));
  const weighted = results.reduce(
    (acc, l) => acc.plus(l.progress.times(new Dec(l.revenue.toString()))),
    new Dec(0),
  );
  const progress = revenueTotal === 0n ? new Dec(0) : weighted.dividedBy(new Dec(revenueTotal.toString()));
  return {
    lines: results,
    contractAmount,
    budgetedCost,
    committed: sumCents(results.map((l) => l.committedTotal)),
    projectedCost: projected,
    invoiced: sumCents(results.map((l) => l.invoiced)),
    collected: sumCents(results.map((l) => l.collected)),
    progress,
    plannedMargin: ratio(contractAmount - budgetedCost, contractAmount),
    estimatedMargin: ratio(contractAmount - projected, contractAmount),
    plannedMarginAmount: contractAmount - budgetedCost,
    estimatedMarginAmount: contractAmount - projected,
    driftingLineIds: results.filter((l) => l.drift).map((l) => l.id),
  };
}

/** Avancement d'un poste à partir de ses tâches pondérées (02 P7.1). */
export function progressFromTasks(tasks: readonly { weight?: DecimalInput; done: boolean; progress?: DecimalInput }[]): Dec {
  if (tasks.length === 0) return new Dec(0);
  let total = new Dec(0);
  let achieved = new Dec(0);
  for (const t of tasks) {
    const w = dec(t.weight ?? 1);
    total = total.plus(w);
    const p = t.done ? new Dec(1) : clampRatio(t.progress ?? 0);
    achieved = achieved.plus(w.times(p));
  }
  return total.isZero() ? new Dec(0) : achieved.dividedBy(total);
}
