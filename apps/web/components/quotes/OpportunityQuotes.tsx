'use client';

import type { OpportunityDto, QuoteSummaryDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import { Button, Card, CardTitle, Chip, Skeleton } from '@batimint/ui';
import { FilePlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { NewQuoteDialog } from './NewQuoteDialog';
import { QUOTE_STATUS_TONES } from './status';

/** Carte « Devis » de l'affaire (P2.3 : le devis se crée depuis l'opportunité). */
export function OpportunityQuotes({ opportunity }: { opportunity: OpportunityDto }) {
  const t = useTranslations('quotes');
  const can = useCan();
  const [creating, setCreating] = useState(false);
  const list = useApi<{ items: QuoteSummaryDto[] }>(
    ['quotes', 'opportunity', opportunity.id],
    `/quotes?opportunityId=${opportunity.id}`,
  );
  const items = list.data?.items ?? [];
  return (
    <Card className="flex flex-col gap-3">
      <CardTitle as="h3">{t('title')}</CardTitle>
      {list.isLoading ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-[14px] text-muted">{t('noneForOpportunity')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((q) => (
            <li key={q.id}>
              <Link
                href={`/devis/${q.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-[12px] border border-line px-3 py-2 hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium">
                    {q.number} · {q.title}
                  </span>
                  <span className="block text-[12px] text-muted tabular-nums">
                    {formatEuros(BigInt(q.totalGross))}
                  </span>
                </span>
                <Chip tone={QUOTE_STATUS_TONES[q.status]} dot>
                  {t(`status.${q.status}`)}
                </Chip>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {can('quotes.write') ? (
        <Button
          variant={items.length ? 'secondary' : 'primary'}
          className="self-start"
          icon={<FilePlus aria-hidden className="size-4" />}
          onClick={() => setCreating(true)}
        >
          {t('createFromOpportunity')}
        </Button>
      ) : null}
      {creating ? (
        <NewQuoteDialog
          opportunity={{
            id: opportunity.id,
            title: opportunity.title,
            customerName: opportunity.customerName,
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Card>
  );
}
