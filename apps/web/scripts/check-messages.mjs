#!/usr/bin/env node
/**
 * Vérifie que chaque clé de traduction utilisée dans le code existe dans messages/fr.json
 * (règle 8 : aucune chaîne en dur, et aucune clé manquante qui s'afficherait brute).
 * Analyse statique simple : `const t = useTranslations('ns')` / `getTranslations('ns')`,
 * puis `t('cle')`, `t.raw('cle')` et `t(\`prefixe.${x}\`)` (le préfixe doit exister).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const messages = JSON.parse(readFileSync(path.join(root, 'messages/fr.json'), 'utf8'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(name)) out.push(p);
  }
  return out;
}

function lookup(key) {
  let node = messages;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

const problems = [];
for (const file of [
  ...walk(path.join(root, 'app')),
  ...walk(path.join(root, 'components')),
  ...walk(path.join(root, 'lib')),
]) {
  const src = readFileSync(file, 'utf8');
  const bindings = new Map();
  for (const m of src.matchAll(
    /const\s+(\w+)\s*=\s*(?:await\s+)?\(?\s*(?:useTranslations|getTranslations)\(\s*'([^']*)'\s*\)/g,
  ))
    bindings.set(m[1], m[2]);
  for (const m of src.matchAll(/\(await getTranslations\('([^']+)'\)\)\('([^']+)'\)/g)) {
    if (lookup(`${m[1]}.${m[2]}`) === undefined)
      problems.push(`${path.relative(root, file)}: ${m[1]}.${m[2]}`);
  }
  for (const [name, ns] of bindings) {
    const re = new RegExp(`(?<![\\w.])${name}(?:\\.raw)?\\(\\s*(['\`])([^'\`]*)\\1`, 'g');
    for (const m of src.matchAll(re)) {
      const raw = m[2];
      const full = ns ? `${ns}.${raw}` : raw;
      if (m[1] === '`' && raw.includes('${')) {
        const prefix = full.slice(0, full.indexOf('${')).replace(/\.$/, '');
        const node = lookup(prefix);
        if (node === undefined || typeof node !== 'object')
          problems.push(`${path.relative(root, file)}: ${prefix}.*`);
      } else if (lookup(full) === undefined) {
        problems.push(`${path.relative(root, file)}: ${full}`);
      }
    }
  }
}

if (problems.length) {
  console.error(`Clés de traduction manquantes dans messages/fr.json (${problems.length}) :`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('Traductions : toutes les clés utilisées existent.');
