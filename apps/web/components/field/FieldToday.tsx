'use client';

import type { FieldTodayDto } from '@batimint/contracts';
import {
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  Notice,
  SelectField,
  Skeleton,
  Spinner,
  useToast,
} from '@batimint/ui';
import {
  Camera,
  ClipboardList,
  HardHat,
  MapPin,
  Navigation,
  PenLine,
  Phone,
  TriangleAlert,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { listActions } from '@/lib/field/queue';
import { useRealtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { currentPosition, useField } from './FieldProvider';
import { IssueSheet } from './IssueSheet';
import { clockTime, duration, SyncPill, TEAM_COLORS, useFieldToday, usePhotoCapture } from './shared';
import { WorkOrderSheet } from './WorkOrderSheet';

type Today = FieldTodayDto & { fromCache?: string };
type Status = 'todo' | 'in_progress' | 'done';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * « Aujourd'hui » (02 P4, maquette terrain) : le chantier du jour, le gros bouton de pointage,
 * photo / signaler / faire signer, les tâches à cocher, et l'équipe pour le chef.
 * Tout passe par la file hors ligne : l'écran reflète immédiatement ce qui est en attente.
 */
export function FieldToday() {
  const t = useTranslations('field');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useSearchParams();
  const projectParam = params.get('chantier');
  const query = useFieldToday(projectParam);
  const errorMessage = useErrorMessage();

  if (query.isPending)
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <span className="sr-only">{tc('loading')}</span>
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-64 w-full rounded-[20px]" />
        <Skeleton className="h-[88px] w-full rounded-[20px]" />
        <Skeleton className="h-40 w-full rounded-[20px]" />
      </div>
    );
  if (query.isError)
    return (
      <>
        <Greeting name={null} />
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(query.error)}
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {tc('retry')}
            </Button>
          }
        />
      </>
    );
  const d = query.data;
  return (
    <>
      <Greeting name={d.employee?.firstName ?? null} />
      {d.fromCache ? (
        <Notice tone="warn">{t('today.cached', { time: clockTime(new Date(d.fromCache)) })}</Notice>
      ) : null}
      <FailedNotice />
      {!d.employee ? (
        <EmptyState
          icon={<HardHat aria-hidden className="size-6" />}
          title={t('today.noEmployeeTitle')}
          description={t('today.noEmployeeText')}
        />
      ) : !d.project ? (
        <EmptyState
          icon={<HardHat aria-hidden className="size-6" />}
          title={t('today.noProjectTitle')}
          description={t('today.noProjectText')}
        />
      ) : (
        <Day
          key={d.project.id}
          data={
            d as Today & { project: NonNullable<Today['project']>; employee: NonNullable<Today['employee']> }
          }
          onSwitch={(id) => router.replace(`/terrain?chantier=${id}`)}
        />
      )}
    </>
  );
}

function Greeting({ name }: { name: string | null }) {
  const t = useTranslations('field.today');
  const me = useSession();
  const first = name ?? me.user.name.split(/\s+/)[0] ?? null;
  const [date, setDate] = useState('');
  useEffect(() => {
    setDate(
      capitalize(
        new Intl.DateTimeFormat('fr-BE', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: 'Europe/Brussels',
        }).format(new Date()),
      ),
    );
  }, []);
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="min-h-5 text-[13px] text-muted">{date}</p>
        <h1 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">
          {first ? t('hello', { name: first }) : t('helloAnon')}
        </h1>
      </div>
      <SyncPill />
    </header>
  );
}

function FailedNotice() {
  const t = useTranslations('field.sync');
  const f = useField();
  if (!f.failed.length) return null;
  return (
    <Notice tone="crit" title={t('failedTitle')}>
      <ul className="flex flex-col gap-2">
        {f.failed.map((x) => (
          <li key={x.id} className="flex items-start justify-between gap-3">
            <span>{x.error?.message || t('failedGeneric')}</span>
            <Button size="sm" variant="secondary" onClick={() => void f.dismissFailed(x.id)}>
              {t('dismiss')}
            </Button>
          </li>
        ))}
      </ul>
    </Notice>
  );
}

function Day({
  data,
  onSwitch,
}: {
  data: Today & { project: NonNullable<Today['project']>; employee: NonNullable<Today['employee']> };
  onSwitch: (id: string) => void;
}) {
  const t = useTranslations('field');
  const toast = useToast();
  const f = useField();
  const { addChannels } = useRealtime();
  const photo = usePhotoCapture();
  const [issueOpen, setIssueOpen] = useState(false);
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const project = data.project;
  const me = data.employee;

  useEffect(() => addChannels([`project:${project.id}`]), [addChannels, project.id]);

  // Ce qui attend dans la file s'affiche comme déjà fait (optimiste) avec la mention « en attente ».
  const pending = useMemo(() => {
    const clocks = new Map<string, { kind: 'in' | 'out'; at: string }>();
    const tasks = new Map<string, Status>();
    for (const a of f.actions) {
      if (a.error) continue;
      if (a.type === 'clock' && a.data.projectId === project.id) {
        const who = a.data.employeeId ?? me.id;
        const prev = clocks.get(who);
        if (!prev || prev.at <= a.data.at) clocks.set(who, { kind: a.data.kind, at: a.data.at });
      }
      if (a.type === 'task' && a.data.projectId === project.id && a.data.status)
        tasks.set(a.data.taskId, a.data.status);
    }
    return { clocks, tasks };
  }, [f.actions, project.id, me.id]);

  const myPending = pending.clocks.get(me.id);
  const clockedIn = myPending ? myPending.kind === 'in' : data.clock.status === 'in';
  const since = myPending ? (myPending.kind === 'in' ? myPending.at : null) : data.clock.since;

  const team = data.team.map((p) => {
    const pend = pending.clocks.get(p.employeeId);
    return pend
      ? { ...p, onSite: pend.kind === 'in', since: pend.kind === 'in' ? pend.at : null, pending: true }
      : { ...p, pending: false };
  });
  const onSite = team.filter((p) => p.onSite);

  const clock = async (kind: 'in' | 'out', employeeId?: string) => {
    setBusy(employeeId ?? 'me');
    try {
      const pos = await currentPosition();
      const id = uuidv7();
      const at = new Date().toISOString();
      const r = await f.enqueue({
        type: 'clock',
        id,
        data: {
          id,
          projectId: project.id,
          ...(employeeId ? { employeeId } : {}),
          kind,
          at,
          latitude: pos?.latitude ?? null,
          longitude: pos?.longitude ?? null,
          accuracy: pos?.accuracy ?? null,
          offline: !f.online,
        },
      });
      const failed = (await listActions()).find((a) => a.id === id && a.error);
      if (failed) {
        toast.show({ title: t('clock.refused'), description: failed.error?.message, tone: 'crit' });
        return;
      }
      const fence = r?.geofence.find((g) => g.id === id)?.status;
      const name = employeeId ? (team.find((p) => p.employeeId === employeeId)?.name ?? '') : null;
      toast.show({
        title: name
          ? t(kind === 'in' ? 'clock.teamInDone' : 'clock.teamOutDone', {
              name,
              time: clockTime(new Date(at)),
            })
          : t(kind === 'in' ? 'clock.inDone' : 'clock.outDone', { time: clockTime(new Date(at)) }),
        description:
          !r || r.interrupted
            ? t('clock.savedOffline')
            : fence === 'too_far'
              ? t('clock.tooFar')
              : fence === 'no_position'
                ? t('clock.noPosition')
                : undefined,
        tone: fence === 'too_far' ? 'neutral' : 'good',
      });
    } finally {
      setBusy(null);
    }
  };

  // Retour immédiat au doigt, avant même l'écriture dans la file.
  const [optimistic, setOptimistic] = useState<Record<string, Status>>({});
  useEffect(() => setOptimistic({}), [data.tasks]);
  const toggleTask = async (taskId: string, done: boolean) => {
    setOptimistic((o) => ({ ...o, [taskId]: done ? 'done' : 'in_progress' }));
    await f.enqueue({
      type: 'task',
      id: uuidv7(),
      data: { projectId: project.id, taskId, status: done ? 'done' : 'in_progress' },
    });
  };

  const tasks = data.tasks.map((task) => {
    const p = pending.tasks.get(task.id);
    return { ...task, status: p ?? optimistic[task.id] ?? task.status, pending: Boolean(p) };
  });
  const doneCount = tasks.filter((x) => x.status === 'done').length;
  const directions =
    project.latitude !== null && project.longitude !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${project.latitude},${project.longitude}`
      : project.address
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(project.address)}`
        : null;

  return (
    <>
      {photo.element}
      <section
        aria-labelledby="field-project"
        className="flex flex-col gap-3.5 rounded-[20px] bg-panel p-[18px] text-panel-text"
      >
        <p className="text-[12px] tracking-[0.08em] text-panel-muted uppercase">
          {t('today.projectOverline')}
        </p>
        <div className="flex flex-col gap-1">
          <h2 id="field-project" className="text-[20px] font-bold tracking-[-0.015em]">
            {project.name}
          </h2>
          {project.address ? <p className="text-[14px] text-[#CFCFCF]">{project.address}</p> : null}
          <p className="text-[12px] text-panel-muted">
            {project.number} · {project.customerName}
          </p>
        </div>
        {directions ? (
          <a
            href={directions}
            target="_blank"
            rel="noreferrer"
            className="flex h-24 items-center justify-center gap-2 rounded-[12px] bg-[#262626] text-[13px] text-[#CFCFCF] focus-visible:outline-2 focus-visible:outline-white"
          >
            <MapPin aria-hidden className="size-5" />
            {t('today.openMap')}
          </a>
        ) : null}
        {project.accessNotes ? <p className="text-[13px] text-[#CFCFCF]">{project.accessNotes}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex" aria-hidden>
              {onSite.slice(0, 4).map((p, i) => (
                <span
                  key={p.employeeId}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border-2 border-panel text-[11px] font-bold text-[#111111]',
                    i > 0 && '-ml-2',
                  )}
                  style={{ background: TEAM_COLORS[i % TEAM_COLORS.length] }}
                >
                  {p.initials}
                </span>
              ))}
            </div>
            <span className="text-[13px] text-[#CFCFCF]">{t('today.onSite', { n: onSite.length })}</span>
          </div>
          <div className="flex gap-2">
            {project.customerPhone ? (
              <a
                href={`tel:${project.customerPhone}`}
                aria-label={t('today.callCustomer')}
                className="inline-flex size-9 items-center justify-center rounded-[10px] bg-[#262626] text-white focus-visible:outline-2 focus-visible:outline-white"
              >
                <Phone aria-hidden className="size-4" />
              </a>
            ) : null}
            {directions ? (
              <a
                href={directions}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-white px-3.5 text-[13px] font-semibold text-[#111111] focus-visible:outline-2 focus-visible:outline-white"
              >
                <Navigation aria-hidden className="size-4" />
                {t('today.directions')}
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={() => void clock(clockedIn ? 'out' : 'in')}
        disabled={busy === 'me'}
        className={cn(
          'flex h-[88px] flex-col items-center justify-center gap-1 rounded-[20px] text-white',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-70',
          clockedIn ? 'bg-ink text-ink-inverse' : 'bg-accent',
        )}
      >
        {busy === 'me' ? (
          <Spinner className="size-6" label={t('clock.locating')} />
        ) : (
          <>
            <span className="text-[22px] font-bold tracking-[-0.01em]">
              {clockedIn ? t('clock.out') : t('clock.in')}
            </span>
            <span className={cn('text-[12px]', clockedIn ? 'opacity-75' : 'text-[#E3E8FF]')}>
              {clockedIn && since
                ? t('clock.since', {
                    time: clockTime(new Date(since)),
                    worked: duration(data.clock.workedMinutes),
                  })
                : project.checkInOut
                  ? t('clock.hintOnss')
                  : t('clock.hint')}
            </span>
          </>
        )}
      </button>
      {myPending ? (
        <p className="-mt-2 text-center text-[12px] text-muted" role="status">
          {f.online ? t('clock.sending') : t('clock.waitingNetwork')}
        </p>
      ) : null}

      <div className={cn('grid gap-2.5', data.can.workOrders ? 'grid-cols-3' : 'grid-cols-2')}>
        <ActionTile
          icon={<Camera aria-hidden className="size-6" />}
          label={t('actions.photo')}
          onClick={() => photo.open({ ownerType: 'project', ownerId: project.id, projectId: project.id })}
        />
        <ActionTile
          icon={<TriangleAlert aria-hidden className="size-6" />}
          label={t('actions.report')}
          onClick={() => setIssueOpen(true)}
        />
        {data.can.workOrders ? (
          <ActionTile
            icon={<PenLine aria-hidden className="size-6" />}
            label={t('actions.sign')}
            onClick={() => setWorkOrderOpen(true)}
          />
        ) : null}
      </div>

      <Card className="flex flex-col gap-1 rounded-[20px] px-[18px] py-4">
        <div className="flex items-baseline justify-between pb-1.5">
          <h2 className="text-[16px] font-semibold">{t('tasks.title')}</h2>
          {tasks.length ? (
            <span className="text-[13px] text-muted">
              {t('tasks.count', { done: doneCount, total: tasks.length })}
            </span>
          ) : null}
        </div>
        {tasks.length === 0 ? (
          <p className="py-2 text-[14px] text-muted">{t('tasks.empty')}</p>
        ) : (
          <ul className="flex flex-col">
            {tasks.map((task) => (
              <li key={task.id} className="flex min-h-12 items-center gap-3">
                <input
                  id={`task-${task.id}`}
                  type="checkbox"
                  checked={task.status === 'done'}
                  onChange={(e) => void toggleTask(task.id, e.target.checked)}
                  className="size-[22px] shrink-0 accent-[var(--ink)]"
                />
                <label htmlFor={`task-${task.id}`} className="flex flex-1 flex-col py-2 text-[15px]">
                  <span className={cn(task.status === 'done' && 'text-muted line-through')}>
                    {task.title}
                  </span>
                  {task.pending || task.post ? (
                    <span className="text-[12px] text-muted">
                      {[task.post, task.pending ? t('tasks.pending') : null].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </label>
                <button
                  type="button"
                  aria-label={t('tasks.photo', { task: task.title })}
                  onClick={() =>
                    photo.open({
                      ownerType: 'project',
                      ownerId: project.id,
                      projectId: project.id,
                      taskId: task.id,
                    })
                  }
                  className="inline-flex size-11 items-center justify-center gap-1 rounded-[12px] text-muted hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Camera aria-hidden className="size-5" />
                  {task.photoCount ? <span className="text-[12px]">{task.photoCount}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.can.clockTeam ? (
        <Card className="flex flex-col gap-1 rounded-[20px] px-[18px] py-4">
          <div className="flex items-baseline justify-between pb-1.5">
            <h2 className="text-[16px] font-semibold">{t('team.title')}</h2>
            <span className="text-[13px] text-muted">{t('today.onSite', { n: onSite.length })}</span>
          </div>
          <ul className="flex flex-col divide-y divide-line-soft">
            {team
              .filter((p) => p.employeeId !== me.id)
              .map((p, i) => (
                <li key={p.employeeId} className="flex min-h-14 items-center gap-3 py-2">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-[#111111]"
                    style={{ background: TEAM_COLORS[(i + 1) % TEAM_COLORS.length] }}
                  >
                    {p.initials}
                  </span>
                  <div className="flex flex-1 flex-col">
                    <span className="text-[15px] font-medium">{p.name}</span>
                    <span className="text-[12px] text-muted">
                      {p.onSite && p.since
                        ? t('team.since', { time: clockTime(new Date(p.since)) })
                        : t('team.notHere')}
                      {p.pending ? ` · ${t('tasks.pending')}` : ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={p.onSite ? 'secondary' : 'primary'}
                    loading={busy === p.employeeId}
                    onClick={() => void clock(p.onSite ? 'out' : 'in', p.employeeId)}
                    aria-label={t(p.onSite ? 'team.clockOutFor' : 'team.clockInFor', { name: p.name })}
                  >
                    {p.onSite ? t('team.clockOut') : t('team.clockIn')}
                  </Button>
                </li>
              ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-3">
            <Link
              href="/terrain/heures"
              className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-line px-4 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t('team.validate')}
            </Link>
            <Link
              href={`/terrain/rapport?chantier=${project.id}`}
              className="inline-flex h-11 items-center gap-2 rounded-[12px] border border-line px-4 text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-accent"
            >
              <ClipboardList aria-hidden className="size-4" />
              {t('team.report')}
            </Link>
          </div>
        </Card>
      ) : null}

      {data.otherProjects.length ? (
        <SelectField
          label={t('today.switchProject')}
          value={project.id}
          onChange={(e) => onSwitch(e.target.value)}
          options={[
            { value: project.id, label: project.name },
            ...data.otherProjects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      ) : null}

      {data.openIssues ? (
        <p className="text-center text-[13px] text-muted">{t('today.openIssues', { n: data.openIssues })}</p>
      ) : null}

      <IssueSheet
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        projectId={project.id}
        tasks={data.tasks}
        queuePhotos={photo.queueFiles}
      />
      {data.can.workOrders && workOrderOpen ? (
        <WorkOrderSheet
          open
          onClose={() => setWorkOrderOpen(false)}
          projectId={project.id}
          customerName={project.customerName}
          team={team.filter((p) => p.onSite)}
        />
      ) : null}
    </>
  );
}

function ActionTile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[84px] flex-col items-center justify-center gap-2 rounded-[16px] border border-line bg-surface text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:bg-line-soft"
    >
      {icon}
      <span className="text-[13px] font-semibold">{label}</span>
    </button>
  );
}
