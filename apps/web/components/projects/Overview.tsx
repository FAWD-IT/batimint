'use client';

import type { ProjectDto, ProjectTodoDto } from '@batimint/contracts';
import { dec, formatEuros, percentInt } from '@batimint/domain';
import { Button, Card, cn, Gauge, HeroCard } from '@batimint/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useCan } from '@/lib/session';
import { formatPoints, formatRate } from './status';

/** Montant en euros sans centimes, comme la maquette (« 38 400 € »). */
function euros(cents: number): string {
  return formatEuros(BigInt(cents), { decimals: false });
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[14px]">
        <span className="text-panel-muted">{label}</span>
        <span className="font-semibold tabular-nums">{euros(value)}</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/15"
        role="img"
        aria-label={`${label} ${euros(value)}`}
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export function MarginCard({
  project,
  onPlanChangeOrder,
}: {
  project: ProjectDto;
  onPlanChangeOrder: (budgetLineId: string) => void;
}) {
  const t = useTranslations('projects.margin');
  const can = useCan();
  const [help, setHelp] = useState(false);
  const helpId = useId();
  const f = project.financials;
  if (!f)
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="text-[17px] font-semibold">{t('title')}</h2>
        <p className="text-[14px] text-muted">{t('noFinance')}</p>
      </Card>
    );
  const delta = formatPoints(f.plannedMargin, f.estimatedMargin);
  const down =
    f.plannedMargin && f.estimatedMargin ? dec(f.estimatedMargin).lessThan(f.plannedMargin) : false;
  const drifting = project.budgetLines
    .filter((l) => l.drift)
    .sort((a, b) => Number(b.consumption ?? 0) - Number(a.consumption ?? 0))[0];
  const max = Math.max(f.contractAmount, f.committed, f.invoiced);
  return (
    <HeroCard className="flex flex-col gap-5" role="region" aria-labelledby="margin-title">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 id="margin-title" className="text-[17px] font-semibold">
            {t('title')}
          </h2>
          <button
            type="button"
            aria-label={t('help')}
            aria-expanded={help}
            aria-controls={helpId}
            onClick={() => setHelp((h) => !h)}
            className="flex size-7 items-center justify-center rounded-full text-panel-muted hover:bg-white/10 hover:text-white"
          >
            <Info aria-hidden className="size-4" />
          </button>
        </div>
        <span className="text-[13px] text-panel-muted">
          {t('planned', { rate: formatRate(f.plannedMargin) })}
        </span>
      </div>
      {help ? (
        <p id={helpId} className="rounded-[10px] bg-white/10 p-3 text-[13px] text-panel-text">
          {t('helpText')}
        </p>
      ) : null}
      <p className="flex items-baseline gap-3" data-testid="estimated-margin">
        <span className="text-[44px] leading-none font-bold tracking-[-0.03em] tabular-nums">
          {formatRate(f.estimatedMargin)}
        </span>
        {delta ? (
          <span className={cn('text-[14px] font-semibold', down ? 'text-[#FF9F43]' : 'text-[#7EE2A8]')}>
            {t('delta', { delta })}
          </span>
        ) : null}
      </p>
      <div className="flex flex-col gap-3">
        <Bar label={t('budgeted')} value={f.contractAmount} max={max} tone="bg-white" />
        <Bar label={t('committed')} value={f.committed} max={max} tone="bg-[#FF9F43]" />
        <Bar label={t('invoiced')} value={f.invoiced} max={max} tone="bg-[#7D93FF]" />
      </div>
      {f.changeOrdersAmount ? (
        <p className="text-[12px] text-panel-muted">
          {t('contract', { amount: euros(f.contractAmount) })} ·{' '}
          {t('changeOrders', { amount: euros(f.changeOrdersAmount) })}
        </p>
      ) : null}
      {drifting ? (
        <div className="flex flex-col gap-2 border-t border-white/15 pt-4 text-[14px]">
          <p>
            {t('drift', {
              label: drifting.label,
              percent: Math.round((Number(drifting.consumption ?? 1) - 1) * 100),
            })}
          </p>
          {can('projects.write') ? (
            <button
              type="button"
              onClick={() => onPlanChangeOrder(drifting.id)}
              className="self-start text-[14px] font-semibold text-white underline underline-offset-2 hover:no-underline"
            >
              {t('driftCta')}
            </button>
          ) : null}
        </div>
      ) : null}
    </HeroCard>
  );
}

export function ProgressCard({ project }: { project: ProjectDto }) {
  const t = useTranslations('projects.progress');
  return (
    <Card className="flex flex-col gap-3" role="region" aria-labelledby="progress-title">
      <h2 id="progress-title" className="text-[17px] font-semibold">
        {t('title')}
      </h2>
      {project.budgetLines.length === 0 ? (
        <p className="text-[14px] text-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5" data-testid="progress-by-post">
          {project.budgetLines.map((l) => {
            const pct = percentInt(l.progress);
            return (
              <li
                key={l.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(80px,120px)_44px] items-center gap-3"
              >
                <span
                  className="truncate text-[14px]"
                  title={t('tasks', { done: l.doneCount, total: l.taskCount })}
                >
                  {l.label}
                </span>
                <Gauge
                  value={pct / 100}
                  tone={l.drift ? 'warn' : 'ink'}
                  height={6}
                  label={t('of', { label: l.label, percent: pct })}
                />
                <span
                  className={cn(
                    'text-right text-[14px] tabular-nums',
                    l.drift ? 'font-semibold text-[var(--warn-ink)]' : 'text-ink',
                  )}
                >
                  {pct} %
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function TodoCard({
  project,
  onAction,
}: {
  project: ProjectDto;
  onAction: (todo: ProjectTodoDto) => void;
}) {
  const t = useTranslations('projects.todo');
  const can = useCan();
  const write = can('projects.write');
  return (
    <Card className="flex flex-col gap-3" role="region" aria-labelledby="todo-title">
      <h2 id="todo-title" className="text-[17px] font-semibold">
        {t('title')}
      </h2>
      {project.todos.length === 0 ? (
        <p className="text-[14px] text-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft" data-testid="project-todos">
          {project.todos.map((todo) => {
            const { title, hint, cta } = todoText(todo, t);
            return (
              <li
                key={`${todo.kind}-${todo.ref}`}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className={cn('text-[15px] font-semibold', todo.severity === 'crit' && 'text-crit')}>
                    {title}
                  </p>
                  {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
                </div>
                {cta && (write || todo.kind === 'change_order_awaiting') ? (
                  <Button size="sm" variant="secondary" onClick={() => onAction(todo)}>
                    {cta}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function todoText(todo: ProjectTodoDto, t: ReturnType<typeof useTranslations>) {
  switch (todo.kind) {
    case 'invoice_overdue':
      return {
        title: t('invoice_overdue', { number: todo.number ?? '', days: todo.days }),
        hint: t('invoice_overdueHint', { amount: formatEuros(BigInt(todo.amount)) }),
        cta: null,
      };
    case 'budget_drift':
      return {
        title: t('budget_drift', { label: todo.label, percent: todo.overPercent }),
        hint: t('budget_driftHint'),
        cta: t('budget_driftCta'),
      };
    case 'change_order_draft':
      return {
        title: t('change_order_draft', { ordinal: todo.ordinal }),
        hint: todo.title,
        cta: t('change_order_draftCta'),
      };
    case 'change_order_awaiting':
      return {
        title: t('change_order_awaiting', { ordinal: todo.ordinal }),
        hint: t('change_order_awaitingHint', { title: todo.title, days: todo.days }),
        cta: t('change_order_awaitingCta'),
      };
    case 'client_question':
      return {
        title: t('client_question', { author: todo.author, subject: todo.subject }),
        hint: null,
        cta: t('client_questionCta'),
      };
    case 'project_late':
      return { title: t('project_late', { days: todo.days }), hint: null, cta: null };
  }
}
