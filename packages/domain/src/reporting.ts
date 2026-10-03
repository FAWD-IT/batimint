/**
 * Pilotage (03 §12, 02 P11) : périodes, transformation des devis, carnet de commandes, marges
 * groupées, heures comparées au prévu et trésorerie prévisionnelle à 90 jours. Fonctions pures :
 * les chiffres du tableau de bord se recalculent toujours depuis les données (09).
 */
import { addDays, type IsoDate, isWorkingDay } from './calendar';
import { addMonths } from './reception';
import { type Cents, dec, type DecimalInput, multiplyCents, ratio, sumCents } from './money';

export class ReportingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReportingError';
  }
}

// ---------------------------------------------------------------------------
// Périodes
// ---------------------------------------------------------------------------

export type PeriodKind = 'month' | 'quarter' | 'year' | 'custom';

export interface Period {
  from: IsoDate;
  to: IsoDate;
}

const firstOfMonth = (d: IsoDate) => `${d.slice(0, 7)}-01`;
const lastOfMonth = (d: IsoDate) => addDays(addMonths(firstOfMonth(d), 1), -1);

/** Bornes incluses d'une période contenant `today` (mois, trimestre, année civile) ou libre. */
export function periodBounds(kind: PeriodKind, today: IsoDate, custom?: Partial<Period>): Period {
  switch (kind) {
    case 'month':
      return { from: firstOfMonth(today), to: lastOfMonth(today) };
    case 'quarter': {
      const m = Number(today.slice(5, 7));
      const start = `${today.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, '0')}-01`;
      return { from: start, to: addDays(addMonths(start, 3), -1) };
    }
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom': {
      if (!custom?.from || !custom.to)
        throw new ReportingError('invalid_period', 'Choisissez une date de début et une date de fin.');
      if (custom.to < custom.from)
        throw new ReportingError('invalid_period', 'La date de fin précède la date de début.');
      return { from: custom.from, to: custom.to };
    }
  }
}

export const inPeriod = (d: IsoDate | null | undefined, p: Period): boolean =>
  Boolean(d && d >= p.from && d <= p.to);

// ---------------------------------------------------------------------------
// Devis, carnet de commandes, marges, heures
// ---------------------------------------------------------------------------

export interface QuoteForConversion {
  status: string;
  amount: Cents;
}

export interface QuoteConversion {
  sent: number;
  signed: number;
  refused: number;
  expired: number;
  open: number;
  /** Signés / décidés (signés + refusés + expirés), null tant que rien n'est décidé. */
  rate: string | null;
  amountSent: Cents;
  amountSigned: Cents;
}

/** Transformation des devis envoyés sur la période (02 P11). */
export function quoteConversion(quotes: readonly QuoteForConversion[]): QuoteConversion {
  const by = (s: string[]) => quotes.filter((q) => s.includes(q.status));
  const signed = by(['signed']);
  const refused = by(['refused']);
  const expired = by(['expired']);
  const decided = signed.length + refused.length + expired.length;
  const r = decided ? ratio(BigInt(signed.length), BigInt(decided)) : null;
  return {
    sent: quotes.length,
    signed: signed.length,
    refused: refused.length,
    expired: expired.length,
    open: quotes.length - decided,
    rate: r ? r.toDecimalPlaces(4).toString() : null,
    amountSent: sumCents(quotes.map((q) => q.amount)),
    amountSigned: sumCents(signed.map((q) => q.amount)),
  };
}

/** Carnet de commandes : contrats signés (avenants compris) restant à facturer, HTVA. */
export function orderBook(projects: readonly { contractAmount: Cents; invoicedNet: Cents }[]): Cents {
  return sumCents(
    projects.map((p) => (p.contractAmount > p.invoicedNet ? p.contractAmount - p.invoicedNet : 0n)),
  );
}

export interface MarginRow {
  key: string;
  label: string;
  sold: Cents;
  cost: Cents;
}

export interface MarginGroup extends MarginRow {
  count: number;
  margin: Cents;
  /** Marge / vendu, null si rien n'est vendu. */
  marginRate: string | null;
}

/** Rentabilité regroupée (par chantier, client ou type de travaux), triée par vendu décroissant. */
export function groupMargins(rows: readonly MarginRow[]): MarginGroup[] {
  const groups = new Map<string, MarginGroup>();
  for (const r of rows) {
    const g = groups.get(r.key) ?? {
      key: r.key,
      label: r.label,
      sold: 0n,
      cost: 0n,
      count: 0,
      margin: 0n,
      marginRate: null,
    };
    g.sold += r.sold;
    g.cost += r.cost;
    g.count += 1;
    groups.set(r.key, g);
  }
  return [...groups.values()]
    .map((g) => {
      const margin = g.sold - g.cost;
      const rate = ratio(margin, g.sold);
      return { ...g, margin, marginRate: rate ? rate.toDecimalPlaces(4).toString() : null };
    })
    .sort((a, b) => (a.sold === b.sold ? a.label.localeCompare(b.label) : a.sold > b.sold ? -1 : 1));
}

export interface HoursRow {
  key: string;
  label: string;
  actualMinutes: number;
  plannedMinutes: number;
}

export interface HoursGroup extends HoursRow {
  varianceMinutes: number;
  /** Réel / prévu, null sans prévision. */
  ratio: string | null;
}

/** Heures réelles comparées au prévu (03 §12), regroupées par personne ou par chantier. */
export function hoursVsPlanned(rows: readonly HoursRow[]): HoursGroup[] {
  const groups = new Map<string, HoursRow>();
  for (const r of rows) {
    const g = groups.get(r.key) ?? { key: r.key, label: r.label, actualMinutes: 0, plannedMinutes: 0 };
    g.actualMinutes += r.actualMinutes;
    g.plannedMinutes += r.plannedMinutes;
    groups.set(r.key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      varianceMinutes: g.actualMinutes - g.plannedMinutes,
      ratio: g.plannedMinutes
        ? dec(g.actualMinutes).dividedBy(g.plannedMinutes).toDecimalPlaces(4).toString()
        : null,
    }))
    .sort((a, b) => b.actualMinutes - a.actualMinutes || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Trésorerie prévisionnelle (03 §12 : factures émises, échéanciers, achats à payer, salaires)
// ---------------------------------------------------------------------------

export type CashFlowKind =
  'receivable' | 'retention' | 'planned_billing' | 'payable' | 'subcontract' | 'payroll';

export interface CashFlowItem {
  date: IsoDate;
  /** Toujours positif : le sens vient de la liste (entrées ou sorties). */
  amount: Cents;
  kind: CashFlowKind;
  label: string;
  ref?: { type: string; id: string } | undefined;
}

export interface CashForecastInput {
  today: IsoDate;
  horizonDays?: number;
  /** Solde bancaire de départ, s'il est connu (sinon on raisonne en flux nets cumulés). */
  openingBalance?: Cents | null;
  inflows: readonly CashFlowItem[];
  outflows: readonly CashFlowItem[];
}

export interface CashWeek {
  start: IsoDate;
  end: IsoDate;
  inflow: Cents;
  outflow: Cents;
  net: Cents;
  /** Solde (ou cumul des flux nets sans solde de départ) en fin de semaine. */
  balance: Cents;
}

export interface CashForecastItem extends CashFlowItem {
  direction: 'in' | 'out';
  /** Échéance dépassée : attendue dès aujourd'hui. */
  overdue: boolean;
  /** Date retenue dans la prévision (aujourd'hui pour un retard). */
  expectedOn: IsoDate;
}

export interface CashForecast {
  from: IsoDate;
  to: IsoDate;
  openingBalance: Cents | null;
  weeks: CashWeek[];
  totals: { inflow: Cents; outflow: Cents; net: Cents };
  overdue: { inflow: Cents; outflow: Cents };
  /** Point bas de la période (fin de semaine). */
  lowest: { date: IsoDate; balance: Cents } | null;
  items: CashForecastItem[];
}

/**
 * Prévision par semaine sur `horizonDays` (90 par défaut) : une échéance dépassée est attendue
 * aujourd'hui (et signalée), une échéance au-delà de l'horizon est ignorée.
 */
export function cashForecast(input: CashForecastInput): CashForecast {
  const horizon = input.horizonDays ?? 90;
  if (!Number.isInteger(horizon) || horizon < 1)
    throw new ReportingError('invalid_horizon', 'L’horizon de prévision est un nombre de jours positif.');
  const from = input.today;
  const to = addDays(from, horizon);
  const place =
    (direction: 'in' | 'out') =>
    (i: CashFlowItem): CashForecastItem | null => {
      if (i.amount < 0n)
        throw new ReportingError('invalid_amount', 'Un flux de trésorerie est un montant positif.');
      if (i.date > to || i.amount === 0n) return null;
      const overdue = i.date < from;
      return { ...i, direction, overdue, expectedOn: overdue ? from : i.date };
    };
  const items = [...input.inflows.map(place('in')), ...input.outflows.map(place('out'))]
    .filter((x): x is CashForecastItem => x !== null)
    .sort((a, b) => a.expectedOn.localeCompare(b.expectedOn) || a.direction.localeCompare(b.direction));
  const opening = input.openingBalance ?? null;
  let balance = opening ?? 0n;
  const weeks: CashWeek[] = [];
  for (let start = from; start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6) < to ? addDays(start, 6) : to;
    const mine = items.filter((i) => i.expectedOn >= start && i.expectedOn <= end);
    const inflow = sumCents(mine.filter((i) => i.direction === 'in').map((i) => i.amount));
    const outflow = sumCents(mine.filter((i) => i.direction === 'out').map((i) => i.amount));
    balance += inflow - outflow;
    weeks.push({ start, end, inflow, outflow, net: inflow - outflow, balance });
  }
  const inflow = sumCents(weeks.map((w) => w.inflow));
  const outflow = sumCents(weeks.map((w) => w.outflow));
  const lowest = weeks.reduce<{ date: IsoDate; balance: Cents } | null>(
    (low, w) => (!low || w.balance < low.balance ? { date: w.end, balance: w.balance } : low),
    null,
  );
  return {
    from,
    to,
    openingBalance: opening,
    weeks,
    totals: { inflow, outflow, net: inflow - outflow },
    overdue: {
      inflow: sumCents(items.filter((i) => i.overdue && i.direction === 'in').map((i) => i.amount)),
      outflow: sumCents(items.filter((i) => i.overdue && i.direction === 'out').map((i) => i.amount)),
    },
    lowest,
    items,
  };
}

/** Heures hebdomadaires de référence (régime de 38 h, construction) [à valider]. */
export const DEFAULT_WEEKLY_HOURS = '38';

/**
 * Masse salariale mensuelle estimée : coût horaire employeur × heures hebdomadaires × 52 / 12,
 * arrondi au centime par personne.
 */
export function monthlyPayroll(
  employees: readonly { hourlyCost: Cents; weeklyHours?: DecimalInput | null }[],
): Cents {
  return sumCents(
    employees.map((e) =>
      multiplyCents(
        e.hourlyCost,
        dec(e.weeklyHours ?? DEFAULT_WEEKLY_HOURS)
          .times(52)
          .dividedBy(12),
      ),
    ),
  );
}

/** Dernier jour ouvré du mois de `d`. */
export function lastWorkingDayOfMonth(d: IsoDate): IsoDate {
  let cur = lastOfMonth(d);
  while (!isWorkingDay(cur)) cur = addDays(cur, -1);
  return cur;
}

/** Salaires estimés : une sortie le dernier jour ouvré de chaque mois de l'horizon. */
export function payrollOutflows(monthly: Cents, today: IsoDate, horizonDays = 90): CashFlowItem[] {
  if (monthly <= 0n) return [];
  const to = addDays(today, horizonDays);
  const out: CashFlowItem[] = [];
  for (let m = firstOfMonth(today); m <= to; m = addMonths(m, 1)) {
    const pay = lastWorkingDayOfMonth(m);
    if (pay >= today && pay <= to)
      out.push({ date: pay, amount: monthly, kind: 'payroll', label: `Salaires ${m.slice(0, 7)}` });
  }
  return out;
}
