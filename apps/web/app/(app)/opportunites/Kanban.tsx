'use client';

import type { OpportunityDto } from '@batimint/contracts';
import { formatEuros, OPPORTUNITY_STAGES, type OpportunityStage } from '@batimint/domain';
import { Button, Chip, cn, EmptyState, ErrorState, Skeleton, StatusDot, useToast } from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, ChevronDown, ClipboardCheck, MapPin, Paperclip } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { STAGE_TONES } from '@/components/crm/stages';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useRealtimeListener } from '@/lib/realtime';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { LostReasonDialog } from './LostReasonDialog';

const BOARD_KEY = ['opportunities', 'board'];

interface Move {
  id: string;
  stage: OpportunityStage;
  position: number;
  lostReason?: string | null;
}

/** Reproduit côté client le réordonnancement de l'API (mise à jour optimiste). */
function applyMove(items: OpportunityDto[], move: Move): OpportunityDto[] {
  const moving = items.find((o) => o.id === move.id);
  if (!moving) return items;
  const column = items
    .filter((o) => o.stage === move.stage && o.id !== move.id)
    .sort((a, b) => a.position - b.position);
  column.splice(Math.min(move.position, column.length), 0, {
    ...moving,
    stage: move.stage,
    lostReason: move.stage === 'lost' ? (move.lostReason ?? moving.lostReason) : null,
  });
  const positions = new Map(column.map((o, i) => [o.id, i]));
  return items.map((o) =>
    o.id === move.id
      ? { ...column[positions.get(o.id)!]!, position: positions.get(o.id)! }
      : positions.has(o.id)
        ? { ...o, position: positions.get(o.id)! }
        : o,
  );
}

export function Kanban() {
  const t = useTranslations('pipeline');
  const tc = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const board = useApi<{ items: OpportunityDto[] }>(BOARD_KEY, '/opportunities');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ stage: OpportunityStage; index: number } | null>(null);
  const [pendingLost, setPendingLost] = useState<Move | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const canWrite = can('leads.write');
  const showAmounts = can('pricing.read');

  // Les cartes modifiées par un collègue s'illuminent brièvement (temps réel).
  useRealtimeListener((m) => {
    if (m.topic !== 'opportunities' || !m.ref) return;
    const ref = m.ref;
    setFlash((prev) => new Set(prev).add(ref));
    setTimeout(
      () =>
        setFlash((prev) => {
          const next = new Set(prev);
          next.delete(ref);
          return next;
        }),
      2500,
    );
  });

  const items = board.data?.items ?? [];

  const move = async (m: Move, options: { undoable?: boolean } = { undoable: true }) => {
    const current = items.find((o) => o.id === m.id);
    if (!current) return;
    if (m.stage === 'lost' && current.stage !== 'lost' && !m.lostReason) {
      setPendingLost(m);
      return;
    }
    const before = { stage: current.stage, position: current.position, lostReason: current.lostReason };
    queryClient.setQueryData<{ items: OpportunityDto[] }>(BOARD_KEY, (d) =>
      d ? { items: applyMove(d.items, m) } : d,
    );
    const label = t(`stages.${m.stage}`);
    setAnnouncement(t('moved', { stage: label }));
    try {
      await api(`/opportunities/${m.id}/move`, {
        body: { stage: m.stage, position: m.position, lostReason: m.lostReason ?? null },
      });
      if (options.undoable && before.stage !== m.stage)
        toast.show({
          title: t('moved', { stage: label }),
          tone: 'good',
          action: {
            label: tc('undo'),
            onClick: () =>
              void move(
                { id: m.id, stage: before.stage, position: before.position, lostReason: before.lostReason },
                { undoable: false },
              ),
          },
        });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    } finally {
      void queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    }
  };

  if (board.error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(board.error)}
        action={<Button onClick={() => void board.refetch()}>{tc('retry')}</Button>}
      />
    );
  if (board.isLoading)
    return (
      <div className="flex gap-4 overflow-hidden" aria-busy>
        {OPPORTUNITY_STAGES.slice(0, 4).map((s) => (
          <Skeleton key={s} className="h-96 w-[280px] shrink-0" />
        ))}
      </div>
    );
  if (items.length === 0)
    return (
      <EmptyState
        icon={<Briefcase aria-hidden className="size-5" />}
        title={t('emptyTitle')}
        description={t('empty')}
      />
    );

  const onDragOver = (stage: OpportunityStage) => (e: DragEvent<HTMLElement>) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-card]')].filter(
      (el) => el.dataset['card'] !== dragId,
    );
    let index = cards.length;
    for (const [i, el] of cards.entries()) {
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    if (dropTarget?.stage !== stage || dropTarget.index !== index) setDropTarget({ stage, index });
  };

  const onDrop = (stage: OpportunityStage) => (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    const index = dropTarget?.stage === stage ? dropTarget.index : 0;
    setDragId(null);
    setDropTarget(null);
    if (id) void move({ id, stage, position: index });
  };

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {canWrite ? <p className="hidden text-[13px] text-muted md:block">{t('dragHint')}</p> : null}
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8"
        role="list"
        aria-label={t('title')}
      >
        {OPPORTUNITY_STAGES.map((stage) => {
          const column = items.filter((o) => o.stage === stage).sort((a, b) => a.position - b.position);
          const total = column.reduce((sum, o) => sum + (o.estimatedAmount ?? 0), 0);
          const visible = column.filter((o) => o.id !== dragId);
          return (
            <section
              key={stage}
              role="listitem"
              aria-labelledby={`col-${stage}`}
              onDragOver={canWrite ? onDragOver(stage) : undefined}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={canWrite ? onDrop(stage) : undefined}
              className={cn(
                'flex w-[min(84vw,300px)] shrink-0 snap-start flex-col gap-2 rounded-[16px] border bg-line-soft/50 p-2.5 transition-colors',
                dropTarget?.stage === stage ? 'border-accent bg-accent-soft/40' : 'border-transparent',
              )}
            >
              <header className="flex items-center justify-between gap-2 px-1.5 pt-1 pb-1.5">
                <h2 id={`col-${stage}`} className="flex items-center gap-2 text-[14px] font-semibold">
                  <StatusDot tone={STAGE_TONES[stage]} />
                  {t(`stages.${stage}`)}
                  <span className="text-muted tabular-nums">{column.length}</span>
                </h2>
                {showAmounts && total > 0 ? (
                  <span className="text-[12px] text-muted tabular-nums">{formatEuros(BigInt(total))}</span>
                ) : null}
              </header>
              <ol className="flex min-h-24 flex-col gap-2" aria-label={t(`stages.${stage}`)}>
                {visible.map((o, i) => (
                  <li key={o.id} className="flex flex-col gap-2">
                    {dropTarget?.stage === stage && dropTarget.index === i ? <DropLine /> : null}
                    <Card
                      o={o}
                      flash={flash.has(o.id)}
                      showAmount={showAmounts}
                      draggable={canWrite}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', o.id);
                        e.dataTransfer.effectAllowed = 'move';
                        // Laisse le navigateur capturer l'image de la carte avant de la masquer.
                        requestAnimationFrame(() => setDragId(o.id));
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                      onMove={
                        canWrite
                          ? (target) =>
                              void move({
                                id: o.id,
                                stage: target,
                                position: items.filter((x) => x.stage === target).length,
                              })
                          : undefined
                      }
                    />
                  </li>
                ))}
                {dropTarget?.stage === stage && dropTarget.index >= visible.length ? (
                  <li>
                    <DropLine />
                  </li>
                ) : null}
                {column.length === 0 && dropTarget?.stage !== stage ? (
                  <li className="flex min-h-20 items-center justify-center rounded-[12px] border border-dashed border-line px-3 text-center text-[13px] text-muted">
                    {t('emptyColumn')}
                  </li>
                ) : null}
              </ol>
            </section>
          );
        })}
      </div>
      {pendingLost ? (
        <LostReasonDialog
          onClose={() => setPendingLost(null)}
          onConfirm={(reason) => {
            const m = pendingLost;
            setPendingLost(null);
            void move({ ...m, lostReason: reason });
          }}
        />
      ) : null}
    </>
  );
}

function DropLine() {
  return <div aria-hidden className="h-1 rounded-full bg-accent" />;
}

function Card({
  o,
  flash,
  showAmount,
  draggable,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  o: OpportunityDto;
  flash: boolean;
  showAmount: boolean;
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onMove?: (stage: OpportunityStage) => void;
}) {
  const t = useTranslations('pipeline');
  return (
    <article
      data-card={o.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative flex flex-col gap-2 rounded-[12px] border bg-surface p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-[border-color,box-shadow] duration-300',
        draggable && 'cursor-grab active:cursor-grabbing',
        flash ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-ink/30',
      )}
    >
      <Link
        href={`/opportunites/${o.id}`}
        className="text-[14px] leading-snug font-semibold after:absolute after:inset-0 after:rounded-[12px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-accent"
        draggable={false}
      >
        {o.title}
      </Link>
      <p className="truncate text-[13px] text-muted">{o.customerName}</p>
      {o.siteLabel ? (
        <p className="flex items-center gap-1 truncate text-[12px] text-muted">
          <MapPin aria-hidden className="size-3 shrink-0" />
          {o.siteLabel}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        {showAmount && o.estimatedAmount ? (
          <span className="font-semibold text-ink tabular-nums">
            {formatEuros(BigInt(o.estimatedAmount))}
          </span>
        ) : null}
        {o.visitCount ? (
          <span className="inline-flex items-center gap-1">
            <ClipboardCheck aria-hidden className="size-3" />
            {t('visits', { count: o.visitCount })}
          </span>
        ) : null}
        {o.attachmentCount ? (
          <span className="inline-flex items-center gap-1">
            <Paperclip aria-hidden className="size-3" />
            {t('photos', { count: o.attachmentCount })}
          </span>
        ) : null}
        {o.stage === 'lost' && o.lostReason ? <Chip tone="crit">{o.lostReason}</Chip> : null}
      </div>
      {onMove ? <MoveMenu current={o.stage} title={o.title} onMove={onMove} /> : null}
    </article>
  );
}

/** Alternative clavier et tactile au glisser-déposer (08 : tout est faisable au clavier). */
function MoveMenu({
  current,
  title,
  onMove,
}: {
  current: OpportunityStage;
  title: string;
  onMove: (stage: OpportunityStage) => void;
}) {
  const t = useTranslations('pipeline');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const targets = OPPORTUNITY_STAGES.filter((s) => s !== current);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.parentElement?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  return (
    <div className="relative z-10 self-start">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${tc('moveTo')} (${title})`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12px] font-medium text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        {tc('moveTo')}
        <ChevronDown aria-hidden className="size-3.5" />
      </button>
      {open ? (
        <ul
          ref={menuRef}
          role="menu"
          aria-label={tc('moveTo')}
          onKeyDown={(e) => {
            const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              buttons[(i + 1) % buttons.length]?.focus();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
            } else if (e.key === 'Escape' || e.key === 'Tab') {
              setOpen(false);
              if (e.key === 'Escape') buttonRef.current?.focus();
            }
          }}
          className="absolute top-9 left-0 w-52 rounded-[12px] border border-line bg-surface p-1 shadow-lg"
        >
          {targets.map((s) => (
            <li key={s} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onMove(s);
                }}
                className="flex h-10 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[14px] hover:bg-line-soft focus-visible:bg-line-soft focus-visible:outline-none"
              >
                <StatusDot tone={STAGE_TONES[s]} />
                {t(`stages.${s}`)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
