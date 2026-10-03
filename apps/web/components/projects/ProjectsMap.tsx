'use client';

import type { ProjectMapDto } from '@batimint/contracts';
import { Button, Chip, EmptyState, ErrorState, PageHeader, Skeleton } from '@batimint/ui';
import { MapPinned } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useCan } from '@/lib/session';
import { useErrorMessage } from '@/lib/use-error-message';

type MapStatus = 'in_progress' | 'preparation' | 'suspended' | 'provisional_acceptance';
/** Couleur (palette validée, ADR 0020) et forme : l'état ne repose jamais sur la couleur seule. */
const STYLE: Record<MapStatus, { color: string; shape: 'circle' | 'square' | 'triangle' | 'diamond' }> = {
  in_progress: { color: 'var(--chart-1)', shape: 'circle' },
  suspended: { color: 'var(--chart-2)', shape: 'triangle' },
  provisional_acceptance: { color: 'var(--chart-3)', shape: 'diamond' },
  preparation: { color: 'var(--muted)', shape: 'square' },
};
const W = 1000;
const H = 620;
const PAD = 48;

function Marker({ shape, color, size = 9 }: { shape: string; color: string; size?: number }) {
  const ring = { stroke: 'var(--surface)', strokeWidth: 2 };
  if (shape === 'square')
    return <rect x={-size} y={-size} width={size * 2} height={size * 2} rx={2} fill={color} {...ring} />;
  if (shape === 'triangle')
    return (
      <path
        d={`M0 ${-size * 1.15} L${size * 1.1} ${size * 0.85} L${-size * 1.1} ${size * 0.85} Z`}
        fill={color}
        {...ring}
      />
    );
  if (shape === 'diamond')
    return (
      <path
        d={`M0 ${-size * 1.25} L${size * 1.25} 0 L0 ${size * 1.25} L${-size * 1.25} 0 Z`}
        fill={color}
        {...ring}
      />
    );
  return <circle r={size} fill={color} {...ring} />;
}

/** Vue carte des chantiers actifs (03 §5) : positions sans fond de carte externe, villes de repère. */
export function ProjectsMap() {
  const t = useTranslations('projects.map');
  const tp = useTranslations('projects');
  const tc = useTranslations('common');
  const can = useCan();
  const errorMessage = useErrorMessage();
  const [active, setActive] = useState<string | null>(null);
  const data = useApi<ProjectMapDto>(['projects', 'map'], can('projects.read') ? '/projects/map' : null);
  if (!can('projects.read'))
    return <ErrorState title={tc('forbiddenTitle')} description={tc('forbiddenDescription')} />;

  const header = (
    <PageHeader
      breadcrumb={
        <Link href="/chantiers" className="hover:underline">
          {tp('title')}
        </Link>
      }
      title={t('title')}
      description={t('description')}
    />
  );
  if (data.error)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {header}
        <ErrorState
          title={tc('errorTitle')}
          description={errorMessage(data.error)}
          action={<Button onClick={() => void data.refetch()}>{tc('retry')}</Button>}
        />
      </div>
    );
  if (!data.data)
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        {header}
        <Skeleton className="h-[420px]" />
      </div>
    );

  const items = data.data.items;
  // Deux chantiers au même endroit (même code postal) : léger éventail pour les distinguer.
  const seen = new Map<string, number>();
  const placed = items
    .filter((i) => i.latitude !== null && i.longitude !== null)
    .map((i) => {
      const key = `${i.latitude!.toFixed(3)}|${i.longitude!.toFixed(3)}`;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      if (!n) return i;
      const angle = (n * 2 * Math.PI) / 6;
      return {
        ...i,
        latitude: i.latitude! + 0.006 * Math.sin(angle),
        longitude: i.longitude! + 0.009 * Math.cos(angle),
      };
    });
  // Cadrage sur les chantiers (au moins ~30 km de côté), projection équirectangulaire corrigée.
  const lats = placed.map((i) => i.latitude!);
  const lons = placed.map((i) => i.longitude!);
  const midLat = lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 50.6;
  const k = Math.cos((midLat * Math.PI) / 180);
  let [minLat, maxLat] = lats.length ? [Math.min(...lats), Math.max(...lats)] : [49.5, 51.5];
  let [minLon, maxLon] = lons.length ? [Math.min(...lons), Math.max(...lons)] : [2.5, 6.4];
  const span = Math.max(maxLat - minLat, (maxLon - minLon) * k, 0.3);
  const cLat = (minLat + maxLat) / 2;
  const cLon = (minLon + maxLon) / 2;
  const ratio = (W - 2 * PAD) / (H - 2 * PAD);
  const latSpan = Math.max(span, ((maxLon - minLon) * k) / ratio) * 1.1;
  const lonSpan = (latSpan * ratio) / k;
  [minLat, maxLat] = [cLat - latSpan / 2, cLat + latSpan / 2];
  [minLon, maxLon] = [cLon - lonSpan / 2, cLon + lonSpan / 2];
  const x = (lon: number) => PAD + ((lon - minLon) / (maxLon - minLon)) * (W - 2 * PAD);
  const y = (lat: number) => PAD + ((maxLat - lat) / (maxLat - minLat)) * (H - 2 * PAD);
  const refs = data.data.references.filter(
    (r) => r.latitude > minLat && r.latitude < maxLat && r.longitude > minLon && r.longitude < maxLon,
  );
  const cur = placed.find((i) => i.project.id === active) ?? items.find((i) => i.project.id === active);
  const statuses = (Object.keys(STYLE) as MapStatus[]).filter((s) => items.some((i) => i.status === s));

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {header}
      {!items.length ? (
        <EmptyState
          icon={<MapPinned aria-hidden className="size-5" />}
          title={t('emptyTitle')}
          description={t('empty')}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <figure
            className="flex flex-col gap-3 rounded-[16px] border border-line bg-surface p-4"
            aria-label={t('title')}
          >
            <ul className="flex flex-wrap gap-4 text-[13px] text-muted">
              {statuses.map((s) => (
                <li key={s} className="flex items-center gap-1.5">
                  <svg width="18" height="18" viewBox="-11 -11 22 22" aria-hidden>
                    <Marker shape={STYLE[s].shape} color={STYLE[s].color} size={6} />
                  </svg>
                  {tp(`status.${s}`)}
                </li>
              ))}
            </ul>
            <div className="relative">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="group" aria-label={t('title')}>
                <rect width={W} height={H} rx={12} fill="var(--line-soft)" opacity={0.5} />
                {refs.map((r) => (
                  <g key={r.name} transform={`translate(${x(r.longitude)} ${y(r.latitude)})`} aria-hidden>
                    <circle r={3} fill="var(--muted)" opacity={0.6} />
                    <text x={7} y={4} fontSize={15} fill="var(--muted)">
                      {r.name}
                    </text>
                  </g>
                ))}
                {placed.map((i) => {
                  const st = STYLE[i.status as MapStatus] ?? STYLE.in_progress;
                  return (
                    <a
                      key={i.project.id}
                      href={`/chantiers/${i.project.id}`}
                      aria-label={`${i.project.name} · ${tp(`status.${i.status}` as 'status.in_progress')}${i.present ? ` · ${t('present', { n: i.present })}` : ''}`}
                      onMouseEnter={() => setActive(i.project.id)}
                      onMouseLeave={() => setActive((a) => (a === i.project.id ? null : a))}
                      onFocus={() => setActive(i.project.id)}
                      onBlur={() => setActive((a) => (a === i.project.id ? null : a))}
                      className="focus-visible:outline-none"
                    >
                      <g transform={`translate(${x(i.longitude!)} ${y(i.latitude!)})`}>
                        <circle r={18} fill="transparent" />
                        {active === i.project.id ? (
                          <circle r={15} fill="none" stroke="var(--accent)" strokeWidth={2} />
                        ) : null}
                        <Marker shape={st.shape} color={st.color} />
                      </g>
                    </a>
                  );
                })}
              </svg>
              {cur && cur.latitude !== null ? (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-10 min-w-48 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] shadow-sm"
                  style={{
                    left: `${(x(cur.longitude!) / W) * 100}%`,
                    top: `${(y(cur.latitude) / H) * 100}%`,
                    transform: `translate(${x(cur.longitude!) > W / 2 ? '-105%' : '12px'}, 12px)`,
                  }}
                >
                  <p className="font-semibold">{cur.project.name}</p>
                  <p className="text-muted">{cur.customer}</p>
                  <p className="text-muted">{tp(`status.${cur.status}` as 'status.in_progress')}</p>
                  {cur.present ? <p>{t('present', { n: cur.present })}</p> : null}
                </div>
              ) : null}
            </div>
            <figcaption className="text-[12px] text-muted">{t('caption')}</figcaption>
          </figure>
          <ul
            className="flex flex-col divide-y divide-line-soft rounded-[16px] border border-line bg-surface"
            aria-label={t('list')}
          >
            {items.map((i) => (
              <li key={i.project.id}>
                <Link
                  href={`/chantiers/${i.project.id}`}
                  onMouseEnter={() => setActive(i.project.id)}
                  onMouseLeave={() => setActive(null)}
                  className="flex min-h-11 flex-col gap-0.5 px-4 py-2.5 hover:bg-line-soft/40 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <svg width="14" height="14" viewBox="-11 -11 22 22" aria-hidden>
                      <Marker
                        shape={(STYLE[i.status as MapStatus] ?? STYLE.in_progress).shape}
                        color={(STYLE[i.status as MapStatus] ?? STYLE.in_progress).color}
                        size={7}
                      />
                    </svg>
                    <span className="font-medium">{i.project.name}</span>
                    {i.present ? <Chip tone="good">{t('present', { n: i.present })}</Chip> : null}
                  </span>
                  <span className="text-[13px] text-muted">
                    {i.project.number} · {tp(`status.${i.status}` as 'status.in_progress')} ·{' '}
                    {i.address ?? t('noAddress')}
                  </span>
                  {i.latitude === null ? (
                    <span className="text-[12px] text-warn">{t('unplaced')}</span>
                  ) : i.approximate ? (
                    <span className="text-[12px] text-muted">{t('approximate')}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
