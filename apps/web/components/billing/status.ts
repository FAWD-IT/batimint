import type { Tone } from '@batimint/ui';

export const INVOICE_TONES: Record<string, Tone> = {
  draft: 'neutral',
  issued: 'accent',
  sent: 'accent',
  delivered: 'accent',
  partially_paid: 'warn',
  paid: 'good',
  cancelled: 'neutral',
};

export const STATEMENT_TONES: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'accent',
  approved: 'good',
  disputed: 'crit',
  invoiced: 'dark',
};

export function formatDay(day: string | null): string {
  if (!day) return '—';
  return new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day.slice(0, 10)}T00:00:00Z`));
}

/** « 41.5 » → « 41,5 % ». */
export const pct = (v: string) => `${Number(v).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} %`;
