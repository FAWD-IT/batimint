'use client';

import type { ChangeOrderSummaryDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Button, Chip, EmptyState, Skeleton, Table, Td, Th } from '@batimint/ui';
import { FilePlus2, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useRelativeTime } from '@/lib/use-relative-time';
import { CHANGE_ORDER_TONES } from './status';

export function ChangeOrdersTab({
  projectId,
  onOpen,
  onNew,
}: {
  projectId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  const t = useTranslations('changeOrders');
  const can = useCan();
  const relative = useRelativeTime();
  const list = useApi<{ items: ChangeOrderSummaryDto[] }>(
    ['change_orders', 'list', projectId],
    `/projects/${projectId}/change-orders`,
  );
  if (list.isLoading) return <Skeleton className="h-48" />;
  const items = list.data?.items ?? [];
  if (!items.length)
    return (
      <EmptyState
        icon={<FilePlus2 aria-hidden className="size-5" />}
        title={t('title')}
        description={t('empty')}
        action={can('projects.write') ? <Button onClick={onNew}>{t('new')}</Button> : null}
      />
    );
  return (
    <Table label={t('title')}>
      <thead>
        <tr>
          <Th>{t('title')}</Th>
          <Th className="hidden sm:table-cell">{t('delayColumn')}</Th>
          <Th align="right">{t('editor.net')}</Th>
          <Th align="right">{t('editor.gross')}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((co) => (
          <tr key={co.id} className="hover:bg-line-soft/40">
            <Td>
              <button
                type="button"
                onClick={() => onOpen(co.id)}
                className="flex min-h-11 flex-col justify-center rounded-[8px] text-left focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="font-medium hover:underline">
                  {t('ordinal', { n: co.ordinal })} · {co.title}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Chip tone={CHANGE_ORDER_TONES[co.status]} dot>
                    {t(`status.${co.status}`)}
                  </Chip>
                  {co.number ? <span className="font-mono">{co.number}</span> : null}
                  {co.signedAt ? (
                    <span>{relative(co.signedAt)}</span>
                  ) : co.sentAt ? (
                    <span>{relative(co.sentAt)}</span>
                  ) : null}
                  {co.openQuestions ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-accent">
                      <MessageCircle aria-hidden className="size-3.5" />
                      {t('questions', { n: co.openQuestions })}
                    </span>
                  ) : null}
                </span>
              </button>
            </Td>
            <Td className="hidden text-[13px] text-muted sm:table-cell">
              {t('delay', { days: co.delayDays })}
            </Td>
            <Td align="right" className="tabular-nums">
              {formatEuros(BigInt(co.totalNet))}
            </Td>
            <Td align="right" className="tabular-nums">
              {formatEuros(BigInt(co.totalGross))}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
