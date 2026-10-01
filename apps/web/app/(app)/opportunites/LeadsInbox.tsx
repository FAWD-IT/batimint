'use client';

import { Button, Chip, ConfirmDialog, EmptyState, ErrorState, Skeleton } from '@batimint/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { Globe, Inbox, Mail, PenLine, Phone } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';

export interface LeadRow {
  id: string;
  source: 'web_form' | 'email' | 'manual' | 'phone';
  status: 'new' | 'converted' | 'discarded';
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  message: string | null;
  customerId: string | null;
  opportunityId: string | null;
  receivedAt: string;
}

const SOURCE_ICONS = { web_form: Globe, email: Mail, manual: PenLine, phone: Phone } as const;
const STATUS_TONES = { new: 'accent', converted: 'good', discarded: 'neutral' } as const;

export function LeadsInbox({
  query,
  onNew,
}: {
  query: UseQueryResult<{ items: LeadRow[] }>;
  onNew: () => void;
}) {
  const t = useTranslations('leads');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const [discarding, setDiscarding] = useState<LeadRow | null>(null);
  const discard = useApiMutation<string>((id) => ({ path: `/leads/${id}/discard`, body: {} }), {
    invalidate: [['leads']],
    successMessage: t('discarded'),
    onSuccess: () => setDiscarding(null),
  });

  if (query.error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(query.error)}
        action={<Button onClick={() => void query.refetch()}>{tc('retry')}</Button>}
      />
    );
  if (query.isLoading) return <Skeleton className="h-64" />;
  const items = query.data?.items ?? [];
  if (items.length === 0)
    return (
      <EmptyState
        icon={<Inbox aria-hidden className="size-5" />}
        title={t('title')}
        description={t('empty')}
        action={
          <>
            {can('leads.write') ? <Button onClick={onNew}>{t('new')}</Button> : null}
            {can('company.read') ? (
              <Link
                href="/parametres/formulaire"
                className="inline-flex h-11 items-center px-4 text-[15px] font-semibold underline"
              >
                {t('formSettings')}
              </Link>
            ) : null}
          </>
        }
      />
    );

  return (
    <>
      <ul className="flex flex-col divide-y divide-line-soft rounded-[16px] border border-line bg-surface">
        {items.map((l) => {
          const Icon = SOURCE_ICONS[l.source];
          return (
            <li key={l.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-line-soft"
                title={t(`source.${l.source}`)}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{l.name}</span>
                  {l.companyName ? <span className="text-muted">· {l.companyName}</span> : null}
                  <Chip tone={STATUS_TONES[l.status]} dot>
                    {t(`status.${l.status}`)}
                  </Chip>
                </p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {[
                    t(`source.${l.source}`),
                    relative(l.receivedAt),
                    [l.postalCode, l.city].filter(Boolean).join(' '),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {l.message ? (
                  <p className="mt-2 line-clamp-3 text-[14px] whitespace-pre-line">{l.message}</p>
                ) : null}
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
                  {l.phone ? (
                    <a href={`tel:${l.phone.replace(/\s/g, '')}`} className="tabular-nums hover:underline">
                      {l.phone}
                    </a>
                  ) : null}
                  {l.email ? (
                    <a href={`mailto:${l.email}`} className="break-all hover:underline">
                      {l.email}
                    </a>
                  ) : null}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
                {l.opportunityId ? (
                  <Link
                    href={`/opportunites/${l.opportunityId}`}
                    className="inline-flex h-9 items-center rounded-[10px] border border-line px-3 text-[13px] font-semibold hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {t('openOpportunity')}
                  </Link>
                ) : null}
                {l.customerId ? (
                  <Link
                    href={`/clients/${l.customerId}`}
                    className="inline-flex h-9 items-center px-1 text-[13px] font-medium underline-offset-2 hover:underline"
                  >
                    {t('openCustomer')}
                  </Link>
                ) : null}
                {l.status === 'new' && can('leads.write') ? (
                  <Button size="sm" variant="ghost" onClick={() => setDiscarding(l)}>
                    {t('discard')}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={discarding !== null}
        onClose={() => setDiscarding(null)}
        onConfirm={() => discarding && discard.mutate(discarding.id)}
        loading={discard.isPending}
        title={t('discardTitle', { name: discarding?.name ?? '' })}
        description={t('discardDescription')}
        confirmLabel={t('discard')}
        cancelLabel={tc('cancel')}
        closeLabel={tc('close')}
      />
    </>
  );
}
