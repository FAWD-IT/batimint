'use client';

import { buttonClasses, EmptyState, PageHeader } from '@batimint/ui';
import { Sun } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { useCan, useSession } from '@/lib/session';

export function TodayView() {
  const t = useTranslations('today');
  const me = useSession();
  const can = useCan();
  const firstName = me.user.name.split(' ')[0] ?? me.user.name;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader title={t('greeting', { name: firstName })} description={t('date', { date: new Date() })} />
      {can('company.update') ? <OnboardingChecklist /> : null}
      <EmptyState
        icon={<Sun aria-hidden className="size-5" />}
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        action={
          can('diagnostics.run') ? (
            <Link href="/parametres/diagnostic" className={buttonClasses('secondary')}>
              {t('emptyAction')}
            </Link>
          ) : null
        }
      />
    </div>
  );
}
