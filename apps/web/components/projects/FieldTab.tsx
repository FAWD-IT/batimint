'use client';

import type { DailyReportDto, IssueDto, TimesheetRowDto, WorkOrderDto } from '@batimint/contracts';
import { formatClockTime, formatEuros, formatMinutes } from '@batimint/domain';
import { Button, Card, Chip, Dialog, EmptyState, Notice, Skeleton, Table, Td, Th } from '@batimint/ui';
import { Download, FilePlus2, FileText, HardHat, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useRelativeTime } from '@/lib/use-relative-time';

type Sheet = { from: string; to: string; rows: TimesheetRowDto[] };

const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T12:00:00Z`));

/**
 * Onglet « Terrain » du cockpit (03 §7) : heures et validation, signalements à transformer en
 * avenant, bons de régie signés, rapports journaliers et Check In and Out.
 */
export function FieldTab({
  projectId,
  onOpenChangeOrder,
}: {
  projectId: string;
  onOpenChangeOrder: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <IssuesSection projectId={projectId} onOpenChangeOrder={onOpenChangeOrder} />
      <HoursSection projectId={projectId} />
      <WorkOrdersSection projectId={projectId} />
    </div>
  );
}

function IssuesSection({
  projectId,
  onOpenChangeOrder,
}: {
  projectId: string;
  onOpenChangeOrder: (id: string) => void;
}) {
  const t = useTranslations('projects.field');
  const can = useCan();
  const relative = useRelativeTime();
  const list = useApi<{ items: IssueDto[] }>(['issues', projectId], `/projects/${projectId}/issues`);
  const toChangeOrder = useApiMutation<string, { changeOrderId: string }>(
    (id) => ({ path: `/issues/${id}/change-order`, method: 'POST' }),
    {
      invalidate: [['issues'], ['change_orders'], ['project']],
      onSuccess: (r) => onOpenChangeOrder(r.changeOrderId),
    },
  );
  const setStatus = useApiMutation<{ id: string; status: 'open' | 'resolved' }>(
    ({ id, status }) => ({ path: `/issues/${id}`, method: 'PATCH', body: { status } }),
    { invalidate: [['issues'], ['project']] },
  );
  const items = list.data?.items ?? [];
  return (
    <section aria-labelledby="field-issues" className="flex flex-col gap-3">
      <h2 id="field-issues" className="text-[17px] font-semibold">
        {t('issues')}
      </h2>
      {list.isLoading ? (
        <Skeleton className="h-32" />
      ) : !items.length ? (
        <EmptyState
          icon={<TriangleAlert aria-hidden className="size-5" />}
          title={t('noIssuesTitle')}
          description={t('noIssues')}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => (
            <li key={i.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{i.title}</span>
                    {i.urgent ? <Chip tone="crit">{t('urgent')}</Chip> : null}
                    <Chip
                      tone={i.status === 'open' ? 'warn' : i.status === 'change_order' ? 'accent' : 'good'}
                      dot
                    >
                      {t(`issueStatus.${i.status}`)}
                    </Chip>
                  </div>
                  {i.description ? <p className="text-[14px] text-muted">{i.description}</p> : null}
                  <p className="text-[12px] text-muted">
                    {t('reportedBy', { name: i.reporterLabel, when: relative(i.reportedAt) })}
                  </p>
                  {i.photos.length ? (
                    <ul
                      className="mt-1 flex flex-wrap gap-2"
                      aria-label={t('photos', { n: i.photos.length })}
                    >
                      {i.photos.map((p) => (
                        <li key={p.id}>
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-hidden rounded-[8px]"
                          >
                            <img
                              src={p.url}
                              alt={t('issuePhoto', { title: i.title })}
                              className="size-20 object-cover"
                            />
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {i.voiceNotes.map((v) => (
                    <div key={v.id} className="mt-1 flex flex-col gap-1">
                      <audio
                        controls
                        preload="none"
                        src={v.url}
                        aria-label={t('voiceNote')}
                        className="h-9 max-w-full"
                      />
                      {v.transcript ? (
                        <p className="text-[13px] text-ink italic">« {v.transcript} »</p>
                      ) : v.transcriptStatus === 'pending' ? (
                        <p className="text-[12px] text-muted">{t('transcribing')}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
                {can('projects.write') ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {i.changeOrderId ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenChangeOrder(i.changeOrderId!)}
                      >
                        {t('openChangeOrder')}
                      </Button>
                    ) : i.status === 'open' ? (
                      <>
                        <Button
                          size="sm"
                          icon={<FilePlus2 aria-hidden className="size-4" />}
                          loading={toChangeOrder.isPending && toChangeOrder.variables === i.id}
                          onClick={() => toChangeOrder.mutate(i.id)}
                        >
                          {t('createChangeOrder')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setStatus.mutate({ id: i.id, status: 'resolved' })}
                        >
                          {t('resolve')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatus.mutate({ id: i.id, status: 'open' })}
                      >
                        {t('reopen')}
                      </Button>
                    )}
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HoursSection({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.field');
  const can = useCan();
  const sheet = useApi<Sheet>(['timesheet', projectId], `/projects/${projectId}/timesheet`);
  const [reportDay, setReportDay] = useState<string | null>(null);
  const validate = useApiMutation<{ day: string; employeeIds: string[] }>(
    (body) => ({ path: `/projects/${projectId}/timesheet/validate`, body }),
    { invalidate: [['timesheet']], successMessage: t('validated') },
  );
  const retry = useApiMutation<void, { count: number }>(
    () => ({ path: `/projects/${projectId}/attendance/retry`, method: 'POST' }),
    { invalidate: [['timesheet']], successMessage: (r) => t('retried', { n: r.count }) },
  );
  const rows = sheet.data?.rows ?? [];
  const failedOnss = rows.flatMap((r) => r.entries).filter((e) => e.onssStatus === 'failed');
  const onss = rows.some((r) => r.entries.some((e) => e.onssStatus !== 'not_required'));
  const days = [...new Set(rows.map((r) => r.day))];
  const withCost = rows.some((r) => r.cost !== undefined);
  return (
    <section aria-labelledby="field-hours" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="field-hours" className="text-[17px] font-semibold">
          {t('hours')}
        </h2>
        {can('time.validate') && onss ? (
          <a
            href={`/api/v1/projects/${projectId}/attendance.csv`}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13px] font-semibold focus-visible:outline-2 focus-visible:outline-accent"
          >
            <Download aria-hidden className="size-4" />
            {t('exportAttendance')}
          </a>
        ) : null}
      </div>
      {failedOnss.length ? (
        <Notice tone="crit" title={t('onssFailedTitle', { n: failedOnss.length })}>
          <div className="flex flex-col items-start gap-2">
            <span>{failedOnss[0]!.onssError}</span>
            {can('time.validate') ? (
              <Button size="sm" variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>
                {t('retryOnss')}
              </Button>
            ) : null}
          </div>
        </Notice>
      ) : null}
      {sheet.isLoading ? (
        <Skeleton className="h-40" />
      ) : !rows.length ? (
        <EmptyState
          icon={<HardHat aria-hidden className="size-5" />}
          title={t('noHoursTitle')}
          description={t('noHours')}
        />
      ) : (
        <Table label={t('hours')}>
          <thead>
            <tr>
              <Th>{t('day')}</Th>
              <Th>{t('person')}</Th>
              <Th className="hidden md:table-cell">{t('times')}</Th>
              <Th align="right">{t('net')}</Th>
              {withCost ? (
                <Th align="right" className="hidden sm:table-cell">
                  {t('cost')}
                </Th>
              ) : null}
              <Th>{t('state')}</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => {
              const dayRows = rows.filter((r) => r.day === d);
              const pending = dayRows.filter((r) => !r.validated);
              return dayRows.map((r, idx) => (
                <tr key={`${r.day}-${r.employeeId}`}>
                  {idx === 0 ? (
                    <Td className="align-top">
                      <div className="flex flex-col items-start gap-1.5">
                        <span className="font-medium first-letter:uppercase">{dayLabel(d)}</span>
                        <button
                          type="button"
                          onClick={() => setReportDay(d)}
                          className="inline-flex min-h-8 items-center gap-1 text-[12px] font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                        >
                          <FileText aria-hidden className="size-3.5" />
                          {t('report')}
                        </button>
                        {can('time.validate') && pending.length && !pending.some((p) => p.open) ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={validate.isPending && validate.variables?.day === d}
                            onClick={() =>
                              validate.mutate({ day: d, employeeIds: pending.map((p) => p.employeeId) })
                            }
                          >
                            {t('validateDay')}
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  ) : (
                    <Td>
                      <span className="sr-only">{dayLabel(d)}</span>
                    </Td>
                  )}
                  <Td>{r.name}</Td>
                  <Td className="hidden text-muted md:table-cell">{sessions(r)}</Td>
                  <Td align="right">{formatMinutes(r.netMinutes)}</Td>
                  {withCost ? (
                    <Td align="right" className="hidden sm:table-cell">
                      {r.cost !== undefined ? formatEuros(BigInt(r.cost)) : '—'}
                    </Td>
                  ) : null}
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {r.open ? (
                        <Chip tone="accent" dot>
                          {t('onSite')}
                        </Chip>
                      ) : r.validated ? (
                        <Chip tone="good">{t('validatedChip')}</Chip>
                      ) : (
                        <Chip tone="neutral">{t('toValidate')}</Chip>
                      )}
                      {r.anomalies.map((a) => (
                        <Chip key={a} tone="warn">
                          {t(`anomaly.${a}`)}
                        </Chip>
                      ))}
                    </div>
                  </Td>
                </tr>
              ));
            })}
          </tbody>
        </Table>
      )}
      {reportDay ? (
        <ReportDialog projectId={projectId} day={reportDay} onClose={() => setReportDay(null)} />
      ) : null}
    </section>
  );
}

function sessions(r: TimesheetRowDto): string {
  const out: string[] = [];
  let open: string | null = null;
  for (const e of r.entries) {
    if (e.kind === 'in') open = e.at;
    else if (open) {
      out.push(`${formatClockTime(new Date(open))} – ${formatClockTime(new Date(e.at))}`);
      open = null;
    }
  }
  if (open) out.push(`${formatClockTime(new Date(open))} – …`);
  return out.join(' · ');
}

function ReportDialog({ projectId, day, onClose }: { projectId: string; day: string; onClose: () => void }) {
  const t = useTranslations('projects.field');
  const tc = useTranslations('common');
  const report = useApi<DailyReportDto>(
    ['field', 'report', projectId, day],
    `/projects/${projectId}/daily-reports/${day}`,
  );
  const r = report.data;
  return (
    <Dialog open onClose={onClose} title={t('reportTitle', { day: dayLabel(day) })} closeLabel={tc('close')}>
      {!r ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="flex flex-col gap-4 text-[14px]">
          {r.closedAt ? <Chip tone="good">{t('reportClosed', { name: r.closedBy ?? '' })}</Chip> : null}
          <div>
            <h3 className="font-semibold">{t('reportWorkers')}</h3>
            <ul>
              {r.workers.map((w) => (
                <li key={w.employeeId} className="flex justify-between">
                  <span>{w.name}</span>
                  <span className="tabular-nums">{formatMinutes(w.minutes)}</span>
                </li>
              ))}
            </ul>
          </div>
          {r.tasksCompleted.length ? (
            <div>
              <h3 className="font-semibold">{t('reportDone')}</h3>
              <ul className="list-disc pl-5">
                {r.tasksCompleted.map((x) => (
                  <li key={x.id}>{x.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {r.issues.length ? (
            <div>
              <h3 className="font-semibold">{t('issues')}</h3>
              <ul className="list-disc pl-5">
                {r.issues.map((x) => (
                  <li key={x.id}>{x.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {r.weather ? (
            <p>
              <span className="font-semibold">{t('reportWeather')} :</span> {r.weather}
            </p>
          ) : null}
          {r.notes ? <p className="whitespace-pre-line">{r.notes}</p> : null}
          {r.photos.length ? (
            <ul className="grid grid-cols-4 gap-2">
              {r.photos.map((p) => (
                <li key={p.id}>
                  <img
                    src={p.url}
                    alt={p.caption ?? ''}
                    className="aspect-square w-full rounded-[8px] object-cover"
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function WorkOrdersSection({ projectId }: { projectId: string }) {
  const t = useTranslations('projects.field');
  const list = useApi<{ items: WorkOrderDto[] }>(
    ['work_orders', projectId],
    `/projects/${projectId}/work-orders`,
  );
  const items = list.data?.items ?? [];
  return (
    <section aria-labelledby="field-work-orders" className="flex flex-col gap-3">
      <h2 id="field-work-orders" className="text-[17px] font-semibold">
        {t('workOrders')}
      </h2>
      {list.isLoading ? (
        <Skeleton className="h-24" />
      ) : !items.length ? (
        <p className="text-[14px] text-muted">{t('noWorkOrders')}</p>
      ) : (
        <Table label={t('workOrders')}>
          <thead>
            <tr>
              <Th>{t('workOrder')}</Th>
              <Th className="hidden sm:table-cell">{t('lines')}</Th>
              <Th>{t('state')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <Td>
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {w.number ?? t('draft')} · {dayLabel(w.day)}
                    </span>
                    <span className="text-[13px] text-muted">{w.description}</span>
                  </div>
                </Td>
                <Td className="hidden text-[13px] text-muted sm:table-cell">
                  {w.lines
                    .map((l) => `${l.description} (${l.quantity.replace('.', ',')} ${l.unit})`)
                    .join(' · ')}
                </Td>
                <Td>
                  {w.status === 'draft' ? (
                    <Chip tone="neutral">{t('draft')}</Chip>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone="good">{t('signedBy', { name: w.signerName ?? '' })}</Chip>
                      <a
                        href={`/api/v1/work-orders/${w.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] font-semibold text-accent hover:underline"
                      >
                        {t('pdf')}
                      </a>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}
