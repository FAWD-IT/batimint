'use client';

import type { ExportList } from '@batimint/contracts';
import { buttonClasses } from '@batimint/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Export CSV et Excel d'une liste ou d'un rapport (03 §12) : simples liens de téléchargement vers
 * l'API (session du navigateur), sans état côté client.
 */
export function ExportButtons({
  list,
  path,
  params,
  label,
}: {
  /** Liste standard (`/exports/:list`). */
  list?: ExportList;
  /** Ou chemin d'export complet (`/reports/:report/export`). */
  path?: string;
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const t = useTranslations('exports');
  const base = path ?? `/exports/${list}`;
  const href = (format: 'csv' | 'xlsx') => {
    const q = new URLSearchParams({ format });
    for (const [k, v] of Object.entries(params ?? {})) if (v) q.set(k, v);
    return `/api/v1${base}?${q.toString()}`;
  };
  return (
    <div role="group" aria-label={label ?? t('label')} className="flex items-center gap-1.5">
      {(['csv', 'xlsx'] as const).map((f) => (
        <a
          key={f}
          href={href(f)}
          download
          aria-label={t(f)}
          className={buttonClasses('secondary', 'sm', 'gap-1.5')}
        >
          <Download aria-hidden className="size-4" />
          {f === 'csv' ? 'CSV' : 'Excel'}
        </a>
      ))}
    </div>
  );
}
