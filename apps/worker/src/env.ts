import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** En développement, charge le .env racine sans écraser l'environnement existant. */
export function loadDotEnv(): void {
  if (process.env['NODE_ENV'] === 'production') return;
  const candidates = [new URL('../../../../.env', import.meta.url), new URL('../../../.env', import.meta.url)];
  for (const c of candidates) {
    const path = fileURLToPath(c);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || m[1] === undefined) continue;
      if (process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = (m[2] ?? '').replace(/^"(.*)"$/, '$1');
    }
    return;
  }
}
