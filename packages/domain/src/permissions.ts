/**
 * Matrice rôle × action (03 §1, 06 « Permissions »). Source unique, utilisée par l'API (vérité)
 * et par le web (masquage). Les champs financiers sont en plus filtrés côté API pour l'Ouvrier.
 */

export const ROLES = ['owner', 'admin', 'office', 'site_manager', 'worker', 'accountant'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'company.read',
  'company.update',
  'subscription.manage',
  'settings.update',
  'integrations.manage',
  'members.read',
  'members.manage',
  'employees.read',
  'employees.manage',
  'employees.sensitive.read',
  'teams.manage',
  'customers.read',
  'customers.write',
  'leads.read',
  'leads.write',
  'site_visits.write',
  'library.read',
  'library.write',
  'pricing.read',
  'quotes.read',
  'quotes.write',
  'quotes.send',
  'projects.read',
  'projects.write',
  'projects.finance.read',
  'tasks.update',
  'planning.read',
  'planning.write',
  'time.clock',
  'time.clock_team',
  'time.validate',
  'field.report',
  'work_orders.create',
  'receptions.manage',
  'purchases.read',
  'purchases.write',
  'supplier_invoices.read',
  'supplier_invoices.allocate',
  'subcontracting.read',
  'subcontracting.write',
  'invoices.read',
  'invoices.write',
  'invoices.issue',
  'payments.read',
  'payments.write',
  'stock.read',
  'stock.write',
  'equipment.read',
  'equipment.write',
  'reports.read',
  'exports.read',
  'accounting.read',
  'accounting.manage',
  'audit.read',
  'diagnostics.run',
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL: readonly Action[] = ACTIONS;

const OFFICE_EXCLUDED: ReadonlySet<Action> = new Set<Action>([
  'subscription.manage',
  'integrations.manage',
  'members.manage',
  'employees.sensitive.read',
  'audit.read',
  'accounting.manage',
]);

const SITE_MANAGER: readonly Action[] = [
  'company.read',
  'customers.read',
  'leads.read',
  'site_visits.write',
  'members.read',
  'employees.read',
  'library.read',
  'pricing.read',
  'projects.read',
  'tasks.update',
  'planning.read',
  'time.clock',
  'time.clock_team',
  'time.validate',
  'field.report',
  'work_orders.create',
  'receptions.manage',
  'purchases.read',
  'stock.read',
  // Le chef sort le matériel de sa camionnette vers le chantier et affecte l'outillage (P13).
  'stock.write',
  'equipment.read',
  'equipment.write',
];

const WORKER: readonly Action[] = [
  'company.read',
  'projects.read',
  'tasks.update',
  'planning.read',
  'time.clock',
  'field.report',
];

const ACCOUNTANT: readonly Action[] = [
  'company.read',
  'customers.read',
  'pricing.read',
  'quotes.read',
  'projects.read',
  'projects.finance.read',
  'purchases.read',
  'supplier_invoices.read',
  'subcontracting.read',
  'invoices.read',
  'payments.read',
  'reports.read',
  'exports.read',
  'accounting.read',
];

export const PERMISSION_MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter((a) => a !== 'subscription.manage')),
  office: new Set(ALL.filter((a) => !OFFICE_EXCLUDED.has(a))),
  site_manager: new Set(SITE_MANAGER),
  worker: new Set(WORKER),
  accountant: new Set(ACCOUNTANT),
};

export function can(role: Role, action: Action): boolean {
  return PERMISSION_MATRIX[role].has(action);
}

export function permissionsOf(role: Role): Action[] {
  return ACTIONS.filter((a) => can(role, a));
}

/** L'Ouvrier ne voit ni prix, ni coûts, ni marges (03 §1). */
export function canSeePrices(role: Role): boolean {
  return can(role, 'pricing.read');
}

export function canSeeMargins(role: Role): boolean {
  return can(role, 'projects.finance.read');
}

/** Le Comptable ne modifie rien (03 §1) : vrai si le rôle n'a que des actions de lecture. */
export function isReadOnlyRole(role: Role): boolean {
  return permissionsOf(role).every((a) => /\.(read)$/.test(a));
}

/** Rôles qu'un rôle donné peut attribuer à une invitation. */
export function assignableRoles(role: Role): Role[] {
  if (role === 'owner') return [...ROLES];
  if (role === 'admin') return ROLES.filter((r) => r !== 'owner');
  return [];
}

/** Ordre d'importance pour l'affichage. */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Noms de champs considérés comme financiers. Toute réponse API destinée à l'Ouvrier
 * en est expurgée (filet de sécurité en plus des sérialiseurs dédiés).
 */
export const FINANCIAL_FIELD_PATTERN =
  /(price|cost|amount|margin|total|budget|rate|vat|discount|coefficient|cents|invoic|paid|payable)/i;

export function redactFinancialFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactFinancialFields(v)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FINANCIAL_FIELD_PATTERN.test(k)) continue;
      out[k] = redactFinancialFields(v);
    }
    return out as T;
  }
  return value;
}
