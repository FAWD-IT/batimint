'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Ouvre la création quand l'écran est atteint avec `?nouveau=1` (actions rapides ⌘K), puis
 * retire le paramètre pour qu'un rechargement ne rouvre pas la fenêtre.
 */
export function useNewParam(open: () => void): void {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const wanted = search.get('nouveau') === '1';
  useEffect(() => {
    if (!wanted) return;
    open();
    const next = new URLSearchParams(search.toString());
    next.delete('nouveau');
    const qs = next.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule ouverture par arrivée
  }, [wanted]);
}
