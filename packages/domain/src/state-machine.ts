/**
 * Cycles de vie (04 « Cycles de vie ») : fonctions pures qui refusent les transitions illégales.
 */

export class IllegalTransitionError extends Error {
  constructor(
    public readonly machine: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Transition interdite (${machine}) : ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export interface StateMachine<S extends string> {
  name: string;
  states: readonly S[];
  initial: S;
  transitions: Readonly<Record<S, readonly S[]>>;
  terminal: readonly S[];
}

function defineMachine<S extends string>(m: StateMachine<S>): StateMachine<S> {
  return m;
}

export function canTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): boolean {
  return machine.transitions[from]?.includes(to) ?? false;
}

export function assertTransition<S extends string>(machine: StateMachine<S>, from: S, to: S): S {
  if (!canTransition(machine, from, to)) throw new IllegalTransitionError(machine.name, from, to);
  return to;
}

export function nextStates<S extends string>(machine: StateMachine<S>, from: S): readonly S[] {
  return machine.transitions[from] ?? [];
}

export const QuoteStatus = defineMachine({
  name: 'quote',
  states: ['draft', 'sent', 'viewed', 'signed', 'refused', 'expired', 'superseded'] as const,
  initial: 'draft',
  transitions: {
    draft: ['sent'],
    sent: ['viewed', 'signed', 'refused', 'expired', 'superseded'],
    viewed: ['signed', 'refused', 'expired', 'superseded'],
    signed: [],
    refused: ['superseded'],
    expired: ['superseded'],
    superseded: [],
  },
  terminal: ['signed', 'superseded'],
});
export type QuoteStatus = (typeof QuoteStatus.states)[number];

export const ChangeOrderStatus = defineMachine({
  name: 'change_order',
  states: ['draft', 'sent', 'signed', 'refused'] as const,
  initial: 'draft',
  transitions: { draft: ['sent'], sent: ['signed', 'refused', 'draft'], signed: [], refused: ['draft'] },
  terminal: ['signed'],
});
export type ChangeOrderStatus = (typeof ChangeOrderStatus.states)[number];

export const ProjectStatus = defineMachine({
  name: 'project',
  states: [
    'preparation',
    'in_progress',
    'suspended',
    'provisional_acceptance',
    'final_acceptance',
    'closed',
  ] as const,
  initial: 'preparation',
  transitions: {
    preparation: ['in_progress', 'suspended'],
    in_progress: ['suspended', 'provisional_acceptance'],
    suspended: ['in_progress', 'preparation'],
    provisional_acceptance: ['final_acceptance', 'in_progress'],
    final_acceptance: ['closed'],
    closed: [],
  },
  terminal: ['closed'],
});
export type ProjectStatus = (typeof ProjectStatus.states)[number];

export const ProgressStatementStatus = defineMachine({
  name: 'progress_statement',
  states: ['draft', 'submitted', 'approved', 'disputed', 'invoiced'] as const,
  initial: 'draft',
  transitions: {
    draft: ['submitted', 'approved'],
    submitted: ['approved', 'disputed'],
    disputed: ['draft'],
    approved: ['invoiced'],
    invoiced: [],
  },
  terminal: ['invoiced'],
});
export type ProgressStatementStatus = (typeof ProgressStatementStatus.states)[number];

export const InvoiceStatus = defineMachine({
  name: 'invoice',
  states: ['draft', 'issued', 'sent', 'delivered', 'partially_paid', 'paid', 'cancelled'] as const,
  initial: 'draft',
  transitions: {
    draft: ['issued'],
    issued: ['sent', 'partially_paid', 'paid', 'cancelled'],
    sent: ['delivered', 'partially_paid', 'paid', 'cancelled'],
    delivered: ['partially_paid', 'paid', 'cancelled'],
    partially_paid: ['paid', 'cancelled'],
    paid: [],
    cancelled: [],
  },
  terminal: ['paid', 'cancelled'],
});
export type InvoiceStatus = (typeof InvoiceStatus.states)[number];

/** Une facture émise est immuable (règle n°4) : seul le brouillon est modifiable. */
export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === 'draft';
}

export const SupplierInvoiceStatus = defineMachine({
  name: 'supplier_invoice',
  states: ['received', 'to_allocate', 'allocated', 'validated', 'to_pay', 'blocked', 'paid'] as const,
  initial: 'received',
  transitions: {
    received: ['to_allocate', 'allocated'],
    to_allocate: ['allocated'],
    allocated: ['to_allocate', 'validated'],
    validated: ['to_pay', 'blocked', 'allocated'],
    blocked: ['to_pay', 'validated'],
    to_pay: ['paid', 'blocked'],
    paid: [],
  },
  terminal: ['paid'],
});
export type SupplierInvoiceStatus = (typeof SupplierInvoiceStatus.states)[number];

export const TimeEntryStatus = defineMachine({
  name: 'time_entry',
  states: ['recorded', 'synced', 'validated', 'transmitted'] as const,
  initial: 'recorded',
  transitions: {
    recorded: ['synced'],
    synced: ['validated'],
    validated: ['transmitted', 'synced'],
    transmitted: [],
  },
  terminal: ['transmitted'],
});
export type TimeEntryStatus = (typeof TimeEntryStatus.states)[number];

export const ALL_MACHINES = [
  QuoteStatus,
  ChangeOrderStatus,
  ProjectStatus,
  ProgressStatementStatus,
  InvoiceStatus,
  SupplierInvoiceStatus,
  TimeEntryStatus,
] as const;
