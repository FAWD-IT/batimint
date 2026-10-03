'use client';

import type { AlertDto, TodayDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  buttonClasses,
  Card,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  type Tone,
} from '@batimint/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BellRing, CheckCircle2, HardHat, History, MapPin, Sun } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { OnboardingChecklist } from '@/components/onboarding/OnboardingChecklist';
import { api } from '@/lib/api';
import { useCan, useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

const SEVERITY_TONE: Record<AlertDto['severity'], Tone> = { crit: 'crit', warn: 'warn', info: 'neutral' };
const time = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date(d));
const when = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date(d));

/** Aujourd'hui (02 P11) : qui est où, ce qui a bougé depuis hier, les alertes, les chiffres du mois. */
export function TodayView() {
  const t = useTranslations('today');
  const tc = useTranslations('common');
  const me = useSession();
  const can = useCan();
  const errorMessage = useErrorMessage();
  const firstName = me.user.name.split(' ')[0] ?? me.user.name;
  const readable = can('projects.read');
  // Le fil temps réel (« timeline ») rafraîchit l'écran ; une minute au plus pour le reste.
  const today = useQuery({
    queryKey: ['timeline', 'today'],
    queryFn: ({ signal }) => api<TodayDto>('/today', { signal }),
    enabled: readable,
    refetchInterval: 60_000,
  });
  const d = today.data;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('greeting', { name: firstName })}
        description={t('date', { date: new Date() })}
        actions={
          can('reports.read') ? (
            <Link href="/pilotage" className={buttonClasses('secondary', 'md', 'gap-1.5')}>
              {t('seeDashboard')}
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : null
        }
      />
      {can('company.update') ? <OnboardingChecklist /> : null}
      {!readable ? (
        <EmptyState
          icon={<Sun aria-hidden className="size-5" />}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
        />
      ) : today.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(today.error)}
          action={<Button onClick={() => void today.refetch()}>{tc('retry')}</Button>}
        />
      ) : !d ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : !d.sites.length &&
        !d.changes.length &&
        !d.alerts.length &&
        !Object.values(d.figures ?? {}).some(Boolean) ? (
        // Nouvel espace : rien à montrer encore, on explique ce qui viendra ici.
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
      ) : (
        <>
          {d.figures ? (
            <section aria-label={t('figures.label')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  ['invoiced', d.figures.invoicedThisMonth, '/pilotage'],
                  ['collected', d.figures.collectedThisMonth, '/pilotage'],
                  ['overdue', d.figures.overdue, '/facturation?vue=overdue'],
                  ['orderBook', d.figures.orderBook, '/pilotage/rapports?rapport=carnet'],
                ] as const
              ).map(([key, value, href]) => (
                <Link
                  key={key}
                  href={href}
                  className="flex flex-col gap-1 rounded-[16px] border border-line bg-surface px-4 py-3.5 transition-colors duration-[120ms] hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <span className="text-[13px] text-muted">{t(`figures.${key}`)}</span>
                  <span
                    className={`text-[22px] font-semibold tracking-[-0.01em] tabular-nums ${key === 'overdue' && value > 0 ? 'text-crit' : ''}`}
                  >
                    {formatEuros(BigInt(value))}
                  </span>
                </Link>
              ))}
            </section>
          ) : null}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="flex flex-col gap-4">
              <Card className="flex flex-col gap-3 p-5" data-testid="today-alerts">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{t('alerts.title')}</CardTitle>
                  {d.alerts.length ? (
                    <Chip tone="crit">{t('alerts.count', { n: d.alerts.length })}</Chip>
                  ) : null}
                </div>
                {d.alerts.length ? (
                  <ul className="flex flex-col divide-y divide-line-soft">
                    {d.alerts.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={a.link}
                          className="flex min-h-11 items-start justify-between gap-3 rounded-[8px] py-2.5 focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <Chip tone={SEVERITY_TONE[a.severity]} dot>
                                {t(`severity.${a.severity}`)}
                              </Chip>
                              <span className="font-medium hover:underline">{a.title}</span>
                            </span>
                            {a.detail ? <span className="text-[13px] text-muted">{a.detail}</span> : null}
                          </span>
                          {a.amount !== null ? (
                            <span className="shrink-0 font-semibold tabular-nums">
                              {formatEuros(BigInt(a.amount))}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 text-[14px] text-muted">
                    <CheckCircle2 aria-hidden className="size-4 text-good" />
                    {t('alerts.none')}
                  </p>
                )}
              </Card>

              <Card className="flex flex-col gap-3 p-5">
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <History aria-hidden className="size-4" />
                    {t('changes.title')}
                  </span>
                </CardTitle>
                {d.changes.length ? (
                  <ul className="flex flex-col divide-y divide-line-soft">
                    {d.changes.map((c) => (
                      <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="font-medium">{c.title}</span>
                          <span className="text-[13px] text-muted">
                            {c.project ? (
                              <Link href={`/chantiers/${c.project.id}`} className="hover:underline">
                                {c.project.name}
                              </Link>
                            ) : null}
                            {c.body ? ` · ${c.body}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-[12px] text-muted">
                          {when(c.at)}
                          {c.amount !== null ? (
                            <span className="block text-[14px] font-semibold text-ink tabular-nums">
                              {formatEuros(BigInt(c.amount))}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted">{t('changes.empty')}</p>
                )}
              </Card>
            </div>

            <Card className="flex flex-col gap-3 p-5" data-testid="today-sites">
              <CardTitle>
                <span className="flex items-center gap-2">
                  <HardHat aria-hidden className="size-4" />
                  {t('sites.title')}
                </span>
              </CardTitle>
              {d.sites.length ? (
                <ul className="flex flex-col gap-3">
                  {d.sites.map((s) => (
                    <li key={s.project.id} className="rounded-[12px] border border-line-soft p-3.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link href={`/chantiers/${s.project.id}`} className="font-semibold hover:underline">
                          {s.project.name}
                        </Link>
                        <span className="text-[13px] text-muted">
                          {t('sites.summary', { present: s.present, expected: s.expected })}
                        </span>
                      </div>
                      {s.address ? (
                        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
                          <MapPin aria-hidden className="size-3.5" />
                          {s.address}
                        </p>
                      ) : null}
                      <ul className="mt-2.5 flex flex-wrap gap-1.5">
                        {s.people.map((p) => (
                          <li key={p.employeeId}>
                            <Chip
                              tone={
                                p.status === 'on_site' ? 'good' : p.status === 'expected' ? 'warn' : 'neutral'
                              }
                              dot
                            >
                              {p.name} ·{' '}
                              {p.status === 'on_site'
                                ? t('sites.onSite', { time: time(p.since!) })
                                : t(`sites.${p.status}`)}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-[14px] text-muted">
                  <BellRing aria-hidden className="size-4" />
                  {t('sites.empty')}
                </p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
