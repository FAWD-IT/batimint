'use client';

import type { DailyReportDto } from '@batimint/contracts';
import { Button, Card, Chip, ErrorState, Skeleton, TextAreaField, TextField } from '@batimint/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useErrorMessage } from '@/lib/use-error-message';
import { duration, useFieldToday } from './shared';

const brusselsToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/**
 * Rapport journalier (02 P4.7) : généré depuis la journée (heures, tâches, photos, signalements,
 * bons de régie), complété par le chef puis arrêté.
 */
export function FieldReport() {
  const t = useTranslations('field.report');
  const tc = useTranslations('common');
  const params = useSearchParams();
  const today = useFieldToday(params.get('chantier'));
  const projectId = today.data?.project?.id ?? null;
  const day = params.get('jour') ?? brusselsToday();
  const errorMessage = useErrorMessage();
  const report = useApi<DailyReportDto>(
    ['field', 'report', projectId, day],
    projectId ? `/projects/${projectId}/daily-reports/${day}` : null,
  );
  const [notes, setNotes] = useState('');
  const [weather, setWeather] = useState('');
  useEffect(() => {
    if (report.data) {
      setNotes(report.data.notes ?? '');
      setWeather(report.data.weather ?? '');
    }
  }, [report.data]);
  const save = useApiMutation<{ close?: boolean }>(
    ({ close }) => ({
      path: `/projects/${projectId}/daily-reports/${day}`,
      method: 'PUT',
      body: { notes, weather, ...(close ? { close: true } : {}) },
    }),
    {
      invalidate: [['field', 'report']],
      successMessage: (_r, v) => (v.close ? t('closedToast') : t('savedToast')),
    },
  );

  const back = (
    <Link
      href={projectId ? `/terrain?chantier=${projectId}` : '/terrain'}
      className="inline-flex min-h-11 items-center gap-2 self-start text-[14px] font-medium text-muted focus-visible:outline-2 focus-visible:outline-accent"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {tc('back')}
    </Link>
  );

  if (today.isPending || (projectId && report.isPending))
    return (
      <>
        {back}
        <Skeleton className="h-64 w-full rounded-[20px]" />
      </>
    );
  if (report.isError || today.isError || !projectId)
    return (
      <>
        {back}
        <ErrorState
          title={tc('errorTitle')}
          description={
            report.error || today.error ? errorMessage(report.error ?? today.error) : t('noProject')
          }
        />
      </>
    );
  const r = report.data!;
  const closed = Boolean(r.closedAt);
  return (
    <>
      {back}
      <header className="flex flex-col gap-0.5">
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">{t('title')}</h1>
        <p className="text-[13px] text-muted">
          {today.data!.project!.name} ·{' '}
          {new Intl.DateTimeFormat('fr-BE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }).format(new Date(`${day}T12:00:00Z`))}
        </p>
      </header>
      {closed ? <Chip tone="good">{t('closedBy', { name: r.closedBy ?? '' })}</Chip> : null}
      <Card className="flex flex-col gap-3 rounded-[20px] px-[18px] py-4">
        <h2 className="text-[16px] font-semibold">{t('workers')}</h2>
        {r.workers.length ? (
          <ul className="flex flex-col gap-1">
            {r.workers.map((w) => (
              <li key={w.employeeId} className="flex justify-between text-[14px]">
                <span>{w.name}</span>
                <span className="tabular-nums">{duration(w.minutes)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t('noWorkers')}</p>
        )}
      </Card>
      <Card className="flex flex-col gap-3 rounded-[20px] px-[18px] py-4">
        <h2 className="text-[16px] font-semibold">{t('done')}</h2>
        {r.tasksCompleted.length ? (
          <ul className="list-disc pl-5 text-[14px]">
            {r.tasksCompleted.map((x) => (
              <li key={x.id}>{x.title}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted">{t('noTasks')}</p>
        )}
        {r.issues.length ? (
          <>
            <h3 className="text-[14px] font-semibold">{t('issues')}</h3>
            <ul className="list-disc pl-5 text-[14px]">
              {r.issues.map((x) => (
                <li key={x.id}>
                  {x.title}
                  {x.urgent ? ` · ${t('urgent')}` : ''}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {r.workOrders.length ? (
          <>
            <h3 className="text-[14px] font-semibold">{t('workOrders')}</h3>
            <ul className="list-disc pl-5 text-[14px]">
              {r.workOrders.map((x) => (
                <li key={x.id}>
                  {x.number ? `${x.number} · ` : ''}
                  {x.description}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {r.photos.length ? (
          <ul className="grid grid-cols-3 gap-2" aria-label={t('photos', { n: r.photos.length })}>
            {r.photos.slice(0, 9).map((p) => (
              <li key={p.id}>
                <img
                  src={p.url}
                  alt={p.caption ?? ''}
                  className="aspect-square w-full rounded-[10px] object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card className="flex flex-col gap-3 rounded-[20px] px-[18px] py-4">
        <TextField
          label={t('weather')}
          value={weather}
          onChange={(e) => setWeather(e.target.value)}
          placeholder={t('weatherPlaceholder')}
          maxLength={100}
        />
        <TextAreaField
          label={t('notes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('notesPlaceholder')}
          rows={4}
          maxLength={5000}
        />
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            variant="secondary"
            loading={save.isPending && !save.variables?.close}
            onClick={() => save.mutate({})}
          >
            {tc('save')}
          </Button>
          {!closed ? (
            <Button
              size="lg"
              loading={save.isPending && Boolean(save.variables?.close)}
              onClick={() => save.mutate({ close: true })}
            >
              {t('close')}
            </Button>
          ) : null}
        </div>
      </Card>
    </>
  );
}
