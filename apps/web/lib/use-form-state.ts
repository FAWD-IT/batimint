'use client';

import { useEffect, useMemo, useState } from 'react';

/** État de formulaire initialisé depuis le serveur, avec détection des modifications. */
export function useFormState<T extends object>(source: T | undefined) {
  const [values, setValues] = useState<T | undefined>(source);
  const [base, setBase] = useState<T | undefined>(source);
  useEffect(() => {
    if (source && JSON.stringify(source) !== JSON.stringify(base)) {
      setBase(source);
      setValues(source);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(base), [values, base]);
  return {
    values,
    setValues,
    dirty,
    set:
      <K extends keyof T>(key: K) =>
      (value: T[K]) =>
        setValues((v) => (v ? { ...v, [key]: value } : v)),
    reset: () => setValues(base),
  };
}
