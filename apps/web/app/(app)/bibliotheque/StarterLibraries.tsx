'use client';

import { Button, Card, Checkbox, Overline, Skeleton } from '@batimint/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApi, useApiMutation } from '@/lib/hooks';

interface Starter {
  trade: 'general' | 'roofing' | 'electrical' | 'plumbing';
  label: string;
  description: string;
  itemCount: number;
}

/** Bibliothèques types par métier (P1.4) : un clic pour démarrer avec des prix du marché belge. */
export function StarterLibraries({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('library');
  const starters = useApi<{ items: Starter[] }>(['items', 'starters'], '/library/starters');
  const [chosen, setChosen] = useState<Set<Starter['trade']>>(new Set(['general']));
  const install = useApiMutation<Starter['trade'][], { created: number; skipped: number }>(
    (trades) => ({ path: '/library/starters', body: { trades } }),
    {
      invalidate: [['items'], ['onboarding']],
      successMessage: (r) => t('installed', { created: r.created }),
    },
  );

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <Overline>{t('starterTitle')}</Overline>
        <p className="mt-1 text-[14px] text-muted">{t('starterDescription')}</p>
      </div>
      {starters.isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <ul className={compact ? 'flex flex-col gap-1' : 'grid gap-3 sm:grid-cols-2'}>
          {(starters.data?.items ?? []).map((s) => (
            <li key={s.trade} className={compact ? undefined : 'rounded-[12px] border border-line px-3 py-1'}>
              <Checkbox
                label={
                  <span>
                    <span className="font-semibold">{s.label}</span>
                    <span className="ml-2 text-muted">{t('items', { count: s.itemCount })}</span>
                    {!compact ? <span className="block text-[13px] text-muted">{s.description}</span> : null}
                  </span>
                }
                checked={chosen.has(s.trade)}
                onChange={(e) =>
                  setChosen((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(s.trade);
                    else next.delete(s.trade);
                    return next;
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        className="self-start"
        disabled={chosen.size === 0}
        loading={install.isPending}
        onClick={() => install.mutate([...chosen])}
      >
        {t('install')}
      </Button>
    </Card>
  );
}
