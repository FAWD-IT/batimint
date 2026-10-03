'use client';

import type { ComplianceDto, ThirtyBisCheckDto } from '@batimint/contracts';
import { Chip, type Tone } from '@batimint/ui';
import { useTranslations } from 'next-intl';

export const DOC_STATUS_TONE: Record<string, Tone> = {
  valid: 'good',
  expiring: 'warn',
  expired: 'crit',
  missing: 'crit',
};

export const CONTRACT_STATUS_TONE: Record<string, Tone> = {
  active: 'accent',
  completed: 'good',
  cancelled: 'neutral',
};

export const formatDay = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('fr-BE', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(d.length === 10 ? `${d}T00:00:00Z` : d))
    : '—';

export const formatDateTime = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date(d));

/** Résultat de la dernière consultation 30bis : la couleur est toujours doublée d'un libellé. */
export function ThirtyBisChip({ check }: { check: ThirtyBisCheckDto | null }) {
  const t = useTranslations('subcontracting.thirtyBis');
  if (!check) return <Chip tone="neutral">{t('never')}</Chip>;
  const debt = check.hasSocialDebt || check.hasTaxDebt;
  return (
    <Chip tone={debt ? 'crit' : 'good'} dot>
      {debt
        ? check.hasSocialDebt && check.hasTaxDebt
          ? t('bothDebts')
          : check.hasSocialDebt
            ? t('socialDebt')
            : t('taxDebt')
        : t('clear')}
    </Chip>
  );
}

/** Conformité documentaire : « En règle », « 2 documents à fournir », « 1 bientôt expiré ». */
export function ComplianceChip({ compliance }: { compliance: ComplianceDto }) {
  const t = useTranslations('subcontracting.compliance');
  const expiring = compliance.requirements.filter((r) => r.status === 'expiring').length;
  if (!compliance.compliant)
    return (
      <Chip tone="crit" dot>
        {t('issues', { n: compliance.issues })}
      </Chip>
    );
  if (expiring)
    return (
      <Chip tone="warn" dot>
        {t('expiring', { n: expiring })}
      </Chip>
    );
  return (
    <Chip tone="good" dot>
      {t('ok')}
    </Chip>
  );
}
