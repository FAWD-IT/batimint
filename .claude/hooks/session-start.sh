#!/usr/bin/env bash
# Démarrage de session Claude Code — Batimint
# Installe les dépendances et prépare l'environnement. Idempotent et rapide si rien n'a changé.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ ! -f package.json ]; then
  echo "Batimint : pas encore de package.json, aucune installation."
  exit 0
fi

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile --prefer-offline >/tmp/batimint-install.log 2>&1 || pnpm install --prefer-offline >>/tmp/batimint-install.log 2>&1
else
  pnpm install --prefer-offline >/tmp/batimint-install.log 2>&1
fi

# Client Prisma (généré, non versionné).
pnpm --filter @batimint/db generate >/dev/null 2>&1 || true

# Session cloud : le démon Docker n'est pas lancé par défaut (services de dev via docker compose).
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && command -v dockerd >/dev/null 2>&1; then
  if ! docker info >/dev/null 2>&1; then
    (nohup dockerd >/tmp/dockerd.log 2>&1 &)
  fi
fi

[ -f .env ] || cp .env.example .env

echo "Batimint : dépendances prêtes. Voir docs/PROGRESS.md (« Relancer l'environnement »)."
