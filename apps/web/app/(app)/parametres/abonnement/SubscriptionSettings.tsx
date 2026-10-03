'use client';

import { FEATURES, type Feature, PLAN_FEATURES, PLANS, type Plan } from '@batimint/domain';
import { Button, Card, Chip, cn, ErrorState, PageHeader, Skeleton } from '@batimint/ui';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';

interface Subscription {
  plan: Plan;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  billableSeats: number;
  totalMembers: number;
  features: Feature[];
}

export function SubscriptionSettings() {
  const t = useTranslations('settings.subscription');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const can = useCan();
  const { data, isLoading } = useApi<Subscription>(['subscription'], '/company/subscription');
  const change = useApiMutation<Plan>(
    (plan) => ({ path: '/company/subscription', method: 'PUT', body: { plan } }),
    {
      invalidate: [['subscription']],
      successMessage: t('changed'),
    },
  );
  if (!can('subscription.manage'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumb={<Link href="/parametres">{ts('title')}</Link>}
        title={t('title')}
        description={t('billingNote')}
      />
      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <div>
              <p className="text-[12px] font-semibold tracking-[0.08em] text-muted uppercase">{t('plan')}</p>
              <p className="text-[24px] font-bold tracking-[-0.025em]">{t(`plans.${data.plan}`)}</p>
            </div>
            {data.trialDaysLeft !== null ? (
              <Chip tone={data.trialDaysLeft <= 3 ? 'warn' : 'accent'}>
                {t('trial', { days: data.trialDaysLeft })}
              </Chip>
            ) : null}
            <div className="text-[14px]">
              <p>{t('seats', { billable: data.billableSeats, total: data.totalMembers })}</p>
              <p className="text-muted">{t('seatsNote')}</p>
            </div>
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            {PLANS.map((p) => {
              const current = p === data.plan;
              return (
                <Card key={p} className={cn('flex flex-col gap-4', current && 'border-ink')}>
                  <div className="flex items-center justify-between">
                    <h2 className="text-[17px] font-semibold">{t(`plans.${p}`)}</h2>
                    {current ? <Chip tone="dark">{t('current')}</Chip> : null}
                  </div>
                  <ul className="flex flex-1 flex-col gap-1.5 text-[14px]">
                    {FEATURES.map((f) => {
                      const included = PLAN_FEATURES[p].includes(f);
                      return (
                        <li
                          key={f}
                          className={cn('flex items-center gap-2', !included && 'text-muted line-through')}
                        >
                          <Check aria-hidden className={cn('size-4', included ? 'text-good' : 'opacity-0')} />
                          <span>{t(`features.${f}`)}</span>
                          <span className="sr-only">{included ? tc('yes') : tc('no')}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {!current ? (
                    <Button
                      variant="secondary"
                      onClick={() => change.mutate(p)}
                      loading={change.isPending && change.variables === p}
                    >
                      {t('choose')}
                    </Button>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
