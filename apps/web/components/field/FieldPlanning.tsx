'use client';

import type { MyPlanningDto } from '@batimint/contracts';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@batimint/ui';
import { CalendarDays, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CalendarLinkButton } from '@/components/planning/CalendarLinkButton';
import { useApi } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';
import { SyncPill } from './shared';

const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${d}T12:00:00Z`));

/** Mon planning (03 §6) : où je travaille les deux prochaines semaines, et l'abonnement à mon agenda. */
export function FieldPlanning() {
  const t = useTranslations('field.planning');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const q = useApi<MyPlanningDto>(['planning', 'me'], '/field/planning?days=14');
  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">{t('title')}</h1>
        <SyncPill />
      </header>
      {q.isPending ? (
        <Skeleton className="h-60 w-full rounded-[20px]" />
      ) : q.isError ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(q.error)}
          action={
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {tc('retry')}
            </Button>
          }
        />
      ) : q.data.days.length === 0 ? (
        <EmptyState
          icon={<CalendarDays aria-hidden className="size-6" />}
          title={t('emptyTitle')}
          description={t('empty')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.days.map((d) => (
            <li key={d.day}>
              <Card className="flex flex-col gap-2 rounded-[20px] px-[18px] py-4">
                <h2 className="text-[15px] font-semibold first-letter:uppercase">{dayLabel(d.day)}</h2>
                <ul className="flex flex-col gap-2">
                  {d.items.map((it) => (
                    <li key={`${it.slotId}-${d.day}`} className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-medium">
                        {it.projectName}
                        <span className="text-muted"> · {t(`half.${it.half}`)}</span>
                      </span>
                      {it.address ? (
                        <span className="inline-flex items-center gap-1 text-[13px] text-muted">
                          <MapPin aria-hidden className="size-3.5" />
                          {it.address}
                        </span>
                      ) : null}
                      {it.taskTitle || it.teamName ? (
                        <span className="text-[13px] text-muted">
                          {[it.teamName, it.taskTitle].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <CalendarLinkButton familiar size="lg" />
    </>
  );
}
