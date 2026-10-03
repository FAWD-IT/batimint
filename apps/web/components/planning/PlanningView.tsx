'use client';

import type { PlanningConflictDto, PlanningDto, PlanningSlotDto } from '@batimint/contracts';
import { addDays, type Half, moveSlot, resizeSlot, slotHalfDays } from '@batimint/domain';
import {
  Button,
  Card,
  cn,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, GripVertical, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type DragEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { CalendarLinkButton } from './CalendarLinkButton';
import {
  cellAt,
  columnOf,
  type Grouping,
  halfDaysForHours,
  period,
  place,
  projectColor,
  type Row,
  rows as buildRows,
  shift,
  type Zoom,
} from './model';
import { draftOf, SlotDialog, type SlotDraft } from './SlotDialog';

const LABEL_W = 220;
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const fmt = (day: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-BE', { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

type Drag =
  | { kind: 'slot'; slot: PlanningSlotDto; grabOffset: number }
  | { kind: 'resize'; slot: PlanningSlotDto }
  | { kind: 'task'; taskId: string; projectId: string; hours: string };

type DialogState = { draft: SlotDraft; editing: PlanningSlotDto | null } | null;

/** Planning (03 §6, 02 P3) : grille ressources × jours, glisser-déposer, conflits signalés. */
export function PlanningView() {
  const t = useTranslations('planning');
  const tc = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const [zoom, setZoom] = useState<Zoom>('week');
  const [grouping, setGrouping] = useState<Grouping>('teams');
  const [anchor, setAnchor] = useState(todayIso);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState('');
  const drag = useRef<Drag | null>(null);
  const { from, to } = period(anchor, zoom);
  const key = ['planning', from, to] as const;
  const q = useApi<PlanningDto>([...key], `/planning?from=${from}&to=${to}`);
  const writable = can('planning.write');

  const data = q.data;
  const columns = data ? data.days.length * 2 : 0;
  const rowList = useMemo(() => (data ? buildRows(data, grouping) : []), [data, grouping]);
  const conflictBySlot = useMemo(() => {
    const m = new Map<string, PlanningConflictDto[]>();
    for (const c of data?.conflicts ?? []) for (const id of c.slotIds) m.set(id, [...(m.get(id) ?? []), c]);
    return m;
  }, [data]);
  const projectOf = (id: string) => data?.projects.find((p) => p.id === id);

  const describeConflict = (c: PlanningConflictDto) =>
    t(c.kind === 'absence' ? 'conflict.absence' : 'conflict.double', {
      name: c.employeeName,
      day: fmt(c.day, { weekday: 'long', day: 'numeric', month: 'long' }),
      half: t(`half.${c.half}`),
    });

  /** Écriture optimiste : la grille bouge tout de suite, le serveur confirme et recalcule les conflits. */
  const save = async (
    id: string,
    body: object,
    mode: 'create' | 'update',
    optimistic?: (slots: PlanningSlotDto[]) => PlanningSlotDto[],
  ) => {
    if (optimistic)
      queryClient.setQueryData<PlanningDto>([...key], (old) =>
        old ? { ...old, slots: optimistic(old.slots) } : old,
      );
    setPending(true);
    try {
      const r = await api<{ slot: PlanningSlotDto; conflicts: PlanningConflictDto[] }>(
        mode === 'create' ? '/planning/slots' : `/planning/slots/${id}`,
        { method: mode === 'create' ? 'POST' : 'PATCH', body: mode === 'create' ? { id, ...body } : body },
      );
      if (r.conflicts.length)
        toast.show({
          title: t('conflictToast'),
          description: describeConflict(r.conflicts[0]!),
          tone: 'crit',
        });
      else toast.show({ title: mode === 'create' ? t('created') : t('updated'), tone: 'good' });
      setAnnounce(
        t('announce', {
          start: fmt(r.slot.startDay, { weekday: 'long', day: 'numeric', month: 'long' }),
          end: fmt(r.slot.endDay, { weekday: 'long', day: 'numeric', month: 'long' }),
        }),
      );
      setDialog(null);
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      setPending(false);
      void queryClient.invalidateQueries({ queryKey: ['planning'] });
    }
  };

  const remove = async (slot: PlanningSlotDto) => {
    queryClient.setQueryData<PlanningDto>([...key], (old) =>
      old ? { ...old, slots: old.slots.filter((s) => s.id !== slot.id) } : old,
    );
    setDialog(null);
    try {
      await api(`/planning/slots/${slot.id}`, { method: 'DELETE' });
      toast.show({
        title: t('deleted'),
        tone: 'neutral',
        action: {
          label: tc('undo'),
          onClick: () =>
            void save(
              slot.id,
              {
                projectId: slot.projectId,
                employeeId: slot.employeeId,
                teamId: slot.teamId,
                taskId: slot.taskId,
                startDay: slot.startDay,
                startHalf: slot.startHalf,
                endDay: slot.endDay,
                endHalf: slot.endHalf,
                note: slot.note,
              },
              'create',
            ),
        },
      });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['planning'] });
    }
  };

  const fromDraft = (d: SlotDraft) => ({
    projectId: d.projectId,
    employeeId: d.resource.startsWith('e:') ? d.resource.slice(2) : null,
    teamId: d.resource.startsWith('t:') ? d.resource.slice(2) : null,
    taskId: d.taskId || null,
    startDay: d.startDay,
    startHalf: d.startHalf,
    endDay: d.endDay,
    endHalf: d.endHalf,
    note: d.note.trim() || null,
  });

  const newDraft = (patch: Partial<SlotDraft> = {}): SlotDraft => ({
    projectId: '',
    resource: '',
    taskId: '',
    startDay: anchor < from || anchor > to ? from : anchor,
    startHalf: 'am',
    endDay: anchor < from || anchor > to ? from : anchor,
    endHalf: 'pm',
    note: '',
    ...patch,
  });

  // ---------------------------------------------------------------------------
  // Glisser-déposer (souris) — l'alternative clavier passe par les flèches et le dialogue.
  // ---------------------------------------------------------------------------
  const columnFromEvent = (e: DragEvent<HTMLElement> | React.MouseEvent<HTMLElement>, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = r.width / columns;
    return Math.min(columns - 1, Math.max(0, Math.floor((e.clientX - r.left) / w)));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, row: Row) => {
    e.preventDefault();
    const d = drag.current;
    drag.current = null;
    if (!d || !data || !writable) return;
    const col = columnFromEvent(e, e.currentTarget);
    if (d.kind === 'task') {
      if (!row.drop) return toast.show({ title: t('dropOnResource'), tone: 'neutral' });
      const start = cellAt(from, col);
      const range = resizeSlot(
        { startDay: start.day, startHalf: start.half, endDay: start.day, endHalf: start.half },
        halfDaysForHours(d.hours),
      );
      const id = uuidv7();
      return void save(id, { projectId: d.projectId, ...row.drop, taskId: d.taskId, ...range }, 'create');
    }
    if (d.kind === 'resize') {
      const end = cellAt(from, col);
      const startCol = columnOf(from, d.slot.startDay, d.slot.startHalf);
      if (col < startCol) return;
      const halves = slotHalfDays({ ...d.slot, endDay: end.day, endHalf: end.half }).length;
      const range = resizeSlot(d.slot, Math.max(1, halves));
      return void save(d.slot.id, range, 'update', (slots) =>
        slots.map((s) => (s.id === d.slot.id ? { ...s, ...range } : s)),
      );
    }
    const start = cellAt(from, Math.max(0, col - d.grabOffset));
    const range = moveSlot(d.slot, start);
    // Déposé sur une autre ligne (équipe ou personne) : l'affectation change de ressource.
    const reassign =
      grouping !== 'projects' &&
      row.drop &&
      (row.drop.employeeId !== d.slot.employeeId || row.drop.teamId !== d.slot.teamId)
        ? row.drop
        : null;
    void save(d.slot.id, { ...range, ...(reassign ?? {}) }, 'update', (slots) =>
      slots.map((s) => (s.id === d.slot.id ? { ...s, ...range, ...(reassign ?? {}) } : s)),
    );
  };

  /** Flèches : déplacer d'une demi-journée ; Maj + flèches : allonger ou raccourcir ; Suppr : retirer. */
  const onBlockKey = (e: KeyboardEvent<HTMLButtonElement>, slot: PlanningSlotDto) => {
    if (!writable) return;
    const size = slotHalfDays(slot).length;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return void remove(slot);
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) {
      const range = resizeSlot(slot, size + dir);
      return void save(slot.id, range, 'update', (slots) =>
        slots.map((s) => (s.id === slot.id ? { ...s, ...range } : s)),
      );
    }
    // Avancer d'une demi-journée ouvrée (en reculant, on repart de la demi-journée précédente).
    let target = { day: slot.startDay, half: slot.startHalf as Half };
    for (let guard = 0; guard < 14; guard++) {
      target =
        dir > 0
          ? target.half === 'am'
            ? { day: target.day, half: 'pm' }
            : { day: addDays(target.day, 1), half: 'am' }
          : target.half === 'pm'
            ? { day: target.day, half: 'am' }
            : { day: addDays(target.day, -1), half: 'pm' };
      if (
        slotHalfDays({
          startDay: target.day,
          startHalf: target.half,
          endDay: target.day,
          endHalf: target.half,
        }).length
      )
        break;
    }
    const range = moveSlot(slot, target);
    void save(slot.id, range, 'update', (slots) =>
      slots.map((s) => (s.id === slot.id ? { ...s, ...range } : s)),
    );
  };

  if (!can('planning.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const periodLabel =
    zoom === 'week'
      ? t('weekOf', {
          from: fmt(from, { day: 'numeric', month: 'long' }),
          to: fmt(to, { day: 'numeric', month: 'long', year: 'numeric' }),
        })
      : fmt(`${anchor.slice(0, 7)}-15`, { month: 'long', year: 'numeric' });
  const colMin = zoom === 'week' ? 44 : 14;
  const today = todayIso();

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <CalendarLinkButton />
            {writable ? (
              <Button
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => data && setDialog({ draft: newDraft(), editing: null })}
              >
                {t('new')}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('previous')}
            onClick={() => setAnchor(shift(anchor, zoom, -1))}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(todayIso())}>
            {t('today')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('next')}
            onClick={() => setAnchor(shift(anchor, zoom, 1))}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
        <h2 className="text-[17px] font-semibold first-letter:uppercase" aria-live="polite">
          {periodLabel}
        </h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <Segmented
            label={t('zoomLabel')}
            value={zoom}
            onChange={setZoom}
            options={[
              { value: 'week', label: t('zoom.week') },
              { value: 'month', label: t('zoom.month') },
            ]}
          />
          <Segmented
            label={t('groupLabel')}
            value={grouping}
            onChange={setGrouping}
            options={[
              { value: 'teams', label: t('group.teams') },
              { value: 'people', label: t('group.people') },
              { value: 'projects', label: t('group.projects') },
            ]}
          />
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
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
      ) : !data!.employees.length && !data!.teams.length ? (
        <EmptyState
          icon={<CalendarDays aria-hidden className="size-6" />}
          title={t('noPeopleTitle')}
          description={t('noPeople')}
        />
      ) : (
        <>
          {data!.conflicts.length ? (
            <Notice tone="warn" title={t('conflictsTitle', { n: data!.conflicts.length })}>
              <ul className="flex flex-col gap-1" data-testid="planning-conflicts">
                {data!.conflicts.slice(0, 6).map((c, i) => (
                  <li key={i}>{describeConflict(c)}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            {/* Grille (écrans larges) */}
            <div className="hidden overflow-x-auto rounded-[16px] border border-line bg-surface lg:block">
              <div
                style={{ minWidth: LABEL_W + columns * colMin }}
                role="grid"
                aria-label={t('gridLabel')}
                aria-rowcount={rowList.length + 1}
              >
                <div role="row" className="sticky top-0 z-10 flex border-b border-line bg-surface">
                  <div
                    role="columnheader"
                    className="shrink-0 px-4 py-2 text-[12px] font-semibold text-muted"
                    style={{ width: LABEL_W }}
                  >
                    {t(`group.${grouping}`)}
                  </div>
                  <div
                    className="grid flex-1"
                    style={{ gridTemplateColumns: `repeat(${data!.days.length}, minmax(0, 1fr))` }}
                  >
                    {data!.days.map((d) => (
                      <div
                        key={d.day}
                        role="columnheader"
                        className={cn(
                          'border-l border-line-soft px-1 py-2 text-center text-[12px]',
                          !d.working && 'bg-line-soft/60 text-muted',
                          d.day === today && 'font-semibold text-accent',
                        )}
                      >
                        {zoom === 'week' ? (
                          <>
                            <span className="block first-letter:uppercase">
                              {fmt(d.day, { weekday: 'short' })}
                            </span>
                            <span className="block text-[15px] font-semibold">
                              {fmt(d.day, { day: 'numeric' })}
                            </span>
                          </>
                        ) : (
                          <span>{fmt(d.day, { day: 'numeric' })}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {rowList.map((row) => {
                  const own = place(row.slots, from, columns);
                  const inherited = place(row.inherited, from, columns);
                  const lanes = own.lanes + (row.inherited.length ? inherited.lanes : 0);
                  return (
                    <div key={row.key} role="row" className="flex border-b border-line-soft last:border-b-0">
                      <div
                        role="rowheader"
                        className={cn(
                          'flex shrink-0 flex-col justify-center px-4 py-2',
                          row.nested && 'pl-8',
                        )}
                        style={{ width: LABEL_W }}
                      >
                        <span
                          className={cn(
                            'truncate text-[14px]',
                            row.kind === 'team' ? 'font-semibold' : 'font-medium',
                          )}
                        >
                          {row.label}
                        </span>
                        {row.sublabel ? (
                          <span className="truncate text-[12px] text-muted">{row.sublabel}</span>
                        ) : null}
                      </div>
                      <div
                        role="gridcell"
                        aria-label={t('rowCells', { name: row.label })}
                        data-testid={`planning-row-${row.label}`}
                        className="relative flex-1"
                        style={{ minHeight: 12 + lanes * 40 }}
                        onDragOver={(e) => {
                          if (writable) e.preventDefault();
                        }}
                        onDrop={(e) => onDrop(e, row)}
                        onClick={(e) => {
                          if (!writable || e.target !== e.currentTarget) return;
                          const c = cellAt(from, columnFromEvent(e, e.currentTarget));
                          setDialog({
                            draft: newDraft({
                              startDay: c.day,
                              startHalf: c.half,
                              endDay: c.day,
                              endHalf: 'pm',
                              resource: row.drop
                                ? row.drop.teamId
                                  ? `t:${row.drop.teamId}`
                                  : `e:${row.drop.employeeId}`
                                : '',
                              projectId: row.kind === 'project' ? row.id : '',
                            }),
                            editing: null,
                          });
                        }}
                      >
                        {/* Fond : jours non ouvrés, aujourd'hui, congés */}
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-0 grid"
                          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                        >
                          {Array.from({ length: columns }, (_, i) => {
                            const d = data!.days[Math.floor(i / 2)]!;
                            const half: Half = i % 2 ? 'pm' : 'am';
                            const off = row.absences.some(
                              (a) =>
                                a.startsOn <= d.day &&
                                a.endsOn >= d.day &&
                                (a.halfDay === null || a.halfDay === half),
                            );
                            return (
                              <div
                                key={i}
                                className={cn(
                                  i % 2 === 0 ? 'border-l border-line-soft' : '',
                                  !d.working && 'bg-line-soft/60',
                                  d.day === today && 'bg-accent-soft',
                                  off &&
                                    'bg-[repeating-linear-gradient(135deg,var(--line-soft)_0_6px,transparent_6px_12px)]',
                                )}
                              />
                            );
                          })}
                        </div>
                        {row.absences.length ? (
                          <span className="sr-only">
                            {row.absences
                              .map((a) =>
                                t('absence', {
                                  from: fmt(a.startsOn, { day: 'numeric', month: 'long' }),
                                  to: fmt(a.endsOn, { day: 'numeric', month: 'long' }),
                                }),
                              )
                              .join(' · ')}
                          </span>
                        ) : null}
                        <div
                          className="pointer-events-none relative grid gap-y-1 py-1.5"
                          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
                        >
                          {[
                            ...own.items.map((p) => ({ p, lane: p.lane, faded: false })),
                            ...inherited.items.map((p) => ({ p, lane: own.lanes + p.lane, faded: true })),
                          ].map(({ p, lane, faded }) => {
                            const proj = projectOf(p.slot.projectId);
                            const color = projectColor(p.slot.projectId);
                            const conflicts = conflictBySlot.get(p.slot.id) ?? [];
                            const label = [
                              proj?.shortLabel ?? '',
                              p.slot.taskTitle,
                              t('range', {
                                start: fmt(p.slot.startDay, { weekday: 'short', day: 'numeric' }),
                                end: fmt(p.slot.endDay, { weekday: 'short', day: 'numeric', month: 'short' }),
                                days: String(p.slot.workingDays).replace('.', ','),
                              }),
                              faded ? t('teamSlot') : null,
                              conflicts.length ? t('hasConflict') : null,
                            ]
                              .filter(Boolean)
                              .join(', ');
                            return (
                              <button
                                key={`${p.slot.id}-${faded}`}
                                type="button"
                                aria-label={label}
                                title={label}
                                draggable={writable && !faded}
                                onDragStart={(e) => {
                                  const parent = e.currentTarget.parentElement!.getBoundingClientRect();
                                  const col = Math.floor(
                                    ((e.clientX - parent.left) / parent.width) * columns,
                                  );
                                  drag.current = {
                                    kind: 'slot',
                                    slot: p.slot,
                                    grabOffset: Math.max(0, col - p.start),
                                  };
                                  e.dataTransfer.effectAllowed = 'move';
                                  e.dataTransfer.setData('text/plain', p.slot.id);
                                }}
                                onKeyDown={(e) => !faded && onBlockKey(e, p.slot)}
                                onClick={() => data && setDialog({ draft: draftOf(p.slot), editing: p.slot })}
                                className={cn(
                                  'pointer-events-auto relative flex h-9 min-w-0 items-center gap-1 overflow-hidden rounded-[8px] border-l-[3px] px-2 text-left text-[12px] text-ink',
                                  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                                  faded ? 'opacity-60' : 'cursor-grab active:cursor-grabbing',
                                  conflicts.length && 'ring-2 ring-crit',
                                  p.clippedStart && 'rounded-l-none',
                                  p.clippedEnd && 'rounded-r-none',
                                )}
                                style={{
                                  gridColumn: `${p.start + 1} / ${p.end + 2}`,
                                  gridRow: lane + 1,
                                  borderLeftColor: color,
                                  background: `color-mix(in srgb, ${color} 14%, var(--surface))`,
                                }}
                              >
                                {conflicts.length ? (
                                  <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-crit" />
                                ) : null}
                                <span className="truncate font-semibold">{proj?.shortLabel}</span>
                                {zoom === 'week' && p.slot.taskTitle ? (
                                  <span className="truncate text-muted">· {p.slot.taskTitle}</span>
                                ) : null}
                                {writable && !faded ? (
                                  <span
                                    aria-hidden
                                    draggable
                                    onDragStart={(e) => {
                                      e.stopPropagation();
                                      drag.current = { kind: 'resize', slot: p.slot };
                                      e.dataTransfer.setData('text/plain', `resize:${p.slot.id}`);
                                    }}
                                    data-testid="slot-resize"
                                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-ink/10"
                                  />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Agenda (téléphone et tablette) */}
            <Agenda data={data!} onOpen={(s) => setDialog({ draft: draftOf(s), editing: s })} />

            {/* Tâches à planifier */}
            <Card className="flex h-fit flex-col gap-3 p-4">
              <div>
                <h2 className="text-[15px] font-semibold">
                  {t('unplanned', { n: data!.unplannedTasks.length })}
                </h2>
                <p className="text-[12px] text-muted">
                  {writable ? t('unplannedHint') : t('unplannedReadonly')}
                </p>
              </div>
              {data!.unplannedTasks.length === 0 ? (
                <p className="text-[13px] text-muted">{t('allPlanned')}</p>
              ) : (
                <ul
                  className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto"
                  aria-label={t('unplannedList')}
                >
                  {data!.unplannedTasks.slice(0, 80).map((task) => {
                    const proj = projectOf(task.projectId);
                    return (
                      <li
                        key={task.id}
                        draggable={writable}
                        onDragStart={(e) => {
                          drag.current = {
                            kind: 'task',
                            taskId: task.id,
                            projectId: task.projectId,
                            hours: task.plannedHours,
                          };
                          e.dataTransfer.effectAllowed = 'copy';
                          e.dataTransfer.setData('text/plain', task.id);
                        }}
                        data-testid={`unplanned-${task.title}`}
                        className="flex items-center gap-2 rounded-[10px] border border-line px-2 py-1.5"
                        style={{ borderLeft: `3px solid ${projectColor(task.projectId)}` }}
                      >
                        {writable ? (
                          <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-muted" />
                        ) : null}
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-[13px] font-medium">{task.title}</span>
                          <span className="truncate text-[12px] text-muted">
                            {proj?.shortLabel}
                            {task.post ? ` · ${task.post}` : ''}
                          </span>
                        </div>
                        {writable ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={t('planTask', { task: task.title })}
                            onClick={() =>
                              setDialog({
                                draft: newDraft({ projectId: task.projectId, taskId: task.id }),
                                editing: null,
                              })
                            }
                          >
                            <Plus aria-hidden className="size-4" />
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
      {dialog && data ? (
        <SlotDialog
          data={data}
          initial={dialog.draft}
          editing={dialog.editing}
          pending={pending}
          onClose={() => setDialog(null)}
          onDelete={dialog.editing && writable ? () => void remove(dialog.editing!) : undefined}
          onSave={(d) =>
            writable
              ? void save(dialog.editing?.id ?? uuidv7(), fromDraft(d), dialog.editing ? 'update' : 'create')
              : setDialog(null)
          }
        />
      ) : null}
    </div>
  );
}

/** Agenda par jour pour les petits écrans (pas de glisser-déposer au doigt). */
function Agenda({ data, onOpen }: { data: PlanningDto; onOpen: (s: PlanningSlotDto) => void }) {
  const t = useTranslations('planning');
  const name = (s: PlanningSlotDto) =>
    s.teamId
      ? (data.teams.find((x) => x.id === s.teamId)?.name ?? '')
      : (data.employees.find((x) => x.id === s.employeeId)?.name ?? '');
  const days = data.days
    .filter((d) => d.working)
    .map((d) => ({
      day: d.day,
      slots: data.slots.filter((s) => slotHalfDays(s).some((h) => h.day === d.day)),
    }))
    .filter((d) => d.slots.length);
  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {days.length === 0 ? <p className="text-[14px] text-muted">{t('emptyPeriod')}</p> : null}
      {days.map((d) => (
        <section key={d.day} aria-label={fmt(d.day, { weekday: 'long', day: 'numeric', month: 'long' })}>
          <h3 className="mb-1.5 text-[14px] font-semibold first-letter:uppercase">
            {fmt(d.day, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {d.slots.map((s) => {
              const p = data.projects.find((x) => x.id === s.projectId);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(s)}
                    className="flex min-h-12 w-full flex-col rounded-[12px] border border-line bg-surface px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-accent"
                    style={{ borderLeft: `4px solid ${projectColor(s.projectId)}` }}
                  >
                    <span className="text-[14px] font-semibold">{p?.shortLabel}</span>
                    <span className="text-[12px] text-muted">
                      {name(s)}
                      {s.taskTitle ? ` · ${s.taskTitle}` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
