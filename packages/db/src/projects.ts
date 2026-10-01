/**
 * Chiffres d'un chantier (04 « Calcul budgétaire ») calculés depuis les données : postes, tâches,
 * grand livre des coûts, factures émises. Partagé par l'API (cockpit) et le worker (alertes de dérive).
 */
import {
  allocateProRata,
  type BudgetLineInput,
  type Cents,
  type CommittedCosts,
  computeProjectFinancials,
  dec,
  EMPTY_COMMITTED,
  type ProjectFinancials,
  progressFromTasks,
  roundHalfAwayFromZero,
} from '@batimint/domain';
import type { Tx } from './client';

const COST_KEY: Record<string, keyof CommittedCosts> = {
  supplier_invoice: 'supplierInvoices',
  purchase_order: 'openPurchaseOrders',
  labour: 'labour',
  stock: 'stock',
  equipment: 'equipment',
  subcontract: 'subcontracts',
  other: 'other',
};

export const UNALLOCATED = 'unallocated';

/** Statuts de facture qui comptent comme « facturé » (émise, non annulée). */
export const BILLED_STATUSES = ['issued', 'sent', 'delivered', 'partially_paid', 'paid'] as const;
export const OPEN_INVOICE_STATUSES = ['issued', 'sent', 'delivered', 'partially_paid'] as const;

export interface LineDetail {
  id: string;
  position: number;
  label: string;
  fromChangeOrder: boolean;
  committedByCategory: Record<string, Cents>;
  taskCount: number;
  doneCount: number;
}

export interface ProjectNumbers {
  fin: ProjectFinancials;
  lines: LineDetail[];
  quoteAmount: Cents;
  changeOrdersAmount: Cents;
  driftThreshold: string;
}

function taskWeights(tasks: { amount: bigint; plannedHours: { toString(): string } }[]) {
  if (tasks.length && tasks.every((t) => t.amount > 0n)) return tasks.map((t) => t.amount.toString());
  if (tasks.length && tasks.every((t) => dec(t.plannedHours.toString()).greaterThan(0)))
    return tasks.map((t) => t.plannedHours.toString());
  return tasks.map(() => '1');
}

/** Chiffres de plusieurs chantiers en quelques requêtes groupées (liste, barre latérale). */
export async function loadProjectNumbers(
  tx: Tx,
  projects: readonly { id: string; contractAmount: bigint }[],
  driftThreshold: string,
): Promise<Map<string, ProjectNumbers>> {
  const ids = projects.map((p) => p.id);
  const out = new Map<string, ProjectNumbers>();
  if (!ids.length) return out;
  // Requêtes séquentielles : une transaction Prisma n'exécute pas de requêtes en parallèle.
  const lines = await tx.budgetLine.findMany({
    where: { projectId: { in: ids } },
    orderBy: [{ projectId: 'asc' }, { position: 'asc' }],
  });
  const tasks = await tx.task.findMany({
    where: { projectId: { in: ids } },
    select: {
      projectId: true,
      budgetLineId: true,
      amount: true,
      plannedHours: true,
      status: true,
      progress: true,
    },
  });
  const costs = await tx.projectCost.groupBy({
    by: ['projectId', 'budgetLineId', 'category'],
    where: { projectId: { in: ids } },
    _sum: { amount: true },
  });
  const invoiceLines = await tx.invoiceLine.findMany({
    where: { invoice: { projectId: { in: ids }, status: { in: [...BILLED_STATUSES] } } },
    select: { quantity: true, unitPrice: true, budgetLineId: true, invoice: { select: { projectId: true } } },
  });
  const signedCo = await tx.changeOrder.groupBy({
    by: ['projectId'],
    where: { projectId: { in: ids }, status: 'signed' },
    _sum: { totalNet: true },
  });
  const coByProject = new Map(signedCo.map((c) => [c.projectId, c._sum.totalNet ?? 0n]));

  for (const p of projects) {
    const pLines = lines.filter((l) => l.projectId === p.id);
    const pTasks = tasks.filter((t) => t.projectId === p.id);
    const pCosts = costs.filter((c) => c.projectId === p.id);
    const known = new Set(pLines.map((l) => l.id));

    // Facturé par poste : lignes affectées à un poste, le reste au prorata des ventes.
    const invoicedByLine = new Map<string, Cents>();
    let unassigned = 0n;
    for (const il of invoiceLines.filter((x) => x.invoice.projectId === p.id)) {
      const net = roundHalfAwayFromZero(dec(il.quantity.toString()).times(il.unitPrice.toString()));
      if (il.budgetLineId && known.has(il.budgetLineId))
        invoicedByLine.set(il.budgetLineId, (invoicedByLine.get(il.budgetLineId) ?? 0n) + net);
      else unassigned += net;
    }
    if (unassigned !== 0n && pLines.length) {
      const shares = allocateProRata(
        unassigned,
        pLines.map((l) => (l.saleAmount > 0n ? l.saleAmount : 0n)),
      );
      pLines.forEach((l, i) => invoicedByLine.set(l.id, (invoicedByLine.get(l.id) ?? 0n) + shares[i]!));
    }

    const details: LineDetail[] = [];
    const inputs: BudgetLineInput[] = pLines.map((l) => {
      const lt = pTasks.filter((t) => t.budgetLineId === l.id);
      const weights = taskWeights(lt);
      const progress = progressFromTasks(
        lt.map((t, i) => ({
          weight: weights[i]!,
          done: t.status === 'done',
          progress: t.progress.toString(),
        })),
      );
      const committed: CommittedCosts = { ...EMPTY_COMMITTED, other: 0n };
      const byCat: Record<string, Cents> = {};
      for (const c of pCosts.filter((x) => x.budgetLineId === l.id)) {
        const k = COST_KEY[c.category] ?? 'other';
        const v = c._sum.amount ?? 0n;
        committed[k] = (committed[k] ?? 0n) + v;
        byCat[c.category] = (byCat[c.category] ?? 0n) + v;
      }
      details.push({
        id: l.id,
        position: l.position,
        label: l.label,
        fromChangeOrder: Boolean(l.changeOrderId),
        committedByCategory: byCat,
        taskCount: lt.length,
        doneCount: lt.filter((t) => t.status === 'done').length,
      });
      return {
        id: l.id,
        revenue: l.saleAmount,
        budgetedCost: l.budgetedCost,
        committed,
        progress,
        invoiced: invoicedByLine.get(l.id) ?? 0n,
      };
    });
    // Coûts non ventilés sur un poste : comptés dans l'engagé du chantier.
    const loose = pCosts.filter((c) => !c.budgetLineId || !known.has(c.budgetLineId));
    if (loose.length) {
      const committed: CommittedCosts = { ...EMPTY_COMMITTED, other: 0n };
      const byCat: Record<string, Cents> = {};
      for (const c of loose) {
        const k = COST_KEY[c.category] ?? 'other';
        committed[k] = (committed[k] ?? 0n) + (c._sum.amount ?? 0n);
        byCat[c.category] = (byCat[c.category] ?? 0n) + (c._sum.amount ?? 0n);
      }
      inputs.push({ id: UNALLOCATED, revenue: 0n, budgetedCost: 0n, committed, progress: 1 });
      details.push({
        id: UNALLOCATED,
        position: 9999,
        label: '',
        fromChangeOrder: false,
        committedByCategory: byCat,
        taskCount: 0,
        doneCount: 0,
      });
    }
    const fin = computeProjectFinancials(inputs, { driftThreshold, contractAmount: p.contractAmount });
    fin.driftingLineIds = fin.driftingLineIds.filter((id) => id !== UNALLOCATED);
    const changeOrdersAmount = coByProject.get(p.id) ?? 0n;
    out.set(p.id, {
      fin,
      lines: details,
      quoteAmount: p.contractAmount - changeOrdersAmount,
      changeOrdersAmount,
      driftThreshold,
    });
  }
  return out;
}
