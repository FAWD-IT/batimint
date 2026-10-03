'use client';

import { cn } from '@batimint/ui';
import { useId, useState } from 'react';

export interface ColumnSeries {
  key: string;
  label: string;
  /** Variable CSS de couleur (`var(--chart-1)`). */
  color: string;
}

export interface ColumnDatum {
  key: string;
  label: string;
  /** Libellé long pour le survol et le tableau. */
  title: string;
  /** Une valeur par série (centimes). */
  values: number[];
  /** Lignes supplémentaires du survol (déjà formatées). */
  extra?: { label: string; value: string }[];
  highlight?: boolean;
}

/** Graduation « propre » (1, 2, 5 × 10ⁿ) couvrant `max`. */
function niceStep(range: number, ticks = 4) {
  const raw = range / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Colonnes groupées (dataviz : barres ≤ 24 px, extrémité arrondie, ligne de base unique, grille
 * fine). Une colonne négative descend sous la ligne zéro. Chaque groupe est focusable et ouvre
 * une infobulle avec toutes les séries ; un tableau équivalent est toujours disponible.
 */
export function ColumnChart({
  series,
  data,
  format,
  formatAxis,
  label,
  tableLabel,
  firstColumnLabel,
  height = 200,
}: {
  series: ColumnSeries[];
  data: ColumnDatum[];
  format: (cents: number) => string;
  formatAxis: (cents: number) => string;
  label: string;
  tableLabel: string;
  firstColumnLabel: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const tooltipId = useId();
  const all = data.flatMap((d) => d.values);
  const maxV = Math.max(0, ...all);
  const minV = Math.min(0, ...all);
  const step = niceStep(maxV - minV || 100);
  const top = Math.ceil(maxV / step) * step || step;
  const bottom = Math.floor(minV / step) * step;
  const span = top - bottom;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  const y = (v: number) => ((top - v) / span) * height;
  const zero = y(0);
  const cur = active === null ? null : data[active];

  return (
    <figure className="flex flex-col gap-3" aria-label={label}>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-4 text-[13px] text-muted" aria-hidden>
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative flex gap-2">
        <div
          className="relative w-14 shrink-0 text-right text-[11px] text-muted tabular-nums"
          style={{ height }}
          aria-hidden
        >
          {ticks.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: y(v) }}>
              {formatAxis(v)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((v) => (
            <div
              key={v}
              aria-hidden
              className={cn('absolute inset-x-0 h-px', v === 0 ? 'bg-muted/50' : 'bg-line-soft')}
              style={{ top: y(v) }}
            />
          ))}
          <div className="absolute inset-0 flex">
            {data.map((d, i) => (
              <button
                key={d.key}
                type="button"
                aria-describedby={active === i ? tooltipId : undefined}
                aria-label={`${d.title} : ${series.map((s, k) => `${s.label} ${format(d.values[k] ?? 0)}`).join(', ')}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                className={cn(
                  'relative flex h-full flex-1 items-stretch justify-center gap-[2px] rounded-[6px] focus-visible:outline-2 focus-visible:outline-accent',
                  active === i && 'bg-line-soft/60',
                )}
              >
                {series.map((s, k) => {
                  const v = d.values[k] ?? 0;
                  const h = Math.abs(y(v) - zero);
                  return (
                    <span key={s.key} className="relative w-full max-w-6" aria-hidden>
                      <span
                        className={cn('absolute inset-x-0', v >= 0 ? 'rounded-t-[4px]' : 'rounded-b-[4px]')}
                        style={{
                          background: s.color,
                          top: v >= 0 ? zero - h : zero,
                          height: Math.max(h, v === 0 ? 0 : 2),
                          opacity: d.highlight === false ? 0.45 : 1,
                        }}
                      />
                    </span>
                  );
                })}
              </button>
            ))}
          </div>
          {cur ? (
            <div
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none absolute top-0 z-10 min-w-44 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] shadow-sm"
              style={{
                left: `${((active! + 0.5) / data.length) * 100}%`,
                transform: `translateX(${active! > data.length / 2 ? '-105%' : '5%'})`,
              }}
            >
              <p className="mb-1 text-muted">{cur.title}</p>
              {series.map((s, k) => (
                <p key={s.key} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="inline-block h-0.5 w-3 rounded" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-semibold tabular-nums">{format(cur.values[k] ?? 0)}</span>
                </p>
              ))}
              {cur.extra?.map((x) => (
                <p key={x.label} className="flex items-center justify-between gap-3">
                  <span className="text-muted">{x.label}</span>
                  <span className="tabular-nums">{x.value}</span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2 pl-16 text-[11px] text-muted" aria-hidden>
        {data.map((d, i) => (
          <span key={d.key} className="flex flex-1 justify-center overflow-visible whitespace-nowrap">
            {i % Math.max(1, Math.ceil(data.length / 6)) === 0 ? d.label : ''}
          </span>
        ))}
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">{tableLabel}</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{tableLabel}</caption>
            <thead>
              <tr className="text-muted">
                <th className="py-1 pr-3 font-medium">{firstColumnLabel}</th>
                {series.map((s) => (
                  <th key={s.key} className="py-1 pr-3 text-right font-medium">
                    {s.label}
                  </th>
                ))}
                {data[0]?.extra?.map((x) => (
                  <th key={x.label} className="py-1 pr-3 text-right font-medium">
                    {x.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t border-line-soft">
                  <td className="py-1 pr-3">{d.title}</td>
                  {d.values.map((v, k) => (
                    <td key={series[k]?.key ?? k} className="py-1 pr-3 text-right">
                      {format(v)}
                    </td>
                  ))}
                  {d.extra?.map((x) => (
                    <td key={x.label} className="py-1 pr-3 text-right">
                      {x.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
