'use client';

import type { QuoteDto } from '@batimint/contracts';
import { formatEuros, formatPercent, formatQuantity, type QuoteTotals } from '@batimint/domain';
import { Card, Chip, cn, Overline, Segmented, TextField } from '@batimint/ui';
import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MoneyCell } from './cells';
import type { EditDoc } from './quote-state';

/** Totaux en direct (P2.4) : HTVA, TVA par taux, TVAC, acompte ; revient, marge et heures. */
export function TotalsPanel({
  totals,
  doc,
  quote,
  showCosts,
  readOnly,
  onChange,
}: {
  totals: QuoteTotals;
  doc: EditDoc;
  quote: QuoteDto;
  showCosts: boolean;
  readOnly: boolean;
  onChange: (patch: Partial<EditDoc>) => void;
}) {
  const t = useTranslations('quotes.totals');
  const tv = useTranslations('quotes.vat');
  const d = totals.document;
  const s = quote.vatSuggestion;
  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label={t('title')} role="region">
      <dl className="flex flex-col gap-1.5 text-[14px]" aria-live="polite" data-testid="quote-totals">
        <Row label={t('net')} value={formatEuros(d.totalNet)} />
        {d.vatBreakdown.map((v) => (
          <Row
            key={`${v.category}-${v.ratePercent}`}
            label={
              v.category === 'AE'
                ? t('reverseCharge')
                : t('vatAt', { rate: v.ratePercent, base: formatEuros(v.taxableAmount) })
            }
            value={formatEuros(v.taxAmount)}
            muted
          />
        ))}
        <div className="mt-1 flex items-baseline justify-between rounded-[12px] bg-panel px-3 py-2.5 text-white">
          <dt className="text-[14px] font-semibold">{t('gross')}</dt>
          <dd className="text-[20px] font-bold tabular-nums" data-testid="quote-total-gross">
            {formatEuros(d.totalGross)}
          </dd>
        </div>
        {totals.depositAmount > 0n ? (
          <Row label={t('deposit')} value={formatEuros(totals.depositAmount)} />
        ) : null}
        {totals.optionsAvailable > 0n ? (
          <Row label={t('optionsAvailable')} value={`+ ${formatEuros(totals.optionsAvailable)}`} muted />
        ) : null}
      </dl>

      {showCosts ? (
        <div className="grid grid-cols-3 gap-2 rounded-[12px] border border-line p-3 text-center">
          <Stat label={t('cost')} value={formatEuros(totals.totalCost)} />
          <Stat
            label={t('margin')}
            value={totals.marginRate ? formatPercent(totals.marginRate) : '—'}
            tone={totals.marginRate?.isNegative() ? 'crit' : undefined}
            hint={formatEuros(totals.totalMargin)}
          />
          <Stat label={t('hours')} value={`${formatQuantity(totals.laborHours, 1)} h`} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-[12px] bg-line-soft/60 p-3">
        <p className="flex items-center gap-2 text-[13px] font-semibold">
          <Info aria-hidden className="size-4 shrink-0" />
          {t('vatProposed', { regime: tv(`long.${s.regime}`) })}
        </p>
        <p className="text-[13px] text-muted">{tv(`reason.${s.reason}`, { age: s.dwellingAgeYears ?? 0 })}</p>
        {s.requiresCertificate ? <Chip tone="warn">{t('certificateNeeded')}</Chip> : null}
      </div>

      <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
        <Overline>{t('settings')}</Overline>
        <TextField
          label={t('globalDiscount')}
          value={doc.globalDiscountPercent}
          inputMode="decimal"
          placeholder="0"
          disabled={readOnly}
          onChange={(e) => onChange({ globalDiscountPercent: e.target.value.replace(/[^\d.,]/g, '') })}
          trailing={<span className="pr-2 text-muted">%</span>}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">{t('depositLabel')}</span>
          <Segmented<'none' | 'percent' | 'amount'>
            label={t('depositLabel')}
            value={doc.deposit?.kind ?? 'none'}
            onChange={(k) =>
              !readOnly &&
              onChange({
                deposit:
                  k === 'none'
                    ? null
                    : k === 'percent'
                      ? { kind: 'percent', value: '30' }
                      : { kind: 'amount', value: 0 },
              })
            }
            options={[
              { value: 'none', label: t('depositNone') },
              { value: 'percent', label: '%' },
              { value: 'amount', label: '€' },
            ]}
          />
          {doc.deposit?.kind === 'percent' ? (
            <TextField
              label={t('depositPercent')}
              value={doc.deposit.value}
              inputMode="decimal"
              disabled={readOnly}
              onChange={(e) =>
                onChange({ deposit: { kind: 'percent', value: e.target.value.replace(/[^\d.,]/g, '') } })
              }
              trailing={<span className="pr-2 text-muted">%</span>}
            />
          ) : doc.deposit?.kind === 'amount' ? (
            <div className="rounded-[10px] border border-line">
              <MoneyCell
                label={t('depositAmount')}
                cents={doc.deposit.value}
                disabled={readOnly}
                onChange={(value) => onChange({ deposit: { kind: 'amount', value } })}
              />
            </div>
          ) : null}
        </div>
        <TextField
          label={t('validity')}
          value={String(doc.validityDays)}
          inputMode="numeric"
          disabled={readOnly}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
            onChange({ validityDays: Math.min(365, Math.max(1, n || 1)) });
          }}
          trailing={<span className="pr-2 text-[13px] text-muted">{t('days')}</span>}
        />
      </div>
    </Card>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', muted && 'text-muted')}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'crit' }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</p>
      <p className={cn('truncate text-[15px] font-semibold tabular-nums', tone === 'crit' && 'text-crit')}>
        {value}
      </p>
      {hint ? <p className="truncate text-[11px] text-muted tabular-nums">{hint}</p> : null}
    </div>
  );
}
