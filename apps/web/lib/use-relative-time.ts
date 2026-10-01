'use client';

import { useFormatter, useNow } from 'next-intl';

/** « il y a 5 minutes », recalculé chaque minute (évite l'heure figée du rendu serveur). */
export function useRelativeTime(): (date: Date | string) => string {
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  return (date) => format.relativeTime(typeof date === 'string' ? new Date(date) : date, now);
}
