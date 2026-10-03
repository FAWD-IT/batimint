'use client';

import { type Dec, formatEuros, formatQuantity, type QuoteTotals, type VatRegime } from '@batimint/domain';
import { Button, Card, Chip, cn, Switch } from '@batimint/ui';
import { ArrowDown, ArrowUp, Plus, Trash2, Type } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { type LibraryLine, LibraryPicker } from './LibraryPicker';
import { LineHeader, LineRow } from './LineRow';
import { type EditLine, type EditSection, itemSuggestion, move, newLine } from './quote-state';

export function SectionCard({
  section,
  index,
  count,
  totals,
  readOnly,
  showCosts,
  quoteRegime,
  onChange,
  onRemove,
  onMove,
  onVatChange,
  onError,
}: {
  section: EditSection;
  index: number;
  count: number;
  totals: QuoteTotals;
  readOnly: boolean;
  showCosts: boolean;
  quoteRegime: VatRegime;
  onChange: (next: EditSection) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onVatChange: (lineKey: string, regime: VatRegime) => void;
  onError: (err: unknown) => void;
}) {
  const t = useTranslations('quotes.section');
  const st = totals.sections.find((s) => s.id === section.key);
  const lineTotals = new Map(totals.lines.map((l) => [l.id, l]));
  const name = section.title || t('untitled', { n: index + 1 });
  const setLine = (key: string, patch: Partial<EditLine>) =>
    onChange({ ...section, lines: section.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const addLibraryLines = (lines: LibraryLine[]) =>
    onChange({
      ...section,
      lines: [
        ...section.lines,
        ...lines.map((l) =>
          newLine(itemSuggestion(l.vatRate, quoteRegime), {
            itemId: l.itemId,
            code: l.code,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity.replace('.', ','),
            unitPrice: l.unitPrice,
            unitCost: l.unitCost ?? 0,
            laborHours: l.laborHours,
          }),
        ),
      ],
    });

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label={name} role="group">
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-2.5 text-[12px] font-semibold text-muted tabular-nums">{index + 1}.</span>
        <input
          aria-label={t('title', { n: index + 1 })}
          value={section.title}
          placeholder={t('titlePlaceholder')}
          disabled={readOnly}
          onChange={(e) => onChange({ ...section, title: e.target.value })}
          className="h-10 min-w-[12rem] flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-[17px] font-semibold hover:border-line focus-visible:border-accent focus-visible:outline-none"
        />
        <div className="ml-auto flex items-center gap-2">
          {section.optional ? <Chip tone="accent">{t('option')}</Chip> : null}
          {st ? (
            <span className={cn('text-[15px] font-semibold tabular-nums', !st.included && 'text-muted')}>
              {formatEuros(st.netAmount)}
            </span>
          ) : null}
          {!readOnly ? (
            <>
              <IconBtn label={t('moveUp', { name })} disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUp aria-hidden className="size-4" />
              </IconBtn>
              <IconBtn
                label={t('moveDown', { name })}
                disabled={index === count - 1}
                onClick={() => onMove(1)}
              >
                <ArrowDown aria-hidden className="size-4" />
              </IconBtn>
              <IconBtn label={t('remove', { name })} onClick={onRemove}>
                <Trash2 aria-hidden className="size-4" />
              </IconBtn>
            </>
          ) : null}
        </div>
      </div>

      {section.lines.length ? (
        <div className="flex flex-col">
          <LineHeader showCosts={showCosts} />
          <ol className="flex flex-col divide-y divide-line-soft">
            {section.lines.map((l, i) => {
              const lt = lineTotals.get(l.key);
              return (
                <li key={l.key}>
                  <LineRow
                    line={l}
                    index={i}
                    count={section.lines.length}
                    netAmount={lt?.netAmount}
                    marginRate={lt?.marginRate as Dec | null | undefined}
                    readOnly={readOnly}
                    showCosts={showCosts}
                    onChange={(patch) => setLine(l.key, patch)}
                    onVatChange={(regime) => onVatChange(l.key, regime)}
                    onRemove={() =>
                      onChange({ ...section, lines: section.lines.filter((x) => x.key !== l.key) })
                    }
                    onMove={(d) => onChange({ ...section, lines: move(section.lines, i, i + d) })}
                  />
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <p className="px-2 text-[14px] text-muted">{readOnly ? t('emptyReadOnly') : t('empty')}</p>
      )}

      {!readOnly ? (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3 sm:flex-row sm:items-center">
          <div className="flex-1">
            <LibraryPicker label={t('addFromLibrary')} onAdd={addLibraryLines} onError={onError} />
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus aria-hidden className="size-4" />}
              onClick={() => onChange({ ...section, lines: [...section.lines, newLine(quoteRegime)] })}
            >
              {t('freeLine')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Type aria-hidden className="size-4" />}
              onClick={() =>
                onChange({
                  ...section,
                  lines: [...section.lines, newLine(quoteRegime, { kind: 'text', quantity: '0' })],
                })
              }
            >
              {t('textLine')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
        <div className="min-w-60">
          <Switch
            label={t('optional')}
            description={t('optionalHint')}
            checked={section.optional}
            disabled={readOnly}
            onChange={(optional) =>
              onChange({ ...section, optional, selected: optional ? section.selected : false })
            }
          />
        </div>
        {st && showCosts ? (
          <p className="text-[12px] text-muted tabular-nums">
            {t('summary', {
              cost: formatEuros(st.cost),
              hours: formatQuantity(st.laborHours, 1),
            })}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-[8px] text-muted hover:bg-line-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30"
    >
      {children}
    </button>
  );
}
