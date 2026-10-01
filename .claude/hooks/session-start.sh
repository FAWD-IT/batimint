#!/usr/bin/env bash
# Démarrage de session Claude Code — Batimint
# Installe les dépendances quand le monorepo existe. Rapide si rien n'a changé.
# À faire évoluer par l'agent au fil du projet (le garder idempotent et rapide).
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Avant le jalon M0, le repo ne contient que la spécification : rien à faire.
if [ ! -f package.json ]; then
  echo "Batimint : pas encore de package.json, aucune installation."
  exit 0
fi

if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline
else
  pnpm install --prefer-offline
fi

# Dans l'environnement cloud uniquement : démarrer le Postgres local s'il sert aux tests.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && command -v service >/dev/null 2>&1; then
  service postgresql start >/dev/null 2>&1 || true
fi

echo "Batimint : dépendances prêtes. Voir docs/PROGRESS.md pour relancer l'environnement."
