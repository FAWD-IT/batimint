'use client';

import { Button, Card, Chip, ErrorState, Notice, PageHeader, Skeleton, type Tone } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';

type Kind = 'peppol' | 'accounting' | 'payments' | 'attendance' | 'ai' | 'inbound_email';
interface Integration {
  kind: Kind;
  provider: string;
  status: 'not_connected' | 'pending' | 'active' | 'error';
  lastCheckedAt: string | null;
  lastError: string | null;
  details: Record<string, unknown>;
}

const TONES: Record<Integration['status'], Tone> = {
  not_connected: 'neutral',
  pending: 'warn',
  active: 'good',
  error: 'crit',
};
const STATUS_KEYS = {
  not_connected: 'notConnected',
  pending: 'pending',
  active: 'active',
  error: 'error',
} as const;

export function IntegrationsSettings() {
  const t = useTranslations('settings.integrations');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const format = useFormatter();
  const can = useCan();
  const queryClient = useQueryClient();
  const { data, isLoading } = useApi<{ items: Integration[] }>(['integrations'], '/integrations');
  const replace = (i: Integration) => {
    queryClient.setQueryData<{ items: Integration[] }>(['integrations'], (old) =>
      old ? { items: old.items.map((x) => (x.kind === i.kind ? i : x)) } : old,
    );
    void queryClient.invalidateQueries({ queryKey: ['onboarding'] });
  };
  const activate = useApiMutation<void, Integration>(
    () => ({ path: '/integrations/peppol/activate', method: 'POST' }),
    {
      successMessage: t('peppolActivated'),
      onSuccess: replace,
    },
  );
  const test = useApiMutation<Kind, Integration>(
    (kind) => ({ path: `/integrations/${kind}/test`, method: 'POST' }),
    {
      onSuccess: replace,
    },
  );

  if (!can('integrations.manage'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader breadcrumb={<Link href="/parametres">{ts('title')}</Link>} title={t('title')} />
      <Notice tone="accent">{t('mockNotice')}</Notice>
      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((i) => (
            <Card key={i.kind} className="flex flex-col gap-3" aria-labelledby={`int-${i.kind}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 id={`int-${i.kind}`} className="text-[17px] font-semibold">
                  {t(`kinds.${i.kind}.title`)}
                </h2>
                <div className="flex gap-1.5">
                  {i.provider === 'mock' ? <Chip>{t('simulated')}</Chip> : null}
                  <Chip tone={TONES[i.status]} dot>
                    {t(STATUS_KEYS[i.status])}
                  </Chip>
                </div>
              </div>
              <p className="text-[14px] text-muted">{t(`kinds.${i.kind}.description`)}</p>
              {typeof i.details['participantId'] === 'string' ? (
                <p className="text-[13px]">
                  {t('participantId', { id: i.details['participantId'] as string })}
                </p>
              ) : null}
              {i.lastError ? <Notice tone="crit">{i.lastError}</Notice> : null}
              <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                {i.kind === 'peppol' && i.status === 'not_connected' ? (
                  <Button onClick={() => activate.mutate()} loading={activate.isPending}>
                    {t('activatePeppol')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => test.mutate(i.kind)}
                    loading={test.isPending && test.variables === i.kind}
                  >
                    {t('test')}
                  </Button>
                )}
                {i.lastCheckedAt ? (
                  <span className="text-[12px] text-muted">
                    {t('lastChecked', { date: format.relativeTime(new Date(i.lastCheckedAt)) })}
                  </span>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
