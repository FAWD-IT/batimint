'use client';

import { useEffect, useState } from 'react';

/** Valeur retardée : la recherche instantanée n'interroge l'API qu'après une courte pause de frappe. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
