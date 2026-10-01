import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Charge le .env racine en développement (sans écraser les variables déjà définies). */
export function loadEnv(): void {
  const root = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(root)) config({ path: root, quiet: true });
}
