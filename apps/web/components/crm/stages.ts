import type { OpportunityStage } from '@batimint/domain';
import type { Tone } from '@batimint/ui';

export const STAGE_TONES: Record<OpportunityStage, Tone> = {
  new: 'accent',
  visit_planned: 'warn',
  quoting: 'neutral',
  sent: 'dark',
  won: 'good',
  lost: 'crit',
};
