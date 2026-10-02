import type { Tone } from '@batimint/ui';

export const ORDER_STATUS_TONES: Record<string, Tone> = {
  draft: 'neutral',
  sent: 'accent',
  partially_received: 'warn',
  received: 'good',
  cancelled: 'neutral',
};

export const INVOICE_STATUS_TONES: Record<string, Tone> = {
  received: 'neutral',
  to_allocate: 'warn',
  allocated: 'accent',
  validated: 'good',
  to_pay: 'dark',
  blocked: 'crit',
  paid: 'good',
};

/** « 2026-10-02 » → « 2 oct. 2026 ». */
export function formatDay(day: string | null): string {
  if (!day) return '—';
  return new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}
