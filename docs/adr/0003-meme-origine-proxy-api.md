# ADR 0003 — Même origine : le web relaie `/api/v1` vers l'API

- **Date** : 2026-10-01
- **Statut** : accepté

## Contexte
`docs/10` recommande `app.<domaine>` et `api.<domaine>` avec cookies sur le domaine parent, et autorise la même origine via proxy si justifié. Les domaines générés par Coolify (sslip.io…) ne partagent pas toujours un domaine parent utilisable, ce qui casse les cookies inter-domaines.

## Décision
Le navigateur ne parle qu'à l'interface : un Route Handler Next (`apps/web/app/api/v1/[...path]/route.ts`) relaie les requêtes vers `API_INTERNAL_URL` (réseau interne Docker), en flux (le SSE n'est pas bufferisé, `compress: false`). Les cookies sont first-party, sans CORS. L'API reste exposée sur son propre domaine pour l'app mobile (Bearer), les webhooks (`/v1/webhooks/<fournisseur>`) et la documentation OpenAPI (`/docs`).

## Conséquences
Un seul domaine indispensable pour les utilisateurs ; `COOKIE_DOMAIN` reste disponible si l'on veut des cookies partagés. Coût : un saut réseau interne (quelques ms). L'IP client est transmise par `X-Forwarded-For`.
