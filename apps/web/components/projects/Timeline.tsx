'use client';

import type { ProjectTimelineItemDto } from '@batimint/contracts';
import { formatEuros, splitMentions } from '@batimint/domain';
import { Button, Card, cn, LiveIndicator, Segmented, Skeleton } from '@batimint/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckSquare,
  Eye,
  File,
  FileSignature,
  Flag,
  type LucideIcon,
  MapPin,
  MessageSquare,
  Receipt,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useRealtime } from '@/lib/realtime';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type Filter = 'all' | 'client' | 'money' | 'field' | 'comments';
type Item = ProjectTimelineItemDto;

const ICONS: Record<string, { icon: LucideIcon; tone: 'good' | 'accent' | 'warn' | 'neutral' | 'crit' }> = {
  'change_order.signed': { icon: Check, tone: 'good' },
  'change_order.sent': { icon: Send, tone: 'neutral' },
  'change_order.refused': { icon: X, tone: 'crit' },
  'photo.added': { icon: Camera, tone: 'neutral' },
  'document.added': { icon: File, tone: 'neutral' },
  'task.completed': { icon: CheckSquare, tone: 'good' },
  'project.status_changed': { icon: Flag, tone: 'neutral' },
  'project.created': { icon: FileSignature, tone: 'good' },
  'project.cost_recorded': { icon: Receipt, tone: 'neutral' },
  'budget.drift_detected': { icon: AlertTriangle, tone: 'warn' },
  'supplier_invoice.allocated': { icon: Receipt, tone: 'accent' },
  'team.arrived': { icon: MapPin, tone: 'neutral' },
  'issue.reported': { icon: AlertTriangle, tone: 'warn' },
  'work_order.signed': { icon: FileSignature, tone: 'good' },
  'invoice.issued': { icon: Check, tone: 'good' },
  comment: { icon: MessageSquare, tone: 'neutral' },
  'comment.client': { icon: MessageSquare, tone: 'accent' },
};

const ICON_BG = {
  good: 'bg-good/15 text-good',
  accent: 'bg-accent text-white',
  warn: 'bg-warn/15 text-[var(--warn-ink)]',
  crit: 'bg-crit/15 text-crit',
  neutral: 'bg-line-soft text-ink',
} as const;

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(iso));
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-BE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  });
}

export function ProjectTimeline({
  projectId,
  onOpenChangeOrder,
}: {
  projectId: string;
  onOpenChangeOrder: (id: string) => void;
}) {
  const t = useTranslations('projects.timeline');
  const tc = useTranslations('common');
  const { connected } = useRealtime();
  const can = useCan();
  const [filter, setFilter] = useState<Filter>('all');
  const feed = useInfiniteQuery({
    queryKey: ['timeline', projectId, filter],
    queryFn: ({ pageParam, signal }) =>
      api<{ items: Item[]; nextBefore: string | null }>(
        `/projects/${projectId}/timeline?filter=${filter}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
        { signal },
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const groups = useMemo(() => {
    const out: { key: string; items: Item[] }[] = [];
    for (const it of items) {
      const k = dayKey(it.occurredAt);
      const g = out.at(-1);
      if (g && g.key === k) g.items.push(it);
      else out.push({ key: k, items: [it] });
    }
    return out;
  }, [items]);
  const dayLabel = (k: string) =>
    k === today
      ? t('today')
      : k === yesterday
        ? t('yesterday')
        : new Date(`${k}T12:00:00Z`).toLocaleDateString('fr-BE', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'Europe/Brussels',
          });

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-6" role="region" aria-labelledby="timeline-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="timeline-title" className="text-[17px] font-semibold">
          {t('title')}
        </h2>
        <LiveIndicator label={tc('live')} offlineLabel={tc('reconnecting')} connected={connected} />
      </div>
      <div className="-mx-4 overflow-x-auto px-4 md:-mx-6 md:px-6">
        <Segmented<Filter>
          label={tc('filter')}
          value={filter}
          onChange={setFilter}
          options={(['all', 'client', 'money', 'field', 'comments'] as const)
            .filter((f) => f !== 'money' || can('pricing.read'))
            .map((f) => ({ value: f, label: t(`filters.${f}`) }))}
        />
      </div>
      <CommentComposer projectId={projectId} />
      <div data-testid="project-timeline" aria-live="polite" className="flex flex-col">
        {feed.isLoading ? (
          <Skeleton className="h-48" />
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-muted">
            {filter === 'all' ? t('empty') : t('emptyFilter')}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={dayLabel(g.key)} className="flex flex-col">
              <h3 className="pt-3 pb-1 text-[12px] font-semibold tracking-[0.08em] text-muted uppercase first-letter:uppercase">
                {dayLabel(g.key)}
              </h3>
              <ol className="flex flex-col divide-y divide-line-soft">
                {g.items.map((it) => (
                  <TimelineRow
                    key={it.id}
                    item={it}
                    projectId={projectId}
                    onOpenChangeOrder={onOpenChangeOrder}
                  />
                ))}
              </ol>
            </section>
          ))
        )}
        {feed.hasNextPage ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 self-center"
            loading={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            {t('loadMore')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function TimelineRow({
  item,
  projectId,
  onOpenChangeOrder,
}: {
  item: Item;
  projectId: string;
  onOpenChangeOrder: (id: string) => void;
}) {
  const t = useTranslations('projects.timeline');
  const meta = ICONS[item.type] ?? ICONS.comment!;
  const Icon = meta.icon;
  const queryClient = useQueryClient();
  const remove = useApiMutation<void>(() => ({ path: `/comments/${item.id}`, method: 'DELETE' }), {
    successMessage: t('deleted'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['timeline', projectId] }),
  });
  const positive = item.type === 'change_order.signed' && (item.amount ?? 0) > 0;
  const isComment = item.kind === 'comment';
  return (
    <li className="grid grid-cols-[44px_32px_minmax(0,1fr)] gap-x-3 py-3 sm:grid-cols-[52px_32px_minmax(0,1fr)_auto]">
      <time dateTime={item.occurredAt} className="pt-1 text-[13px] text-muted tabular-nums">
        {timeOf(item.occurredAt)}
      </time>
      <span className={cn('flex size-8 items-center justify-center rounded-full', ICON_BG[meta.tone])}>
        <Icon aria-hidden className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] font-semibold">
          {item.title}
          {item.comment?.fromClient ? (
            <span className="ml-2 align-middle text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">
              {t('fromClient')}
            </span>
          ) : null}
        </p>
        {item.body ? (
          isComment ? (
            <p className="text-[14px] whitespace-pre-wrap">
              {splitMentions(item.body).map((part, i) =>
                'mention' in part ? (
                  <span key={i} className="font-semibold text-accent">
                    @{part.mention}
                  </span>
                ) : (
                  <span key={i}>{part.text}</span>
                ),
              )}
            </p>
          ) : (
            <p className="text-[14px] text-muted">{item.body}</p>
          )
        ) : null}
        {item.photos.length ? (
          <ul className="mt-1 flex flex-wrap gap-2">
            {item.photos.slice(0, 6).map((ph, i) => (
              <li key={ph.id}>
                <a
                  href={ph.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-[10px] focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <img
                    src={ph.url}
                    alt={ph.caption ?? t('photo', { n: i + 1 })}
                    loading="lazy"
                    className="size-[72px] object-cover"
                  />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          {item.visibleToClient && !isComment ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <Eye aria-hidden className="size-3.5" />
              {t('visibleToClient')}
            </span>
          ) : null}
          {item.changeOrderId ? (
            <button
              type="button"
              onClick={() => onOpenChangeOrder(item.changeOrderId!)}
              className="text-[12px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              {t('openChangeOrder')}
            </button>
          ) : null}
          {isComment && item.comment?.mine && !item.visibleToClient ? (
            <button
              type="button"
              onClick={() => remove.mutate()}
              aria-label={t('delete')}
              title={t('delete')}
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-muted hover:bg-line-soft hover:text-crit"
            >
              <Trash2 aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {item.amount !== null ? (
        <span
          className={cn(
            'col-start-3 text-[15px] font-semibold tabular-nums sm:col-start-auto sm:pt-0.5 sm:text-right',
            positive ? 'text-good' : 'text-ink',
          )}
        >
          {positive ? '+' : ''}
          {formatEuros(BigInt(item.amount))}
        </span>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Commentaire avec mentions @
// ---------------------------------------------------------------------------

export function CommentComposer({
  projectId,
  subject = { type: 'project', id: projectId },
}: {
  projectId: string;
  subject?: { type: 'project' | 'change_order' | 'task'; id: string };
}) {
  const t = useTranslations('projects.timeline');
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const people = useApi<{ members: { userId: string; name: string }[] }>(
    ['projects', 'people'],
    '/projects/people',
  );
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<{ name: string; id: string }[]>([]);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const post = useApiMutation<{ body: string }>(
    ({ body }) => ({
      path: '/comments',
      body: { id: uuidv7(), subjectType: subject.type, subjectId: subject.id, body },
    }),
    {
      onSuccess: () => {
        setText('');
        setPicked([]);
        void queryClient.invalidateQueries({ queryKey: ['timeline', projectId] });
        void queryClient.invalidateQueries({ queryKey: ['comments'] });
      },
    },
  );
  const candidates = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return (people.data?.members ?? []).filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, people.data]);

  const onChange = (value: string, caret: number) => {
    setText(value);
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\p{L}\p{M}' -]{0,30})$/u.exec(before);
    if (m) {
      setMention({ start: caret - m[2]!.length - 1, query: m[2]! });
      setActive(0);
    } else setMention(null);
  };
  const choose = (person: { userId: string; name: string }) => {
    if (!mention) return;
    const end = mention.start + 1 + mention.query.length;
    const next = `${text.slice(0, mention.start)}@${person.name} ${text.slice(end)}`;
    setText(next);
    setPicked((p) =>
      p.some((x) => x.id === person.userId) ? p : [...p, { name: person.name, id: person.userId }],
    );
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + person.name.length + 2;
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };
  const encode = (value: string) =>
    picked.reduce((acc, p) => acc.split(`@${p.name}`).join(`@[${p.name}](${p.id})`), value.trim());
  const submit = () => {
    if (!text.trim() || post.isPending) return;
    post.mutate({ body: encode(text) });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (a + 1) % candidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (a - 1 + candidates.length) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(candidates[active]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };
  const listId = `mentions-${subject.id}`;
  return (
    <form
      className="relative flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`composer-${subject.id}`} className="sr-only">
        {t('composer')}
      </label>
      <textarea
        id={`composer-${subject.id}`}
        ref={ref}
        rows={2}
        value={text}
        placeholder={t('composerPlaceholder')}
        onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={Boolean(mention && candidates.length)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={mention && candidates.length ? `${listId}-${active}` : undefined}
        className="w-full resize-y rounded-[12px] border border-line bg-surface px-3 py-2.5 text-[15px] placeholder:text-muted hover:border-ink/30 focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-accent"
      />
      {mention ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('mentionList')}
          className="absolute top-full left-0 z-20 mt-1 w-64 overflow-hidden rounded-[12px] border border-line bg-surface p-1 shadow-lg"
        >
          {candidates.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-muted">{t('noMention')}</li>
          ) : (
            candidates.map((c, i) => (
              <li
                key={c.userId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
                className={cn(
                  'cursor-pointer rounded-[8px] px-3 py-2 text-[14px]',
                  i === active ? 'bg-line-soft font-semibold' : '',
                )}
              >
                {c.name}
              </li>
            ))
          )}
        </ul>
      ) : null}
      {post.error ? <p className="text-[13px] text-crit">{errorMessage(post.error)}</p> : null}
      {text.trim() ? (
        <Button type="submit" size="sm" className="self-end" loading={post.isPending}>
          {t('send')}
        </Button>
      ) : null}
    </form>
  );
}
