'use client';

import type { SupplierInvoiceDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Card, Chip, Notice } from '@batimint/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDateTime, ThirtyBisChip } from './shared';

/**
 * Facture d'un sous-traitant (05 §7) : dernière consultation 30bis, retenue calculée, solde à
 * payer et document de versement une fois la retenue appliquée.
 */
export function ThirtyBisPanel({ invoice: i }: { invoice: SupplierInvoiceDto }) {
  const t = useTranslations('subcontracting.invoice');
  const b = i.thirtyBis;
  if (!b) return null;
  const withheld = b.social + b.tax;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="thirty-bis-title" className="text-[15px] font-semibold">
          {t('title')}
          {i.subcontract ? (
            <span className="font-normal text-muted">
              {' '}
              · {t('contract', { number: i.subcontract.number })}
            </span>
          ) : null}
        </h3>
        <ThirtyBisChip check={b.check} />
      </div>
      {b.check ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {t(`checked.${b.check.context}`, { at: formatDateTime(b.check.checkedAt) })}
          {b.check.proofUrl ? (
            <a
              href={b.check.proofUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('proof')}
            </a>
          ) : null}
        </p>
      ) : (
        <p className="text-[13px] text-muted">{t('notChecked')}</p>
      )}
      {withheld > 0 ? (
        <dl className="grid grid-cols-1 gap-2 text-[14px] sm:grid-cols-3">
          {b.social > 0 ? <Row label={t('social')} value={formatEuros(BigInt(b.social))} /> : null}
          {b.tax > 0 ? <Row label={t('tax')} value={formatEuros(BigInt(b.tax))} /> : null}
          <Row label={t('payable')} value={formatEuros(BigInt(b.payableToSubcontractor))} strong />
        </dl>
      ) : null}
      {b.blockedReason ? (
        <Notice tone="crit" title={t('blockedTitle')}>
          {b.blockedReason} {t('blockedHelp')}
        </Notice>
      ) : null}
      {b.appliedAt ? (
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <Chip tone="accent" dot>
            {t('applied', { amount: formatEuros(BigInt(withheld)) })}
          </Chip>
          {b.transferDocumentUrl ? (
            <a
              href={b.transferDocumentUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('transferDocument')}
            </a>
          ) : null}
        </div>
      ) : withheld > 0 && !b.blockedReason ? (
        <p className="text-[13px] text-muted">{t('atPayment')}</p>
      ) : null}
      {i.supplier.id ? (
        <Link
          href={`/sous-traitance/${i.supplier.id}`}
          className="inline-flex min-h-11 w-fit items-center text-[14px] font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {t('openSubcontractor')}
        </Link>
      ) : null}
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}
