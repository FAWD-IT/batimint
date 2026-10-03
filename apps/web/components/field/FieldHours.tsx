'use client';

import type { TimesheetRowDto } from '@batimint/contracts';
import { Button, Card, Chip, EmptyState, ErrorState, Skeleton } from '@batimint/ui';
import { CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';
import { clockTime, duration, SyncPill, useFieldToday } from './shared';

type Sheet = { from: string; to: string; rows: TimesheetRowDto[] };

const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${d}T12:00:00Z`));

/**
 * Mes heures (02 P4.6) : heures prestées par jour, pause déduite, validation par le chef.
 * Le chef valide ici les heures de son équipe sur le chantier du jour.
 */
export function FieldHours() {
  const t = useTranslations('field.hours');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const mine = useApi<Sheet>(['timesheet', 'me'], '/field/hours');
  const today = useFieldToday(null);
  const canValidate = today.data?.can.validate ?? false;
  const projectId = today.data?.project?.id ?? null;

  return (
    <>
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">{t('title')}</h1>
        <SyncPill />
      </header>
      {canValidate && projectId ? (
        <TeamValidation projectId={projectId} projectName={today.data!.project!.name} />
      ) : null}
      <section aria-labelledby="my-hours" className="flex flex-col gap-3">
        <h2 id="my-hours" className="text-[16px] font-semibold">
          {t('mine')}
        </h2>
        {mine.isPending ? (
          <Skeleton className="h-40 w-full rounded-[20px]" />
        ) : mine.isError ? (
          <ErrorState
            title={tc('errorTitle')}
            description={errorMessage(mine.error)}
            action={
              <Button variant="secondary" onClick={() => void mine.refetch()}>
                {tc('retry')}
              </Button>
            }
          />
        ) : mine.data.rows.length === 0 ? (
          <EmptyState
            icon={<CalendarClock aria-hidden className="size-6" />}
            title={t('emptyTitle')}
            description={t('emptyText')}
          />
        ) : (
          <>
            <Card className="flex items-baseline justify-between rounded-[20px] px-[18px] py-4">
              <span className="text-[14px] text-muted">{t('total')}</span>
              <span className="text-[22px] font-bold tabular-nums">
                {duration(mine.data.rows.reduce((s, r) => s + r.netMinutes, 0))}
              </span>
            </Card>
            <ul className="flex flex-col gap-2">
              {mine.data.rows.map((r) => (
                <li key={r.day}>
                  <DayRow row={r} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function DayRow({ row, action }: { row: TimesheetRowDto; action?: React.ReactNode }) {
  const t = useTranslations('field.hours');
  const sessions: string[] = [];
  let open: string | null = null;
  for (const e of row.entries) {
    if (e.kind === 'in') open = e.at;
    else if (open) {
      sessions.push(`${clockTime(new Date(open))} – ${clockTime(new Date(e.at))}`);
      open = null;
    }
  }
  if (open) sessions.push(t('openSince', { time: clockTime(new Date(open)) }));
  return (
    <Card className="flex flex-col gap-1.5 rounded-[16px] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold first-letter:uppercase">{dayLabel(row.day)}</span>
        <span className="text-[17px] font-bold tabular-nums">{duration(row.netMinutes)}</span>
      </div>
      <p className="text-[13px] text-muted">
        {sessions.join(' · ')}
        {row.breakMinutes ? ` · ${t('break', { duration: duration(row.breakMinutes) })}` : ''}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {row.validated ? (
          <Chip tone="good">{t('validated')}</Chip>
        ) : (
          <Chip tone="neutral">{t('toValidate')}</Chip>
        )}
        {row.anomalies.map((a) => (
          <Chip key={a} tone="warn">
            {t(`anomaly.${a}`)}
          </Chip>
        ))}
        {action ? <span className="ml-auto">{action}</span> : null}
      </div>
    </Card>
  );
}

/** Validation des heures de l'équipe par le chef (journée par journée). */
function TeamValidation({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useTranslations('field.hours');
  const sheet = useApi<Sheet>(['timesheet', projectId], `/projects/${projectId}/timesheet`);
  const validate = useApiMutation<{ day: string; employeeIds: string[] }>(
    (body) => ({ path: `/projects/${projectId}/timesheet/validate`, body }),
    { invalidate: [['timesheet'], ['field']], successMessage: t('validatedToast') },
  );
  if (!sheet.data) return <Skeleton className="h-32 w-full rounded-[20px]" />;
  const toValidate = sheet.data.rows.filter((r) => !r.validated);
  const days = [...new Set(toValidate.map((r) => r.day))];
  return (
    <section aria-labelledby="team-hours" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="team-hours" className="text-[16px] font-semibold">
          {t('teamTitle')}
        </h2>
        <p className="text-[13px] text-muted">{projectName}</p>
      </div>
      {days.length === 0 ? (
        <p className="text-[14px] text-muted">{t('allValidated')}</p>
      ) : (
        days.map((d) => {
          const rows = toValidate.filter((r) => r.day === d);
          const open = rows.some((r) => r.open);
          return (
            <Card key={d} className="flex flex-col gap-2 rounded-[20px] px-[18px] py-4">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[15px] font-semibold first-letter:uppercase">{dayLabel(d)}</h3>
                <span className="text-[13px] text-muted">{t('people', { n: rows.length })}</span>
              </div>
              <ul className="flex flex-col divide-y divide-line-soft">
                {rows.map((r) => (
                  <li key={r.employeeId} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex flex-col">
                      <span className="text-[14px] font-medium">{r.name}</span>
                      <span className="text-[12px] text-muted">
                        {r.open ? t('stillOnSite') : r.anomalies.map((a) => t(`anomaly.${a}`)).join(' · ')}
                      </span>
                    </div>
                    <span className="text-[15px] font-semibold tabular-nums">{duration(r.netMinutes)}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                disabled={open}
                loading={validate.isPending && validate.variables?.day === d}
                onClick={() => validate.mutate({ day: d, employeeIds: rows.map((r) => r.employeeId) })}
              >
                {t('validateDay')}
              </Button>
              {open ? <p className="text-[12px] text-muted">{t('openHint')}</p> : null}
            </Card>
          );
        })
      )}
    </section>
  );
}
