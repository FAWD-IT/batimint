'use client';

import { useTranslations } from 'next-intl';
import { ApiError } from './api';

/** Message d'erreur affichable : celui de l'API (déjà en français), ou un message générique clair. */
export function useErrorMessage(): (err: unknown) => string {
  const t = useTranslations('common');
  return (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'network_error') return t('networkError');
      if (err.message) return err.message;
    }
    return t('unexpectedError');
  };
}
