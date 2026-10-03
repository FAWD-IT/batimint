#!/usr/bin/env node
// design/tokens.css est la source de vérité (08). On en dérive packages/ui/src/tokens.css sans
// l'@import Google Fonts : Geist est auto-hébergée via next/font (aucune requête vers Google, RGPD).
// `node scripts/sync-tokens.mjs --check` échoue si la copie n'est pas à jour (CI).
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync('design/tokens.css', 'utf8');
const header =
  '/* GÉNÉRÉ depuis design/tokens.css par scripts/sync-tokens.mjs — ne pas modifier à la main. */\n';
const output = header + source.replace(/^@import url\([^)]*\);\s*\n/m, '');
const target = 'packages/ui/src/tokens.css';
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {}
  if (current !== output) {
    console.error(
      `${target} n'est pas synchronisé avec design/tokens.css : lancer node scripts/sync-tokens.mjs`,
    );
    process.exit(1);
  }
  console.info('tokens synchronisés');
} else {
  writeFileSync(target, output);
  console.info(`${target} mis à jour`);
}
