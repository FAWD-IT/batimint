'use client';

import { Button, Card, cn, Gauge } from '@batimint/ui';
import { Check, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApi, useApiMutation } from '@/lib/hooks';

interface Onboarding {
  steps: { step: string; done: boolean; href: string }[];
  completed: number;
  total: number;
  complete: boolean;
  dismissed: boolean;
}

/** 02 P1.7 — visible tant que la mise en route n'est pas complète ; chaque étape mène au bon écran. */
export function OnboardingChecklist() {
  const t = useTranslations('today');
  const { data } = useApi<Onboarding>(['onboarding'], '/company/onboarding');
  const dismiss = useApiMutation(() => ({ path: '/company/onboarding/dismiss', method: 'POST' }), {
    invalidate: [['onboarding']],
  });
  if (!data || data.dismissed || data.complete) return null;
  return (
    <Card className="flex flex-col gap-4" aria-labelledby="onboarding-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="onboarding-title" className="text-[17px] font-semibold">
            {t('checklistTitle')}
          </h2>
          <p className="text-[14px] text-muted">{t('checklistDescription')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => dismiss.mutate(undefined)}>
          {t('checklistDismiss')}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Gauge
          value={data.completed / data.total}
          tone="accent"
          label={t('checklistProgress', { done: data.completed, total: data.total })}
        />
        <span className="shrink-0 text-[13px] text-muted tabular-nums">
          {t('checklistProgress', { done: data.completed, total: data.total })}
        </span>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {data.steps.map((s) => (
          <li key={s.step}>
            <Link
              href={s.href}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-[10px] px-2 text-[14px] hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent',
                s.done && 'text-muted',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border',
                  s.done ? 'border-good bg-good text-white' : 'border-line',
                )}
              >
                {s.done ? <Check className="size-3.5" /> : null}
              </span>
              <span className={cn('flex-1', s.done && 'line-through')}>
                {t(`steps.${s.step}` as 'steps.company')}
              </span>
              {s.done ? (
                <span className="sr-only">✓</span>
              ) : (
                <ChevronRight aria-hidden className="size-4 text-muted" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
