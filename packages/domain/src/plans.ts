/**
 * Plans et modules (01 « Modèle commercial », 03) : abonnement par utilisateur « bureau »,
 * ouvriers illimités, trois plans activant des modules via des drapeaux par tenant.
 */
import type { Role } from './permissions';

export const PLANS = ['essential', 'pro', 'expert'] as const;
export type Plan = (typeof PLANS)[number];

export const FEATURES = [
  'crm',
  'library',
  'quotes',
  'projects',
  'field',
  'planning',
  'purchases',
  'peppol',
  'invoicing',
  'subcontracting',
  'stock',
  'equipment',
  'reports',
  'accounting_sync',
  'client_portal',
  'ai_assistant',
  'check_in_out',
] as const;
export type Feature = (typeof FEATURES)[number];

const ESSENTIAL: Feature[] = [
  'crm',
  'library',
  'quotes',
  'projects',
  'field',
  'invoicing',
  'peppol',
  'client_portal',
];
const PRO: Feature[] = [
  ...ESSENTIAL,
  'planning',
  'purchases',
  'subcontracting',
  'reports',
  'accounting_sync',
  'check_in_out',
];

export const PLAN_FEATURES: Record<Plan, readonly Feature[]> = {
  essential: ESSENTIAL,
  pro: PRO,
  expert: FEATURES,
};

/** Drapeaux par tenant : `{ all: true }` (démo) ou surcharge par module `{ stock: true, ai_assistant: false }`. */
export type FeatureFlags = Partial<Record<Feature, boolean>> & { all?: boolean };

export function isFeatureEnabled(
  plan: Plan,
  flags: FeatureFlags | null | undefined,
  feature: Feature,
): boolean {
  if (flags?.all) return true;
  const override = flags?.[feature];
  if (typeof override === 'boolean') return override;
  return PLAN_FEATURES[plan].includes(feature);
}

export function enabledFeatures(plan: Plan, flags: FeatureFlags | null | undefined): Feature[] {
  return FEATURES.filter((f) => isFeatureEnabled(plan, flags, f));
}

/** Rôles facturés (« bureau ») : les ouvriers et chefs de chantier sont illimités. */
export const BILLABLE_ROLES: readonly Role[] = ['owner', 'admin', 'office', 'accountant'];

export function billableSeats(roles: readonly Role[]): number {
  return roles.filter((r) => BILLABLE_ROLES.includes(r)).length;
}

export const TRIAL_DAYS = 14;

export function trialDaysLeft(trialEndsAt: Date | null, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
