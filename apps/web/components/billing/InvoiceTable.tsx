'use client';

import type { InvoiceSummaryDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Chip, Table, Td, Th } from '@batimint/ui';
import { AlertTriangle, Mail, Send } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDay, INVOICE_TONES } from './status';

/** Tableau de factures (liste générale et onglet du chantier). */
export function InvoiceTable({
  items,
  showProject = true,
}: {
  items: InvoiceSummaryDto[];
  showProject?: boolean;
}) {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  return (
    <Table label={t('title')}>
      <thead>
        <tr>
          <Th>{t('columns.invoice')}</Th>
          <Th className="hidden md:table-cell">{t('columns.customer')}</Th>
          <Th className="hidden lg:table-cell">{t('columns.due')}</Th>
          <Th align="right">{t('columns.gross')}</Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('columns.balance')}
          </Th>
          <Th align="right">{tc('status')}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => {
          const credit = i.type === 'credit_note';
          return (
            <tr key={i.id} className="hover:bg-line-soft/40">
              <Td>
                <Link
                  href={`/facturation/${i.id}`}
                  className="flex min-h-11 flex-col justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="font-medium hover:underline">
                    {i.number ? (
                      <span className="font-mono text-[13px]">{i.number}</span>
                    ) : (
                      <span className="text-muted">{t('draft')}</span>
                    )}
                    <span className="ml-2">{t(`type.${i.type}`)}</span>
                  </span>
                  <span className="line-clamp-1 text-[12px] text-muted">
                    {i.title}
                    {showProject && i.project ? ` · ${i.project.number}` : ''}
                  </span>
                  <span className="text-[12px] text-muted md:hidden">{i.customer.displayName}</span>
                </Link>
              </Td>
              <Td className="hidden text-[14px] md:table-cell">{i.customer.displayName}</Td>
              <Td className="hidden text-[13px] lg:table-cell">
                {i.overdue ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-crit">
                    <AlertTriangle aria-hidden className="size-3.5" />
                    {t('late', { n: i.daysLate })}
                  </span>
                ) : (
                  formatDay(i.dueDate)
                )}
                {i.deliveryChannel ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                    {i.deliveryChannel === 'peppol' ? (
                      <Send aria-hidden className="size-3" />
                    ) : (
                      <Mail aria-hidden className="size-3" />
                    )}
                    {t(`delivery.${i.deliveryChannel}`)}
                  </span>
                ) : null}
              </Td>
              <Td align="right" className="tabular-nums">
                {formatEuros(BigInt(credit ? -i.totalGross : i.totalGross))}
              </Td>
              <Td align="right" className="hidden tabular-nums sm:table-cell">
                {i.balance ? formatEuros(BigInt(i.balance)) : '—'}
              </Td>
              <Td align="right">
                <Chip tone={i.overdue ? 'crit' : (INVOICE_TONES[i.status] ?? 'neutral')} dot>
                  {i.overdue ? t('status.overdue') : t(`status.${i.status}`)}
                </Chip>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
