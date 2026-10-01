'use client';

import type { ItemDto, TenantSettings } from '@batimint/contracts';
import {
  type Cents,
  computeSalePrice,
  formatEuros,
  formatPercent,
  ITEM_KINDS,
  marginRate,
  multiplyCents,
  UNITS,
} from '@batimint/domain';
import {
  Button,
  Drawer,
  Notice,
  Overline,
  SelectField,
  Skeleton,
  Switch,
  TextAreaField,
  TextField,
  useToast,
} from '@batimint/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { TRADES } from '@/components/crm/OpportunityDialog';
import { SearchInput } from '@/components/SearchInput';
import { api } from '@/lib/api';
import { useApi, useApiMutation } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useDebounced } from '@/lib/use-debounced';
import { useErrorMessage } from '@/lib/use-error-message';
import { useRelativeTime } from '@/lib/use-relative-time';

interface PriceHistory {
  purchasePrice: number;
  salePrice: number | null;
  source: string;
  changedAt: string;
}

interface Component {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  quantity: string;
  unitCost?: number;
}

const VAT_CHOICES = ['auto', 'standard_21', 'intermediate_12', 'reduced_6', 'zero'] as const;
const decimalOk = (s: string) => /^\d+([.,]\d+)?$/.test(s.trim());
const toDecimal = (s: string) => s.trim().replace(',', '.');

export function ItemDrawer({
  id,
  newKind,
  onClose,
  onCreated,
}: {
  id: string | null;
  newKind: 'material' | 'assembly';
  onClose: () => void;
  onCreated: (item: ItemDto) => void;
}) {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const detail = useApi<{ item: ItemDto; history: PriceHistory[] }>(
    ['items', 'detail', id],
    id ? `/items/${id}` : null,
  );
  if (id && !detail.data)
    return (
      <Drawer open onClose={onClose} title={t('edit')} closeLabel={tc('close')}>
        {detail.error ? (
          <Notice tone="crit">{String(detail.error.message)}</Notice>
        ) : (
          <Skeleton className="h-96" />
        )}
      </Drawer>
    );
  return (
    <ItemForm
      key={detail.data?.item.updatedAt ?? 'new'}
      item={detail.data?.item ?? null}
      history={detail.data?.history ?? []}
      newKind={newKind}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

function ItemForm({
  item,
  history,
  newKind,
  onClose,
  onCreated,
}: {
  item: ItemDto | null;
  history: PriceHistory[];
  newKind: 'material' | 'assembly';
  onClose: () => void;
  onCreated: (item: ItemDto) => void;
}) {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const errorMessage = useErrorMessage();
  const relative = useRelativeTime();
  const canWrite = can('library.write');
  const showPrices = can('pricing.read');
  const settings = useApi<TenantSettings>(['settings'], can('company.read') ? '/company/settings' : null);
  const isAssembly = (item?.kind ?? newKind) === 'assembly';
  const [v, setV] = useState({
    code: item?.code ?? '',
    name: item?.name ?? '',
    kind: item?.kind ?? newKind,
    unit: item?.unit ?? (isAssembly ? 'm²' : 'u'),
    description: item?.description ?? '',
    trade: item?.trade ?? '',
    category: item?.category ?? '',
    purchasePrice: item?.purchasePrice ?? 0,
    forceSale: item?.salePrice !== null && item?.salePrice !== undefined,
    salePrice: item?.salePrice ?? item?.effectiveSalePrice ?? 0,
    coefficient: item?.saleCoefficient ?? '',
    laborHours: item?.laborHours && item.laborHours !== '0' ? item.laborHours.replace('.', ',') : '',
    vatRate: item?.vatRate ?? 'auto',
  });
  const [components, setComponents] = useState<Component[]>(
    (item?.components ?? []).map((c) => ({ ...c, quantity: c.quantity.replace('.', ',') })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const cost: Cents = isAssembly
    ? components.reduce(
        (sum, c) =>
          sum + (decimalOk(c.quantity) ? multiplyCents(BigInt(c.unitCost ?? 0), toDecimal(c.quantity)) : 0n),
        0n,
      )
    : BigInt(v.purchasePrice);
  const coefOk = !v.coefficient || decimalOk(v.coefficient);
  const sale = computeSalePrice({
    cost,
    salePrice: v.forceSale ? BigInt(v.salePrice) : null,
    itemCoefficient: v.coefficient && coefOk ? toDecimal(v.coefficient) : null,
    overheadCoefficient: settings.data?.overheadCoefficient ?? '1',
    marginCoefficient: settings.data?.marginCoefficient ?? '1',
  });
  const rate = marginRate(sale, cost);

  const save = useApiMutation<Record<string, unknown>, ItemDto>(
    (body) => (item ? { path: `/items/${item.id}`, method: 'PUT', body } : { path: '/items', body }),
    {
      invalidate: [['items']],
      successMessage: t('saved'),
      silentError: true,
      onSuccess: (saved) => (item ? onClose() : onCreated(saved)),
    },
  );

  const archive = async () => {
    if (!item) return;
    try {
      await api(`/items/${item.id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
      onClose();
      toast.show({
        title: t('archived'),
        tone: 'neutral',
        action: {
          label: tc('undo'),
          onClick: () =>
            void api(`/items/${item.id}/restore`, { body: {} }).then(() =>
              queryClient.invalidateQueries({ queryKey: ['items'] }),
            ),
        },
      });
    } catch (err) {
      toast.show({ title: tc('errorTitle'), description: errorMessage(err), tone: 'crit' });
    }
  };
  const restore = useApiMutation<void>(() => ({ path: `/items/${item?.id}/restore`, body: {} }), {
    invalidate: [['items']],
    successMessage: t('restored'),
    onSuccess: onClose,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!v.code.trim()) errs['code'] = t('codeRequired');
    if (v.name.trim().length < 2) errs['name'] = t('nameRequired');
    if (!coefOk) errs['coefficient'] = t('decimalInvalid');
    if (v.laborHours && !decimalOk(v.laborHours)) errs['laborHours'] = t('decimalInvalid');
    if (isAssembly && components.some((c) => !decimalOk(c.quantity)))
      errs['components'] = t('quantityInvalid');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      code: v.code.trim(),
      kind: v.kind,
      name: v.name.trim(),
      description: v.description.trim() || null,
      unit: v.unit,
      ...(showPrices
        ? {
            ...(isAssembly ? {} : { purchasePrice: v.purchasePrice }),
            salePrice: v.forceSale ? v.salePrice : null,
            saleCoefficient: v.coefficient ? toDecimal(v.coefficient) : null,
          }
        : {}),
      vatRate: v.vatRate,
      ...(isAssembly ? {} : { laborHours: v.laborHours ? toDecimal(v.laborHours) : '0' }),
      trade: v.trade || null,
      category: v.category.trim() || null,
      ...(isAssembly
        ? { components: components.map((c) => ({ itemId: c.itemId, quantity: toDecimal(c.quantity) })) }
        : {}),
    });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={item ? item.name : isAssembly ? t('newAssembly') : t('new')}
      description={item ? `${item.code} · ${t(`kind.${item.kind}`)}` : undefined}
      closeLabel={tc('close')}
      className="w-[min(100vw,560px)]"
      footer={
        canWrite ? (
          <>
            {item && !item.archived ? (
              <Button variant="ghost" className="mr-auto" onClick={() => void archive()}>
                {t('archive')}
              </Button>
            ) : null}
            {item?.archived ? (
              <Button
                variant="ghost"
                className="mr-auto"
                loading={restore.isPending}
                onClick={() => restore.mutate()}
              >
                {t('restore')}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button type="submit" form="item-form" loading={save.isPending}>
              {tc('save')}
            </Button>
          </>
        ) : undefined
      }
    >
      <form id="item-form" noValidate onSubmit={submit} className="flex flex-col gap-5">
        {save.error ? <Notice tone="crit">{errorMessage(save.error)}</Notice> : null}
        <fieldset disabled={!canWrite} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <TextField
              label={t('code')}
              value={v.code}
              onChange={(e) => setV({ ...v, code: e.target.value })}
              error={errors['code']}
              required
              autoFocus={!item}
              className="font-mono"
            />
            <TextField
              label={t('name')}
              value={v.name}
              onChange={(e) => setV({ ...v, name: e.target.value })}
              error={errors['name']}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {!isAssembly ? (
              <SelectField
                label={t('kindLabel')}
                value={v.kind}
                onChange={(e) => setV({ ...v, kind: e.target.value as typeof v.kind })}
                options={ITEM_KINDS.filter((k) => k !== 'assembly').map((k) => ({
                  value: k,
                  label: t(`kind.${k}`),
                }))}
              />
            ) : null}
            <SelectField
              label={t('unit')}
              value={v.unit}
              onChange={(e) => setV({ ...v, unit: e.target.value })}
              options={[...new Set([v.unit, ...UNITS])].map((u) => ({ value: u, label: u }))}
            />
            <SelectField
              label={t('trade')}
              value={v.trade}
              onChange={(e) => setV({ ...v, trade: e.target.value })}
              options={[
                { value: '', label: tc('none') },
                ...TRADES.map((x) => ({ value: x, label: t(`trades.${x}`) })),
              ]}
            />
            <TextField
              label={t('category')}
              value={v.category}
              onChange={(e) => setV({ ...v, category: e.target.value })}
            />
          </div>
          <TextAreaField
            label={t('description')}
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
            optionalLabel={tc('optional')}
            className="min-h-20"
          />
        </fieldset>

        {isAssembly ? (
          <ComponentsEditor
            excludeId={item?.id}
            components={components}
            onChange={setComponents}
            showPrices={showPrices}
            disabled={!canWrite}
            error={errors['components']}
          />
        ) : null}

        {showPrices ? (
          <fieldset
            disabled={!canWrite}
            className="flex flex-col gap-4 rounded-[16px] border border-line p-4"
          >
            <legend className="px-1 text-[13px] font-semibold">{t('pricing')}</legend>
            {isAssembly ? (
              <div>
                <Overline>{t('purchasePrice')}</Overline>
                <p className="mt-1 text-[20px] font-semibold tabular-nums">{formatEuros(cost)}</p>
                <p className="text-[13px] text-muted">{t('costFromComponents')}</p>
              </div>
            ) : (
              <MoneyInput
                label={`${t('purchasePrice')} / ${v.unit}`}
                cents={v.purchasePrice}
                onChange={(purchasePrice) => setV((p) => ({ ...p, purchasePrice }))}
              />
            )}
            <Switch
              label={t('forceSalePrice')}
              description={
                v.forceSale
                  ? undefined
                  : t('saleAutoHint', { coefficient: coefLabel(v.coefficient, settings.data) })
              }
              checked={v.forceSale}
              onChange={(forceSale) =>
                setV({ ...v, forceSale, salePrice: forceSale ? Number(sale) : v.salePrice })
              }
            />
            {v.forceSale ? (
              <MoneyInput
                label={`${t('salePrice')} / ${v.unit}`}
                cents={v.salePrice}
                onChange={(salePrice) => setV((p) => ({ ...p, salePrice }))}
              />
            ) : (
              <TextField
                label={t('coefficient')}
                value={v.coefficient}
                onChange={(e) => setV({ ...v, coefficient: e.target.value.replace(/[^\d.,]/g, '') })}
                inputMode="decimal"
                placeholder={coefLabel('', settings.data)}
                hint={t('coefficientHint')}
                error={errors['coefficient']}
                optionalLabel={tc('optional')}
              />
            )}
            <div
              className="grid grid-cols-2 gap-3 rounded-[12px] bg-line-soft/60 p-3"
              aria-live="polite"
              data-testid="price-summary"
            >
              <div>
                <Overline>{t('salePrice')}</Overline>
                <p className="text-[20px] font-semibold tabular-nums">{formatEuros(sale)}</p>
              </div>
              <div>
                <Overline>{t('margin')}</Overline>
                <p
                  className={`text-[20px] font-semibold tabular-nums ${rate?.isNegative() ? 'text-crit' : ''}`}
                >
                  {rate ? formatPercent(rate) : '—'}
                </p>
                <p className="text-[12px] text-muted tabular-nums">{formatEuros(sale - cost)}</p>
              </div>
            </div>
            <p className="text-[12px] text-muted">{t('priceNote')}</p>
          </fieldset>
        ) : null}

        <fieldset disabled={!canWrite} className="grid gap-4 sm:grid-cols-2">
          {!isAssembly ? (
            <TextField
              label={t('laborHours')}
              value={v.laborHours}
              onChange={(e) => setV({ ...v, laborHours: e.target.value.replace(/[^\d.,]/g, '') })}
              inputMode="decimal"
              placeholder="0"
              error={errors['laborHours']}
            />
          ) : null}
          <SelectField
            label={t('vat')}
            value={v.vatRate}
            onChange={(e) => setV({ ...v, vatRate: e.target.value as typeof v.vatRate })}
            options={VAT_CHOICES.map((x) => ({ value: x, label: t(`vatRates.${x}`) }))}
          />
        </fieldset>

        {item ? (
          <section className="flex flex-col gap-2">
            <Overline as="h3">{t('history')}</Overline>
            {item.usedInCount ? (
              <p className="text-[13px] text-muted">{t('usedIn', { count: item.usedInCount })}</p>
            ) : null}
            {history.length === 0 ? (
              <p className="text-[13px] text-muted">{t('historyEmpty')}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line-soft text-[13px]">
                {history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{t(`sources.${h.source}`)}</span>
                      <span className="ml-2 text-muted">{relative(h.changedAt)}</span>
                    </span>
                    <span className="tabular-nums">
                      {formatEuros(BigInt(h.purchasePrice))}
                      {h.salePrice !== null ? (
                        <span className="ml-2 text-muted">→ {formatEuros(BigInt(h.salePrice))}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </form>
    </Drawer>
  );
}

function coefLabel(own: string, settings: TenantSettings | undefined): string {
  if (own) return own;
  if (!settings) return '—';
  const total = Number(settings.overheadCoefficient) * Number(settings.marginCoefficient);
  return `× ${total
    .toFixed(3)
    .replace(/\.?0+$/, '')
    .replace('.', ',')}`;
}

function ComponentsEditor({
  excludeId,
  components,
  onChange,
  showPrices,
  disabled,
  error,
}: {
  excludeId?: string;
  components: Component[];
  onChange: (c: Component[]) => void;
  showPrices: boolean;
  disabled: boolean;
  error?: string;
}) {
  const t = useTranslations('library');
  const tc = useTranslations('common');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 150);
  const results = useApi<{ items: ItemDto[] }>(
    ['items', 'component-search', query],
    query ? `/items?q=${encodeURIComponent(query)}&limit=8` : null,
  );
  const add = (i: ItemDto) => {
    if (components.some((c) => c.itemId === i.id)) return;
    onChange([
      ...components,
      { itemId: i.id, code: i.code, name: i.name, unit: i.unit, quantity: '1', unitCost: i.purchasePrice },
    ]);
    setQ('');
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="components-title">
      <h3 id="components-title" className="text-[13px] font-semibold">
        {t('components')}
      </h3>
      {components.length === 0 ? <p className="text-[13px] text-muted">{t('noComponents')}</p> : null}
      <ul className="flex flex-col gap-2">
        {components.map((c, i) => (
          <li
            key={c.itemId}
            className="grid grid-cols-[1fr_84px_auto] items-center gap-2 rounded-[12px] border border-line p-2"
          >
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-medium">{c.name}</span>
              <span className="block text-[12px] text-muted">
                {c.code}
                {showPrices && c.unitCost !== undefined
                  ? ` · ${formatEuros(BigInt(c.unitCost))} / ${c.unit}`
                  : ''}
              </span>
            </span>
            <input
              aria-label={`${t('quantity')} ${c.name} (${c.unit})`}
              value={c.quantity}
              inputMode="decimal"
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  components.map((x, j) =>
                    j === i ? { ...x, quantity: e.target.value.replace(/[^\d.,]/g, '') } : x,
                  ),
                )
              }
              className="h-10 w-full rounded-[10px] border border-line bg-surface px-2 text-right text-[14px] tabular-nums focus-visible:outline-2 focus-visible:outline-accent"
            />
            {!disabled ? (
              <button
                type="button"
                aria-label={`${tc('delete')} ${c.name}`}
                onClick={() => onChange(components.filter((_, j) => j !== i))}
                className="flex size-10 items-center justify-center rounded-[10px] text-muted hover:bg-line-soft hover:text-crit focus-visible:outline-2 focus-visible:outline-accent"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-[13px] text-crit">
          {error}
        </p>
      ) : null}
      {!disabled ? (
        <div className="flex flex-col gap-1">
          <SearchInput
            label={t('componentSearch')}
            placeholder={t('componentSearch')}
            value={q}
            onChange={setQ}
            clearLabel={tc('close')}
            loading={results.isFetching}
          />
          {query && results.data ? (
            <ul className="flex flex-col rounded-[12px] border border-line" aria-label={t('componentSearch')}>
              {results.data.items
                .filter((i) => i.id !== excludeId)
                .map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      onClick={() => add(i)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-line-soft px-3 py-2 text-left last:border-b-0 hover:bg-line-soft focus-visible:bg-line-soft focus-visible:outline-none"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[14px]">{i.name}</span>
                        <span className="block text-[12px] text-muted">
                          {i.code} · {i.unit}
                        </span>
                      </span>
                      <Plus aria-hidden className="size-4 shrink-0" />
                    </button>
                  </li>
                ))}
              {results.data.items.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-muted">{tc('noResults', { q: query })}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
