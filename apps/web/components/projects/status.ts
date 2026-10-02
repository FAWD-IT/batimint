import type { ProjectStatusDto } from '@batimint/contracts';
import type { Tone } from '@batimint/ui';

export const PROJECT_STATUS_TONES: Record<ProjectStatusDto, Tone> = {
  preparation: 'neutral',
  in_progress: 'accent',
  suspended: 'warn',
  provisional_acceptance: 'good',
  final_acceptance: 'good',
  closed: 'dark',
};

export const HEALTH_TONES = { ok: 'good', warn: 'warn', crit: 'crit' } as const;

export const CHANGE_ORDER_TONES = {
  draft: 'neutral',
  sent: 'accent',
  signed: 'good',
  refused: 'crit',
} as const;

/** Date civile ISO (YYYY-MM-DD) → « 9 octobre » (ou avec l'année si différente). */
export function formatDay(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const sameYear = d.getUTCFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-BE', {
    day: 'numeric',
    month: 'long',
    ...(withYear || !sameYear ? { year: 'numeric' } : {}),
    timeZone: 'Europe/Brussels',
  });
}

/** Taux de marge avec une décimale, toujours affichée (« 24,0 % »), comme la maquette. */
export function formatRate(ratio: string | null | undefined): string {
  if (ratio === null || ratio === undefined) return '—';
  const pct = (Number(ratio) * 100).toFixed(1).replace('.', ',').replace('-', '−');
  return `${pct}\u202f%`;
}

/** Écart en points entre deux taux (« −2,2 »). */
export function formatPoints(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to) return null;
  const d = (Number(to) - Number(from)) * 100;
  const s = Math.abs(d).toFixed(1).replace('.', ',');
  return `${d < 0 ? '−' : '+'}${s}`;
}
