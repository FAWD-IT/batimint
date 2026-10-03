'use client';

import type {
  ReorderProposalDto,
  StockItemDto,
  StockLocationDto,
  StockMovementDto,
} from '@batimint/contracts';
import { formatEuros, formatQuantity, multiplyCents } from '@batimint/domain';
import {
  Button,
  Card,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Segmented,
  Skeleton,
  Table,
  Td,
  Th,
  type Tone,
} from '@batimint/ui';
import { ArrowLeftRight, Boxes, PackagePlus, Plus, Truck, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';
import {
  LocationDialog,
  MovementDialog,
  type MovementKind,
  STOCK_INVALIDATE,
  ThresholdDialog,
} from './StockDialogs';

type Tab = 'items' | 'movements' | 'reorder';
const TAB_PARAM: Record<Tab, string | null> = { items: null, movements: 'mouvements', reorder: 'reappro' };
const KIND_TONE: Record<MovementKind, Tone> = {
  in: 'good',
  out: 'accent',
  transfer: 'neutral',
  adjustment: 'warn',
};

const dateTime = (d: string) =>
  new Intl.DateTimeFormat('fr-BE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Brussels',
  }).format(new Date(d));

/** Stock (03 §11, P13) : emplacements, articles au coût moyen pondéré, mouvements, réapprovisionnement. */
export function StockView() {
  const t = useTranslations('stock');
  const tc = useTranslations('common');
  const can = useCan();
  const router = useRouter();
  const search = useSearchParams();
  const errorMessage = useErrorMessage();
  const tab: Tab =
    search.get('onglet') === 'mouvements'
      ? 'movements'
      : search.get('onglet') === 'reappro'
        ? 'reorder'
        : 'items';
  const locationId = search.get('emplacement');
  const [moving, setMoving] = useState<{ kind?: MovementKind; itemId?: string } | null>(null);
  const [addingLocation, setAddingLocation] = useState(false);
  const [threshold, setThreshold] = useState<StockItemDto | null>(null);
  const readable = can('stock.read');
  const writable = can('stock.write');

  const locations = useApi<{ items: StockLocationDto[] }>(
    ['stock', 'locations'],
    readable ? '/stock/locations' : null,
  );
  const items = useApi<{ items: StockItemDto[] }>(
    ['stock', 'items', locationId ?? 'all'],
    readable && tab === 'items' ? `/stock${locationId ? `?locationId=${locationId}` : ''}` : null,
  );
  const movements = useApi<{ items: StockMovementDto[] }>(
    ['stock', 'movements', locationId ?? 'all'],
    readable && tab === 'movements'
      ? `/stock/movements${locationId ? `?locationId=${locationId}` : ''}`
      : null,
  );
  const reorder = useApi<ReorderProposalDto>(['stock', 'reorder'], readable ? '/stock/reorder' : null);

  if (!readable) return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const locs = locations.data?.items ?? [];
  const value = locs.reduce((s, l) => s + l.value, 0);
  const low = locs.reduce((s, l) => s + l.lowCount, 0);
  const reorderCount = (reorder.data?.groups ?? []).reduce((s, g) => s + g.lines.length, 0);
  const go = (patch: { onglet?: Tab; emplacement?: string | null }) => {
    const p = new URLSearchParams(search.toString());
    if (patch.onglet !== undefined) {
      const v = TAB_PARAM[patch.onglet];
      if (v) p.set('onglet', v);
      else p.delete('onglet');
    }
    if (patch.emplacement !== undefined) {
      if (patch.emplacement) p.set('emplacement', patch.emplacement);
      else p.delete('emplacement');
    }
    const qs = p.toString();
    router.replace(qs ? `/stock?${qs}` : '/stock');
  };
  const current = tab === 'items' ? items : tab === 'movements' ? movements : reorder;
  const failed = locations.error ?? current.error;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title={t('title')}
        description={locations.data ? t('summary', { value: formatEuros(BigInt(value)), low }) : undefined}
        actions={
          writable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<Plus aria-hidden className="size-4" />}
                onClick={() => setAddingLocation(true)}
              >
                {t('newLocation')}
              </Button>
              {locs.length ? (
                <Button
                  icon={<ArrowLeftRight aria-hidden className="size-4" />}
                  onClick={() => setMoving({})}
                >
                  {t('newMovement')}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      {failed ? (
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(failed)}
          action={
            <Button
              onClick={() => {
                void locations.refetch();
                void current.refetch();
              }}
            >
              {tc('retry')}
            </Button>
          }
        />
      ) : locations.isLoading ? (
        <Skeleton className="h-72" />
      ) : locs.length === 0 ? (
        <EmptyState
          icon={<Warehouse aria-hidden className="size-5" />}
          title={t('noLocationsTitle')}
          description={t('noLocations')}
          action={
            writable ? <Button onClick={() => setAddingLocation(true)}>{t('newLocation')}</Button> : null
          }
        />
      ) : (
        <>
          <nav aria-label={t('locations.label')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className="flex min-w-max gap-2.5">
              <li>
                <LocationCard
                  current={!locationId}
                  onClick={() => go({ emplacement: null })}
                  icon={<Boxes aria-hidden className="size-4" />}
                  title={t('locations.all')}
                  lines={[formatEuros(BigInt(value))]}
                  low={low ? t('locations.low', { n: low }) : null}
                />
              </li>
              {locs.map((l) => (
                <li key={l.id}>
                  <LocationCard
                    current={locationId === l.id}
                    onClick={() => go({ emplacement: l.id })}
                    icon={
                      l.kind === 'van' ? (
                        <Truck aria-hidden className="size-4" />
                      ) : (
                        <Warehouse aria-hidden className="size-4" />
                      )
                    }
                    title={l.name}
                    lines={[
                      `${t('locations.items', { n: l.itemCount })} · ${formatEuros(BigInt(l.value))}`,
                      ...(l.employee ? [t('locations.driver', { name: l.employee.name })] : []),
                    ]}
                    low={l.lowCount ? t('locations.low', { n: l.lowCount }) : null}
                  />
                </li>
              ))}
            </ul>
          </nav>
          <Segmented
            label={t('tabs.label')}
            value={tab}
            onChange={(v) => go({ onglet: v })}
            options={[
              { value: 'items', label: t('tabs.items') },
              { value: 'movements', label: t('tabs.movements') },
              { value: 'reorder', label: t('tabs.reorder'), count: reorderCount || undefined },
            ]}
          />
          {current.isLoading ? (
            <Skeleton className="h-72" />
          ) : tab === 'items' ? (
            <ItemsTable
              items={items.data?.items ?? []}
              locations={locs}
              locationId={locationId}
              writable={writable}
              onMove={(kind, itemId) => setMoving({ kind, itemId })}
              onThreshold={setThreshold}
              onEmpty={() => setMoving({ kind: 'in' })}
            />
          ) : tab === 'movements' ? (
            <MovementsTable items={movements.data?.items ?? []} />
          ) : (
            <ReorderPanel proposal={reorder.data ?? { groups: [] }} writable={can('purchases.write')} />
          )}
        </>
      )}
      {moving ? (
        <MovementDialog
          locations={locs}
          initial={{ ...moving, ...(locationId ? { locationId } : {}) }}
          onClose={() => setMoving(null)}
        />
      ) : null}
      {addingLocation ? <LocationDialog onClose={() => setAddingLocation(false)} /> : null}
      {threshold ? (
        <ThresholdDialog
          item={threshold}
          locations={locs}
          locationId={locationId ?? threshold.levels[0]?.locationId ?? locs[0]!.id}
          onClose={() => setThreshold(null)}
        />
      ) : null}
    </div>
  );
}

function LocationCard({
  current,
  onClick,
  icon,
  title,
  lines,
  low,
}: {
  current: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  lines: string[];
  low: string | null;
}) {
  return (
    <button
      type="button"
      aria-pressed={current}
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-[220px] flex-col items-start gap-1 rounded-[14px] border px-4 py-3 text-left transition-colors duration-[120ms]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        current ? 'border-ink bg-surface' : 'border-line bg-surface hover:border-ink/40',
      )}
    >
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        {icon}
        {title}
      </span>
      {lines.map((l) => (
        <span key={l} className="text-[13px] text-muted tabular-nums">
          {l}
        </span>
      ))}
      {low ? (
        <Chip tone="warn" dot>
          {low}
        </Chip>
      ) : null}
    </button>
  );
}

function ItemsTable({
  items,
  locations,
  locationId,
  writable,
  onMove,
  onThreshold,
  onEmpty,
}: {
  items: StockItemDto[];
  locations: StockLocationDto[];
  locationId: string | null;
  writable: boolean;
  onMove: (kind: MovementKind, itemId: string) => void;
  onThreshold: (item: StockItemDto) => void;
  onEmpty: () => void;
}) {
  const t = useTranslations('stock');
  const tk = useTranslations('stock.kinds');
  const names = new Map(locations.map((l) => [l.id, l.name]));
  if (!items.length)
    return (
      <EmptyState
        icon={<PackagePlus aria-hidden className="size-5" />}
        title={t('emptyTitle')}
        description={t('empty')}
        action={writable ? <Button onClick={onEmpty}>{tk('in')}</Button> : null}
      />
    );
  return (
    <Table label={t('tabs.items')}>
      <thead>
        <tr>
          <Th>{t('columns.item')}</Th>
          <Th align="right">{t('columns.quantity')}</Th>
          <Th align="right" className="hidden md:table-cell">
            {t('columns.averageCost')}
          </Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('columns.value')}
          </Th>
          <Th className="hidden lg:table-cell">{t('columns.threshold')}</Th>
          {writable ? <Th align="right">{/* actions */}</Th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((i) => {
          const levels = locationId ? i.levels.filter((l) => l.locationId === locationId) : i.levels;
          const below = levels.some((l) => l.below);
          const qty = locationId ? (levels[0]?.quantity ?? '0') : i.quantity;
          const thresholds = levels.filter((l) => l.minQuantity !== null);
          return (
            <tr key={i.item.id} className="hover:bg-line-soft/40">
              <Td>
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{i.item.name}</span>
                  <span className="font-mono text-[12px] text-muted">{i.item.code}</span>
                  {below ? (
                    <Chip tone="warn" dot className="mt-1 self-start">
                      {t('below')}
                    </Chip>
                  ) : null}
                </span>
              </Td>
              <Td align="right" className="tabular-nums">
                <span className="font-semibold">
                  {formatQuantity(qty)} {i.item.unit}
                </span>
                {!locationId && i.levels.length > 1 ? (
                  <span className="block text-[12px] text-muted">
                    {i.levels
                      .map((l) =>
                        t('breakdown', {
                          location: names.get(l.locationId) ?? '—',
                          quantity: formatQuantity(l.quantity),
                        }),
                      )
                      .join(' · ')}
                  </span>
                ) : null}
              </Td>
              <Td align="right" className="hidden tabular-nums md:table-cell">
                {formatEuros(BigInt(i.averageCost))}
              </Td>
              <Td align="right" className="hidden tabular-nums sm:table-cell">
                {formatEuros(locationId ? multiplyCents(BigInt(i.averageCost), qty) : BigInt(i.value))}
              </Td>
              <Td className="hidden lg:table-cell">
                {thresholds.length
                  ? thresholds
                      .map((l) =>
                        locationId
                          ? `${formatQuantity(l.minQuantity!)} ${i.item.unit}`
                          : `${names.get(l.locationId) ?? '—'} : ${formatQuantity(l.minQuantity!)}`,
                      )
                      .join(' · ')
                  : t('noThreshold')}
              </Td>
              {writable ? (
                <Td align="right">
                  <span className="flex justify-end gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => onMove('out', i.item.id)}>
                      {tk('out')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('setThreshold', { item: i.item.name })}
                      onClick={() => onThreshold(i)}
                    >
                      {t('columns.threshold')}
                    </Button>
                  </span>
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function MovementsTable({ items }: { items: StockMovementDto[] }) {
  const t = useTranslations('stock');
  const tk = useTranslations('stock.kinds');
  if (!items.length)
    return (
      <EmptyState
        icon={<ArrowLeftRight aria-hidden className="size-5" />}
        title={t('movementsEmptyTitle')}
        description={t('movementsEmpty')}
      />
    );
  return (
    <Table label={t('tabs.movements')}>
      <thead>
        <tr>
          <Th>{t('columns.date')}</Th>
          <Th>{t('columns.kind')}</Th>
          <Th>{t('columns.item')}</Th>
          <Th align="right">{t('columns.quantity')}</Th>
          <Th className="hidden md:table-cell">{t('columns.location')}</Th>
          <Th className="hidden sm:table-cell">{t('columns.project')}</Th>
          <Th align="right" className="hidden sm:table-cell">
            {t('columns.cost')}
          </Th>
        </tr>
      </thead>
      <tbody>
        {items.map((m) => (
          <tr key={m.id}>
            <Td className="whitespace-nowrap text-[13px] text-muted">
              {dateTime(m.occurredAt)}
              {m.by ? <span className="block">{m.by}</span> : null}
            </Td>
            <Td>
              <Chip tone={KIND_TONE[m.kind]}>{tk(m.kind)}</Chip>
            </Td>
            <Td>
              <span className="font-medium">{m.item.name}</span>
              {m.note ? <span className="block text-[12px] text-muted">{m.note}</span> : null}
            </Td>
            <Td align="right" className="tabular-nums">
              {formatQuantity(m.quantity)} {m.item.unit}
            </Td>
            <Td className="hidden md:table-cell">
              {m.location.name}
              {m.toLocation ? ` → ${m.toLocation.name}` : ''}
            </Td>
            <Td className="hidden sm:table-cell">
              {m.project ? (
                <Link href={`/chantiers/${m.project.id}`} className="hover:underline">
                  {m.project.number} · {m.project.name}
                </Link>
              ) : (
                '—'
              )}
            </Td>
            <Td align="right" className="hidden tabular-nums sm:table-cell">
              {formatEuros(BigInt(m.totalCost))}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ReorderPanel({ proposal, writable }: { proposal: ReorderProposalDto; writable: boolean }) {
  const t = useTranslations('stock');
  const tr = useTranslations('stock.reorder');
  const router = useRouter();
  const [ids] = useState(() => new Map<string, string>());
  const prepare = useApiMutation<ReorderProposalDto['groups'][number], { purchaseOrderId: string }>(
    (g) => {
      const key = `${g.supplier?.id}:${g.location.id}`;
      if (!ids.has(key)) ids.set(key, uuidv7());
      return {
        path: '/stock/reorder',
        method: 'POST',
        body: {
          id: ids.get(key),
          supplierId: g.supplier!.id,
          locationId: g.location.id,
          lines: g.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice })),
        },
      };
    },
    {
      invalidate: STOCK_INVALIDATE,
      successMessage: tr('prepared'),
      onSuccess: (r) => router.push(`/achats/commandes?bc=${r.purchaseOrderId}`),
    },
  );
  if (!proposal.groups.length)
    return (
      <EmptyState
        icon={<Boxes aria-hidden className="size-5" />}
        title={t('reorderEmptyTitle')}
        description={t('reorderEmpty')}
      />
    );
  return (
    <ul className="grid gap-4 lg:grid-cols-2">
      {proposal.groups.map((g) => (
        <li key={`${g.supplier?.id}:${g.location.id}`}>
          <Card className="flex flex-col gap-3 p-5" data-testid="reorder-group">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[16px] font-semibold">{g.supplier?.name ?? tr('noSupplier')}</h2>
              <span className="text-[13px] text-muted">{tr('for', { location: g.location.name })}</span>
            </div>
            <ul className="flex flex-col divide-y divide-line-soft">
              {g.lines.map((l) => (
                <li key={l.itemId} className="flex items-start justify-between gap-3 py-2">
                  <span className="flex flex-col">
                    <span className="font-medium">{l.name}</span>
                    <span className="text-[12px] text-muted">
                      {tr('stock', { quantity: formatQuantity(l.stock), min: formatQuantity(l.minQuantity) })}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatQuantity(l.quantity)} {l.unit}
                    <span className="block text-[12px] text-muted">{formatEuros(BigInt(l.unitPrice))}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
              <span className="font-semibold tabular-nums">{formatEuros(BigInt(g.total))}</span>
              {g.supplier && writable ? (
                <Button
                  loading={prepare.isPending && prepare.variables === g}
                  onClick={() => prepare.mutate(g)}
                >
                  {tr('prepare')}
                </Button>
              ) : null}
            </div>
            {!g.supplier ? <Notice tone="warn">{tr('noSupplierHint')}</Notice> : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
