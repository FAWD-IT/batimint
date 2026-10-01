import { getRequestConfig } from 'next-intl/server';

// FR complet ; la structure est prête pour NL (CLAUDE.md règle n°8).
export const LOCALES = ['fr'] as const;
export const DEFAULT_LOCALE = 'fr';

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    timeZone: 'Europe/Brussels',
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
