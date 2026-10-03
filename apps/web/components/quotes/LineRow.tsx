'use client';

import { type Dec, formatEuros, formatPercent, VAT_REGIME_LIST, type VatRegime } from '@batimint/domain';
import { cn } from '@batimint/ui';
import { ArrowDown, ArrowUp, AlertTriangle, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { CellInput, CellTextarea, MoneyCell } from './cells';
import { type EditLine, toDecimal } from './quote-state';

export const LINE_GRID =
  'grid grid-cols-[minmax(0,1fr)_84px_92px] items-start gap-1 md:grid-cols-[minmax(0,1fr)_64px_52px_88px_50px_74px_100px_64px]';

/** Régimes proposés dans l'éditeur (les autres restent possibles par API). */
export const EDITOR_VAT_REGIMES: VatRegime[] = [
  'reduced_6',
  'intermediate_12',
  'standard_21',
  'reverse_charge',
  'zero',
  'intra_community',
].filter((r) => (VAT_REGIME_LIST as string[]).includes(r)) as VatRegime[];

export function LineHeader({ showCosts }: { showCosts: boolean }) {
  const t = useTranslations('quotes.line');
  return (
    <div
      aria-hidden
      className={cn(
        LINE_GRID,
        'hidden px-1 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase md:grid',
      )}
    >
      <span className="px-2">{t('description')}</span>
      <span className="px-2 text-right">{t('quantity')}</span>
      <span className="px-2">{t('unit')}</span>
      <span className="px-2 text-right">{t('unitPrice')}</span>
      <span className="px-2 text-right">{t('discount')}</span>
      <span className="px-2">{t('vat')}</span>
      <span className="px-2 text-right">{showCosts ? t('totalMargin') : t('total')}</span>
      <span />
    </div>
  );
}

export function LineRow({
  line,
  index,
  count,
  netAmount,
  marginRate,
  readOnly,
  showCosts,
  onChange,
  onVatChange,
  onRemove,
  onMove,
}: {
  line: EditLine;
  index: number;
  count: number;
  netAmount: bigint | undefined;
  marginRate: Dec | null | undefined;
  readOnly: boolean;
  showCosts: boolean;
  onChange: (patch: Partial<EditLine>) => void;
  onVatChange: (regime: VatRegime) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const t = useTranslations('quotes.line');
  const tv = useTranslations('quotes.vat');
  const n = index + 1;
  const desc = line.description.split('\n')[0] || t('untitled');
  const actions = !readOnly ? (
    <div className="col-span-3 flex justify-end gap-0 md:col-span-1 md:pt-1.5">
      <IconButton label={t('moveUp', { n })} disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUp aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton label={t('moveDown', { n })} disabled={index === count - 1} onClick={() => onMove(1)}>
        <ArrowDown aria-hidden className="size-3.5" />
      </IconButton>
      <IconButton label={t('remove', { name: desc })} onClick={onRemove} danger>
        <X aria-hidden className="size-4" />
      </IconButton>
    </div>
  ) : null;

  if (line.kind === 'text') {
    return (
      <div className={cn(LINE_GRID, 'rounded-[10px] px-1 py-1 hover:bg-line-soft/50')} data-line={line.key}>
        <CellTextarea
          label={t('textLine', { n })}
          value={line.description}
          placeholder={t('textPlaceholder')}
          disabled={readOnly}
          onChange={(e) => onChange({ description: e.target.value })}
          className="col-span-3 text-muted italic md:col-span-7"
        />
        {actions}
      </div>
    );
  }

  const overridden = line.vatRegime !== line.vatSuggested;
  const qtyInvalid = toDecimal(line.quantity) === null;
  return (
    <div className={cn(LINE_GRID, 'rounded-[10px] px-1 py-1 hover:bg-line-soft/50')} data-line={line.key}>
      <div className="col-span-3 md:col-span-1">
        <CellTextarea
          label={t('descriptionOf', { n })}
          value={line.description}
          placeholder={t('descriptionPlaceholder')}
          disabled={readOnly}
          onChange={(e) => onChange({ description: e.target.value })}
          className="font-medium"
        />
        {line.code ? <span className="block px-2 text-[11px] text-muted">{line.code}</span> : null}
      </div>
      <CellInput
        label={t('quantityOf', { name: desc })}
        value={line.quantity}
        inputMode="decimal"
        invalid={qtyInvalid}
        disabled={readOnly}
        onChange={(e) => onChange({ quantity: e.target.value.replace(/[^\d.,]/g, '') })}
        className="text-right tabular-nums"
      />
      <CellInput
        label={t('unitOf', { name: desc })}
        value={line.unit}
        maxLength={12}
        disabled={readOnly}
        onChange={(e) => onChange({ unit: e.target.value })}
      />
      <MoneyCell
        label={t('unitPriceOf', { name: desc })}
        cents={line.unitPrice}
        disabled={readOnly}
        onChange={(unitPrice) => onChange({ unitPrice })}
      />
      <CellInput
        label={t('discountOf', { name: desc })}
        value={line.discountPercent}
        inputMode="decimal"
        placeholder="0"
        disabled={readOnly}
        onChange={(e) => onChange({ discountPercent: e.target.value.replace(/[^\d.,]/g, '') })}
        className="text-right tabular-nums"
      />
      <div className="relative">
        <select
          aria-label={t('vatOf', { name: desc })}
          value={line.vatRegime}
          disabled={readOnly}
          onChange={(e) => onVatChange(e.target.value as VatRegime)}
          className={cn(
            'h-10 w-full rounded-[8px] border border-transparent bg-transparent px-1.5 text-[13px] hover:border-line focus-visible:border-accent focus-visible:outline-none',
            overridden && 'font-semibold text-warn',
          )}
          title={overridden ? (line.vatJustification ?? '') : undefined}
        >
          {[...new Set([line.vatRegime, ...EDITOR_VAT_REGIMES])].map((r) => (
            <option key={r} value={r}>
              {tv(`short.${r}`)}
            </option>
          ))}
        </select>
        {overridden ? (
          <AlertTriangle
            aria-label={t('vatOverridden')}
            className="pointer-events-none absolute top-1 right-0 size-3 text-warn"
          />
        ) : null}
      </div>
      <div className="flex h-10 flex-col items-end justify-center px-2 text-right">
        <span className="text-[14px] font-semibold tabular-nums">
          {netAmount !== undefined ? formatEuros(netAmount) : '—'}
        </span>
        {showCosts && marginRate ? (
          <span
            className={cn('text-[11px] tabular-nums', marginRate.isNegative() ? 'text-crit' : 'text-muted')}
          >
            {formatPercent(marginRate)}
          </span>
        ) : null}
      </div>
      {actions}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30 md:size-7',
        danger ? 'hover:text-crit' : 'hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}
