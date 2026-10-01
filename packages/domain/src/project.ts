/**
 * Chantier (03 §5) : étapes affichées dans le cockpit et le portail, calendrier en jours ouvrés,
 * avenants (calcul identique au devis), mentions @ dans les commentaires et liste « À faire ».
 */
import { addWorkingDays, type IsoDate, workingDaysBetween } from './calendar';
import { type Cents, Dec, type DecimalInput } from './money';
import { computeQuote, type QuoteLineInput, type QuoteTotals } from './quote';
import type { ProjectStatus } from './state-machine';

/** Étapes de la barre de progression (maquette cockpit et portail). */
export const PROJECT_STEPS = ['signed', 'works', 'reception', 'final_invoice', 'paid'] as const;
export type ProjectStep = (typeof PROJECT_STEPS)[number];

/**
 * Étape en cours : les précédentes sont terminées, les suivantes à venir. `done` quand tout est
 * terminé (facture finale payée). La réception devient l'étape en cours quand les travaux sont
 * à 100 % sans réception signée.
 */
export function currentProjectStep(input: {
  status: ProjectStatus;
  progress?: DecimalInput;
  finalInvoiceIssued?: boolean;
  fullyPaid?: boolean;
}): ProjectStep | 'done' {
  switch (input.status) {
    case 'preparation':
    case 'suspended':
      return 'works';
    case 'in_progress':
      return new Dec((input.progress ?? 0).toString()).greaterThanOrEqualTo(1) ? 'reception' : 'works';
    case 'provisional_acceptance':
    case 'final_acceptance':
    case 'closed':
      if (!input.finalInvoiceIssued) return 'final_invoice';
      return input.fullyPaid ? 'done' : 'paid';
  }
}

export interface ProjectSchedule {
  /** Jour ouvré courant (1 = premier jour), null avant le démarrage. */
  day: number | null;
  totalDays: number | null;
  /** Jours ouvrés de retard sur la date de fin prévue (0 si dans les temps). */
  lateDays: number;
}

/** « Jour 9 sur 15 » : position du jour dans le chantier, en jours ouvrés belges. */
export function projectSchedule(input: {
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  today: IsoDate;
}): ProjectSchedule {
  const { startDate, endDate, today } = input;
  const totalDays = startDate && endDate ? Math.max(1, workingDaysBetween(startDate, endDate)) : null;
  if (!startDate || today < startDate) return { day: null, totalDays, lateDays: 0 };
  const day = Math.max(1, workingDaysBetween(startDate, today));
  const lateDays = endDate && today > endDate ? Math.max(0, workingDaysBetween(endDate, today) - 1) : 0;
  return { day, totalDays, lateDays };
}

/** Nouvelle date de fin après un avenant qui prolonge le chantier de n jours ouvrés. */
export function shiftEndDate(endDate: IsoDate | null, delayDays: number): IsoDate | null {
  if (!endDate || delayDays <= 0) return endDate;
  return addWorkingDays(endDate, delayDays);
}

/* ------------------------------------------------------------------ Avenants */

export interface ChangeOrderLineInput extends Omit<QuoteLineInput, 'kind'> {
  /** Poste existant du chantier, ou null pour un nouveau poste. */
  budgetLineId: string | null;
  /** Intitulé du nouveau poste (si budgetLineId est null). */
  newPostLabel?: string | null;
}

export interface ChangeOrderTotals extends QuoteTotals {
  /** Montants par poste cible (clé : id du poste, ou `new:<intitulé>`). */
  byTarget: {
    key: string;
    budgetLineId: string | null;
    label: string | null;
    sale: Cents;
    cost: Cents;
    laborHours: Dec;
  }[];
}

export function changeOrderTargetKey(l: Pick<ChangeOrderLineInput, 'budgetLineId' | 'newPostLabel'>): string {
  return l.budgetLineId ?? `new:${(l.newPostLabel ?? '').trim().toLowerCase() || 'avenant'}`;
}

/**
 * Un avenant se calcule exactement comme un devis (mêmes arrondis EN 16931, même TVA) : chaque
 * poste cible devient une section, toujours retenue.
 */
export function computeChangeOrder(lines: readonly ChangeOrderLineInput[]): ChangeOrderTotals {
  const groups = new Map<string, ChangeOrderLineInput[]>();
  for (const l of lines) {
    const k = changeOrderTargetKey(l);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const totals = computeQuote({
    sections: [...groups.entries()].map(([key, ls]) => ({
      id: key,
      title: key,
      optional: false,
      selected: true,
      lines: ls.map((l) => ({ ...l, kind: 'item' as const })),
    })),
  });
  return {
    ...totals,
    byTarget: totals.sections.map((s) => {
      const first = groups.get(s.id)![0]!;
      return {
        key: s.id,
        budgetLineId: first.budgetLineId,
        label: first.budgetLineId ? null : (first.newPostLabel ?? '').trim() || null,
        sale: s.netAmount,
        cost: s.cost,
        laborHours: s.laborHours,
      };
    }),
  };
}

/* ------------------------------------------------------------------ Mentions */

const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([0-9a-f-]{36})\)/g;

/** Mentions encodées `@[Nom](uuid)` (insérées par l'éditeur) : ids uniques, dans l'ordre. */
export function parseMentions(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) if (!ids.includes(m[2]!)) ids.push(m[2]!);
  return ids;
}

/** Texte lisible (e-mails, notifications) : `@[Nom](uuid)` → `@Nom`. */
export function mentionsToPlain(text: string): string {
  return text.replace(MENTION_RE, (_, label: string) => `@${label}`);
}

/** Découpe pour l'affichage : texte et mentions alternés. */
export function splitMentions(text: string): ({ text: string } | { mention: string; id: string })[] {
  const out: ({ text: string } | { mention: string; id: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ mention: m[1]!, id: m[2]! });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/* ------------------------------------------------------------------ À faire */

export type ProjectTodo =
  | {
      kind: 'invoice_overdue';
      ref: string;
      number: string | null;
      amount: Cents;
      days: number;
      severity: 'crit';
    }
  | { kind: 'budget_drift'; ref: string; label: string; overPercent: number; severity: 'warn' }
  | { kind: 'change_order_draft'; ref: string; ordinal: number; title: string; severity: 'info' }
  | {
      kind: 'change_order_awaiting';
      ref: string;
      ordinal: number;
      title: string;
      days: number;
      severity: 'info';
    }
  | { kind: 'client_question'; ref: string; subject: string; author: string; severity: 'warn' }
  | { kind: 'project_late'; ref: string; days: number; severity: 'warn' };

const SEVERITY_ORDER = { crit: 0, warn: 1, info: 2 } as const;

function daysBetween(from: IsoDate, to: IsoDate): number {
  // Deux minuits UTC : la différence est un multiple exact d'un jour.
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/** Construit la liste « À faire » du chantier, triée par gravité puis ancienneté. */
export function projectTodos(input: {
  today: IsoDate;
  projectId: string;
  lateDays?: number;
  invoices: readonly {
    id: string;
    number: string | null;
    status: string;
    dueDate: IsoDate | null;
    balance: Cents;
  }[];
  budgetLines: readonly {
    id: string;
    label: string;
    budgetedCost: Cents;
    committed: Cents;
    drift: boolean;
  }[];
  changeOrders: readonly {
    id: string;
    ordinal: number;
    title: string;
    status: string;
    sentAt: IsoDate | null;
  }[];
  openQuestions: readonly { id: string; subject: string; author: string }[];
}): ProjectTodo[] {
  const todos: (ProjectTodo & { age: number })[] = [];
  for (const inv of input.invoices) {
    if (!['issued', 'sent', 'delivered', 'partially_paid'].includes(inv.status)) continue;
    if (!inv.dueDate || inv.dueDate >= input.today || inv.balance <= 0n) continue;
    const days = daysBetween(inv.dueDate, input.today);
    todos.push({
      kind: 'invoice_overdue',
      ref: inv.id,
      number: inv.number,
      amount: inv.balance,
      days,
      severity: 'crit',
      age: days,
    });
  }
  for (const q of input.openQuestions)
    todos.push({
      kind: 'client_question',
      ref: q.id,
      subject: q.subject,
      author: q.author,
      severity: 'warn',
      age: 0,
    });
  for (const b of input.budgetLines) {
    if (!b.drift) continue;
    const over =
      b.budgetedCost > 0n
        ? new Dec(b.committed.toString())
            .dividedBy(b.budgetedCost.toString())
            .minus(1)
            .times(100)
            .round()
            .toNumber()
        : 100;
    todos.push({
      kind: 'budget_drift',
      ref: b.id,
      label: b.label,
      overPercent: over,
      severity: 'warn',
      age: over,
    });
  }
  if (input.lateDays && input.lateDays > 0)
    todos.push({
      kind: 'project_late',
      ref: input.projectId,
      days: input.lateDays,
      severity: 'warn',
      age: input.lateDays,
    });
  for (const co of input.changeOrders) {
    if (co.status === 'draft')
      todos.push({
        kind: 'change_order_draft',
        ref: co.id,
        ordinal: co.ordinal,
        title: co.title,
        severity: 'info',
        age: 0,
      });
    if (co.status === 'sent') {
      const days = co.sentAt ? Math.max(0, daysBetween(co.sentAt, input.today)) : 0;
      todos.push({
        kind: 'change_order_awaiting',
        ref: co.id,
        ordinal: co.ordinal,
        title: co.title,
        days,
        severity: 'info',
        age: days,
      });
    }
  }
  return todos
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.age - a.age)
    .map(({ age: _age, ...t }) => t as ProjectTodo);
}

/** Pourcentage entier pour l'affichage (62 %), arrondi au plus proche. */
export function percentInt(ratio: DecimalInput): number {
  return new Dec(ratio.toString()).times(100).round().toNumber();
}
