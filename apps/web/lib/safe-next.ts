/** N'autorise que les redirections internes après connexion (pas d'open redirect). */
export function safeNext(value: string | null | undefined, fallback = '/aujourdhui'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
