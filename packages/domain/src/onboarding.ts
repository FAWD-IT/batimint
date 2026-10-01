/**
 * Checklist d'onboarding (02 P1.7) : visible tant qu'elle n'est pas complète,
 * chaque étape renvoie au bon écran.
 */

export const ONBOARDING_STEPS = [
  'company',
  'bank',
  'branding',
  'terms',
  'rates',
  'library',
  'peppol',
  'team',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  vatValidated: boolean;
  hasAddress: boolean;
  hasIban: boolean;
  hasLogo: boolean;
  hasTerms: boolean;
  hasHourlyRates: boolean;
  libraryItemCount: number;
  peppolStatus: 'not_connected' | 'pending' | 'active' | 'error';
  invitedOrMembers: number;
}

export interface OnboardingStepStatus {
  step: OnboardingStep;
  done: boolean;
  href: string;
}

const HREFS: Record<OnboardingStep, string> = {
  company: '/parametres/entreprise',
  bank: '/parametres/entreprise#banque',
  branding: '/parametres/entreprise#image',
  terms: '/parametres/entreprise#conditions',
  rates: '/parametres/metier',
  library: '/bibliotheque',
  peppol: '/parametres/integrations',
  team: '/parametres/utilisateurs',
};

export function onboardingChecklist(
  state: OnboardingState,
  availableSteps: readonly OnboardingStep[] = ONBOARDING_STEPS,
) {
  const done: Record<OnboardingStep, boolean> = {
    company: state.vatValidated && state.hasAddress,
    bank: state.hasIban,
    branding: state.hasLogo,
    terms: state.hasTerms,
    rates: state.hasHourlyRates,
    library: state.libraryItemCount > 0,
    peppol: state.peppolStatus === 'active' || state.peppolStatus === 'pending',
    team: state.invitedOrMembers > 1,
  };
  const steps: OnboardingStepStatus[] = availableSteps.map((step) => ({
    step,
    done: done[step],
    href: HREFS[step],
  }));
  const completed = steps.filter((s) => s.done).length;
  return { steps, completed, total: steps.length, complete: completed === steps.length };
}
