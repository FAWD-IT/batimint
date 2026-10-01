import type { Tone } from '@batimint/ui';

export const QUOTE_STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  sent: 'accent',
  viewed: 'warn',
  signed: 'good',
  refused: 'crit',
  expired: 'crit',
  superseded: 'neutral',
};
