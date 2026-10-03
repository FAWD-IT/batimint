'use client';

import type { EquipmentDto, EquipmentSummaryDto, MaintenanceDto } from '@batimint/contracts';
import { formatEuros } from '@batimint/domain';
import {
  Button,
  Card,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '@batimint/ui';
import { CalendarCheck, Pencil, Plus, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import { useNewParam } from '@/lib/use-new-param';
import {
  AssignDialog,
  dayFr,
  EquipmentDialog,
  MaintenanceChip,
  MaintenanceDialog,
  MaintenanceDoneDialog,
  ReturnDialog,
} from './EquipmentDialogs';
import { ExportButtons } from '@/components/ExportButtons';

/** Matériel (03 §11, P13) : affectation en cours, prochain entretien, coût d'usage journalier. */
export function EquipmentListView() {
  const t = useTranslations('equipment');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [creating, setCreating] = useState(false);
  useNewParam(() => can('equipment.write') && setCreating(true));
  const list = useApi<{ items: EquipmentSummaryDto[] }>(
    ['equipment', 'list'],
    can('equipment.read') ? '/equipment' : null,
  );
  if (!can('equipment.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={
          list.data
            ? t('summary', { n: items.length, busy: items.filter((e) => e.current).length })
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButtons list="equipment" />
            {can('equipment.write') ? (
              <Button icon={<Plus aria-hidden className="size-4" />} onClick={() => setCreating(true)}>
                {t('new')}
              </Button>
            ) : null}
          </div>
        }
      />
      {list.error ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{tc('retry')}</Button>}
        />
      ) : list.isLoading ? (
        <Skeleton className="h-72" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Wrench aria-hidden className="size-5" />}
          title={t('emptyTitle')}
          description={t('empty')}
          action={
            can('equipment.write') ? <Button onClick={() => setCreating(true)}>{t('new')}</Button> : null
          }
        />
      ) : (
        <Table label={t('title')}>
          <thead>
            <tr>
              <Th>{t('columns.name')}</Th>
              <Th>{t('columns.assignedTo')}</Th>
              <Th className="hidden md:table-cell">{t('columns.maintenance')}</Th>
              <Th align="right" className="hidden sm:table-cell">
                {t('columns.dailyCost')}
              </Th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="hover:bg-line-soft/40">
                <Td>
                  <Link
                    href={`/materiel/${e.id}`}
                    className="flex min-h-11 flex-col justify-center rounded-[8px] focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="font-medium hover:underline">{e.name}</span>
                    <span className="text-[12px] text-muted">
                      {[e.code, e.category].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </Link>
                </Td>
                <Td>
                  {e.current ? (
                    <span className="flex flex-col">
                      <span>{e.current.project.name}</span>
                      <span className="text-[12px] text-muted">
                        {t('since', { date: dayFr(e.current.startDate) })}
                      </span>
                    </span>
                  ) : (
                    <Chip tone="good">{t('available')}</Chip>
                  )}
                </Td>
                <Td className="hidden md:table-cell">
                  <MaintenanceChip m={e.nextMaintenance} />
                </Td>
                <Td align="right" className="hidden tabular-nums sm:table-cell">
                  {formatEuros(BigInt(e.dailyCost))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {creating ? (
        <EquipmentDialog
          equipment={null}
          onClose={() => setCreating(false)}
          onSaved={(e) => {
            setCreating(false);
            router.push(`/materiel/${e.id}`);
          }}
        />
      ) : null}
    </div>
  );
}

export function EquipmentView({ id }: { id: string }) {
  const t = useTranslations('equipment');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [dialog, setDialog] = useState<'edit' | 'assign' | 'return' | 'plan' | null>(null);
  const [done, setDone] = useState<MaintenanceDto | null>(null);
  const data = useApi<EquipmentDto>(['equipment', id], can('equipment.read') ? `/equipment/${id}` : null);
  if (!can('equipment.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;
  if (data.error)
    return (
      <ErrorState
        title={tc('errorTitle')}
        description={errorMessage(data.error)}
        action={<Button onClick={() => void data.refetch()}>{tc('retry')}</Button>}
      />
    );
  if (!data.data) return <Skeleton className="h-96" />;
  const e = data.data;
  const writable = can('equipment.write');
  const pending = e.maintenance.filter((m) => !m.doneOn).sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const history = e.maintenance.filter((m) => m.doneOn);
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/materiel" className="hover:underline">
            {t('title')}
          </Link>
        }
        title={e.name}
        description={[
          e.code,
          e.category,
          e.serialNumber,
          t('perDay', { amount: formatEuros(BigInt(e.dailyCost)) }),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          writable ? (
            <Button
              variant="secondary"
              icon={<Pencil aria-hidden className="size-4" />}
              onClick={() => setDialog('edit')}
            >
              {t('edit')}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5" data-testid="equipment-current">
          <CardTitle>{t('current.title')}</CardTitle>
          {e.current ? (
            <>
              <Link href={`/chantiers/${e.current.project.id}`} className="font-semibold hover:underline">
                {e.current.project.number} · {e.current.project.name}
              </Link>
              <p className="text-[14px] text-muted">
                {t('since', { date: dayFr(e.current.startDate) })}
                {e.current.endDate ? ` · ${t('until', { date: dayFr(e.current.endDate) })}` : ''}
                {e.current.budgetLine ? ` · ${e.current.budgetLine.label}` : ''}
              </p>
              <p className="text-[14px] tabular-nums">
                {t('current.usage', { days: e.current.days, amount: formatEuros(BigInt(e.current.cost)) })}
              </p>
              {writable ? (
                <Button variant="secondary" className="self-start" onClick={() => setDialog('return')}>
                  {t('current.return')}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-[14px] text-muted">{t('current.none')}</p>
              {writable ? (
                <Button className="self-start" onClick={() => setDialog('assign')}>
                  {t('current.assign')}
                </Button>
              ) : null}
            </>
          )}
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{t('maintenance.title')}</CardTitle>
            {writable ? (
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => setDialog('plan')}
              >
                {t('maintenance.plan')}
              </Button>
            ) : null}
          </div>
          {pending.length || history.length ? (
            <ul className="flex flex-col divide-y divide-line-soft">
              {pending.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">
                      {t(`maintenance.kinds.${m.kind}`)} · {m.label}
                    </span>
                    <MaintenanceChip
                      m={{
                        ...m,
                        label: m.intervalMonths ? t('maintenance.every', { n: m.intervalMonths }) : '',
                      }}
                    />
                  </span>
                  {writable ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<CalendarCheck aria-hidden className="size-4" />}
                      aria-label={`${t('maintenance.done')} : ${m.label}`}
                      onClick={() => setDone(m)}
                    >
                      {t('maintenance.done')}
                    </Button>
                  ) : null}
                </li>
              ))}
              {history.slice(0, 5).map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 py-2.5 text-[14px] text-muted"
                >
                  <span>
                    {t(`maintenance.kinds.${m.kind}`)} · {m.label}
                    <span className="block text-[12px]">
                      {t('maintenance.doneOn', { date: dayFr(m.doneOn!) })}
                    </span>
                  </span>
                  {m.cost ? <span className="tabular-nums">{formatEuros(BigInt(m.cost))}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">{t('maintenance.empty')}</p>
          )}
        </Card>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-semibold">{t('history.title')}</h2>
        {e.assignments.length ? (
          <Table label={t('history.title')}>
            <thead>
              <tr>
                <Th>{t('columns.assignedTo')}</Th>
                <Th>{t('columns.period')}</Th>
                <Th align="right">{t('columns.days')}</Th>
                <Th align="right">{t('columns.cost')}</Th>
              </tr>
            </thead>
            <tbody>
              {e.assignments.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link href={`/chantiers/${a.project.id}`} className="hover:underline">
                      {a.project.number} · {a.project.name}
                    </Link>
                    {a.budgetLine ? (
                      <span className="block text-[12px] text-muted">{a.budgetLine.label}</span>
                    ) : null}
                  </Td>
                  <Td className="text-[14px]">
                    {dayFr(a.startDate)} → {a.endDate ? dayFr(a.endDate) : t('history.open')}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {a.days}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {formatEuros(BigInt(a.cost))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-[14px] text-muted">{t('history.empty')}</p>
        )}
      </section>
      {dialog === 'edit' ? <EquipmentDialog equipment={e} onClose={() => setDialog(null)} /> : null}
      {dialog === 'assign' ? <AssignDialog equipment={e} onClose={() => setDialog(null)} /> : null}
      {dialog === 'return' && e.current ? (
        <ReturnDialog
          equipment={e}
          assignmentId={e.current.id}
          startDate={e.current.startDate}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'plan' ? <MaintenanceDialog equipment={e} onClose={() => setDialog(null)} /> : null}
      {done ? <MaintenanceDoneDialog maintenance={done} onClose={() => setDone(null)} /> : null}
    </div>
  );
}
