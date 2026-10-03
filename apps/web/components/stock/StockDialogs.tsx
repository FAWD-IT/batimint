'use client';

import type {
  EmployeeDto,
  ItemDto,
  ProjectDto,
  ProjectSummaryDto,
  StockItemDto,
  StockLocationDto,
  StockMovementDto,
} from '@batimint/contracts';
import { dec, formatEuros, formatQuantity, multiplyCents } from '@batimint/domain';
import { Button, Dialog, Segmented, SelectField, TextAreaField, TextField } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { MoneyInput } from '@/components/MoneyInput';
import { useApi, useApiMutation } from '@/lib/hooks';

export type MovementKind = 'in' | 'out' | 'transfer' | 'adjustment';
export const STOCK_INVALIDATE = [['stock'], ['project'], ['timeline'], ['purchase_orders']];

/** Quantité saisie (virgule ou point) → chaîne décimale, ou null si invalide. */
export function parseQuantity(text: string): string | null {
  const v = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(v)) return null;
  return v;
}

/**
 * Mouvement de stock au bureau (03 §11) : entrée au prix d'achat, sortie imputée au poste d'un
 * chantier, transfert entre emplacements, inventaire (quantité comptée).
 */
export function MovementDialog({
  locations,
  initial,
  onClose,
}: {
  locations: StockLocationDto[];
  initial?: { kind?: MovementKind; itemId?: string; locationId?: string };
  onClose: () => void;
}) {
  const t = useTranslations('stock.movement');
  const tk = useTranslations('stock.kinds');
  const tc = useTranslations('common');
  const [id] = useState(() => uuidv7());
  const [kind, setKind] = useState<MovementKind>(initial?.kind ?? 'in');
  const [itemId, setItemId] = useState(initial?.itemId ?? '');
  const [locationId, setLocationId] = useState(initial?.locationId ?? locations[0]?.id ?? '');
  const [toLocationId, setToLocationId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [projectId, setProjectId] = useState('');
  const [budgetLineId, setBudgetLineId] = useState('');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const library = useApi<{ items: ItemDto[] }>(
    ['stock', 'library-items'],
    kind === 'in' ? '/items?kind=material&limit=500' : null,
  );
  const stock = useApi<{ items: StockItemDto[] }>(['stock', 'items', 'all'], '/stock');
  const projects = useApi<{ items: ProjectSummaryDto[] }>(
    ['projects', 'list', 'active'],
    kind === 'out' ? '/projects?view=active' : null,
  );
  const project = useApi<ProjectDto>(['project', projectId], projectId ? `/projects/${projectId}` : null);

  const stocked = stock.data?.items ?? [];
  const here = (sid: string) =>
    stocked.find((s) => s.item.id === sid)?.levels.find((l) => l.locationId === locationId)?.quantity ?? '0';
  const itemOptions = useMemo(() => {
    if (kind === 'in') {
      const lib = library.data?.items ?? [];
      const known = new Map(lib.map((i) => [i.id, `${i.code} · ${i.name}`]));
      for (const s of stocked)
        if (!known.has(s.item.id)) known.set(s.item.id, `${s.item.code} · ${s.item.name}`);
      return [...known.entries()].map(([value, label]) => ({ value, label }));
    }
    return stocked
      .filter((s) => kind === 'adjustment' || dec(here(s.item.id)).gt(0))
      .map((s) => ({ value: s.item.id, label: `${s.item.code} · ${s.item.name}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, library.data, stocked, locationId]);
  const selected = stocked.find((s) => s.item.id === itemId);
  const libraryItem = library.data?.items.find((i) => i.id === itemId);
  const unit = selected?.item.unit ?? libraryItem?.unit ?? '';
  const qty = parseQuantity(quantity);
  const cost = unitCost ?? libraryItem?.purchasePrice ?? selected?.averageCost ?? 0;

  const errors = {
    item: !itemId ? t('errors.item') : null,
    location: !locationId ? t('errors.location') : null,
    quantity: !qty || (kind !== 'adjustment' && dec(qty).lte(0)) ? t('errors.quantity') : null,
    project: kind === 'out' && !projectId ? t('errors.project') : null,
    to: kind === 'transfer' && (!toLocationId || toLocationId === locationId) ? t('errors.to') : null,
  };
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);
  const save = useApiMutation<void, StockMovementDto>(
    () => ({
      path: '/stock/movements',
      method: 'POST',
      body: {
        id,
        kind,
        itemId,
        locationId,
        quantity: qty,
        ...(kind === 'in' ? { unitCost: cost } : {}),
        ...(kind === 'transfer' ? { toLocationId } : {}),
        ...(kind === 'out' ? { projectId, budgetLineId: budgetLineId || null } : {}),
        note: note.trim() || null,
      },
    }),
    { invalidate: STOCK_INVALIDATE, successMessage: t('saved'), onSuccess: onClose },
  );
  const submit = () => {
    setSubmitted(true);
    if (Object.values(errors).every((e) => !e)) save.mutate();
  };
  const locationOptions = locations.map((l) => ({ value: l.id, label: l.name }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label={t('kind')}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setItemId(initial?.itemId ?? '');
          }}
          options={(['in', 'out', 'transfer', 'adjustment'] as const).map((k) => ({
            value: k,
            label: tk(k),
          }))}
        />
        <SelectField
          label={kind === 'transfer' ? t('from') : t('location')}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          options={locationOptions}
          error={err('location')}
        />
        {kind === 'transfer' ? (
          <SelectField
            label={t('to')}
            value={toLocationId}
            onChange={(e) => setToLocationId(e.target.value)}
            options={[{ value: '', label: '—' }, ...locationOptions.filter((o) => o.value !== locationId)]}
            error={err('to')}
          />
        ) : null}
        <SelectField
          label={t('item')}
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            setUnitCost(null);
          }}
          options={[{ value: '', label: t('chooseItem') }, ...itemOptions]}
          error={err('item')}
          hint={
            itemId && kind !== 'in'
              ? t('available', { quantity: formatQuantity(here(itemId)), unit })
              : undefined
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={
              kind === 'adjustment'
                ? t('counted', { unit: unit || '—' })
                : t('quantity', { unit: unit || '—' })
            }
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={err('quantity')}
          />
          {kind === 'in' ? (
            <MoneyInput key={itemId} label={t('unitCost')} cents={cost} onChange={setUnitCost} />
          ) : null}
        </div>
        {kind === 'out' ? (
          <>
            <SelectField
              label={t('project')}
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setBudgetLineId('');
              }}
              options={[
                { value: '', label: t('chooseProject') },
                ...(projects.data?.items ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.number} · ${p.name}`,
                })),
              ]}
              error={err('project')}
            />
            {projectId ? (
              <SelectField
                label={t('post')}
                value={budgetLineId}
                onChange={(e) => setBudgetLineId(e.target.value)}
                options={[
                  { value: '', label: t('noPost') },
                  ...(project.data?.budgetLines ?? []).map((b) => ({ value: b.id, label: b.label })),
                ]}
              />
            ) : null}
            {selected && qty ? (
              <p className="text-[14px] text-muted" role="status">
                {t('costPreview', { amount: formatEuros(multiplyCents(BigInt(selected.averageCost), qty)) })}
              </p>
            ) : null}
          </>
        ) : null}
        <TextAreaField
          label={t('note')}
          rows={2}
          value={note}
          optionalLabel={tc('optional')}
          onChange={(e) => setNote(e.target.value)}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function LocationDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('stock.location');
  const tl = useTranslations('stock.locations');
  const tc = useTranslations('common');
  const [form, setForm] = useState({
    name: '',
    kind: 'depot' as 'depot' | 'van',
    address: '',
    employeeId: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const employees = useApi<{ items: EmployeeDto[] }>(['employees', 'list'], '/employees');
  const error = form.name.trim().length < 2 ? t('errors.name') : null;
  const save = useApiMutation<void, StockLocationDto>(
    () => ({
      path: '/stock/locations',
      method: 'POST',
      body: {
        name: form.name.trim(),
        kind: form.kind,
        address: form.address.trim() || null,
        employeeId: form.kind === 'van' ? form.employeeId || null : null,
      },
    }),
    { invalidate: [['stock']], successMessage: t('saved'), onSuccess: onClose },
  );
  const submit = () => {
    setSubmitted(true);
    if (!error) save.mutate();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('title')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Segmented
          label={t('kind')}
          value={form.kind}
          onChange={(kind) => setForm((f) => ({ ...f, kind }))}
          options={[
            { value: 'depot', label: tl('depot') },
            { value: 'van', label: tl('van') },
          ]}
        />
        <TextField
          label={t('name')}
          placeholder={t('namePlaceholder')}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          error={submitted ? error : null}
        />
        {form.kind === 'van' ? (
          <SelectField
            label={t('driver')}
            value={form.employeeId}
            onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
            options={[
              { value: '', label: t('noDriver') },
              ...(employees.data?.items ?? []).map((e) => ({
                value: e.id,
                label: `${e.firstName} ${e.lastName}`,
              })),
            ]}
          />
        ) : (
          <TextField
            label={t('address')}
            value={form.address}
            optionalLabel={tc('optional')}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

export function ThresholdDialog({
  item,
  locations,
  locationId: initialLocation,
  onClose,
}: {
  item: StockItemDto;
  locations: StockLocationDto[];
  locationId: string;
  onClose: () => void;
}) {
  const t = useTranslations('stock.threshold');
  const ts = useTranslations('stock');
  const tc = useTranslations('common');
  const [locationId, setLocationId] = useState(initialLocation);
  const level = item.levels.find((l) => l.locationId === locationId);
  const [min, setMin] = useState(level?.minQuantity ?? '');
  const [reorder, setReorder] = useState(level?.reorderQuantity ?? '');
  const minQ = min.trim() ? parseQuantity(min) : null;
  const reorderQ = reorder.trim() ? parseQuantity(reorder) : null;
  const save = useApiMutation<void>(
    () => ({
      path: '/stock/levels',
      method: 'PUT',
      body: { locationId, itemId: item.item.id, minQuantity: minQ, reorderQuantity: reorderQ },
    }),
    { invalidate: [['stock']], successMessage: t('saved'), onSuccess: onClose },
  );
  return (
    <Dialog
      open
      onClose={onClose}
      title={ts('setThreshold', { item: item.item.name })}
      description={t('description')}
      closeLabel={tc('close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <SelectField
          label={t('location')}
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            const l = item.levels.find((x) => x.locationId === e.target.value);
            setMin(l?.minQuantity ?? '');
            setReorder(l?.reorderQuantity ?? '');
          }}
          options={locations.map((l) => ({ value: l.id, label: l.name }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('min', { unit: item.item.unit })}
            inputMode="decimal"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <TextField
            label={t('reorder', { unit: item.item.unit })}
            inputMode="decimal"
            value={reorder}
            hint={t('reorderHint')}
            optionalLabel={tc('optional')}
            onChange={(e) => setReorder(e.target.value)}
          />
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
