# 10 — Déploiement sur Coolify

Objectif : une instance Coolify (sur le cluster Proxmox de FAWD ou un VPS) déploie Batimint depuis le repo GitHub privé, branche `main`, avec le **build pack Docker Compose**, sans autre information que ce document.

**Flux** : sessions Claude Code cloud → branche de travail → PR → merge sur `main` → Coolify redéploie automatiquement (webhook GitHub). La CI GitHub Actions doit être verte avant tout merge.

## Connexion GitHub ↔ Coolify
- Dans Coolify : **Sources → GitHub App**, installée sur le repo `batimint` uniquement. C'est la méthode recommandée pour un repo privé ; une deploy key en lecture seule est l'alternative.
- Ressource créée depuis ce repo, branche `main`, build pack **Docker Compose**, fichier `docker-compose.coolify.yml`, avec **Auto Deploy** activé.
- Les builds se font sur le serveur Coolify : aucune image n'a besoin d'être publiée dans un registre (une option GHCR est possible plus tard, par ADR).

## Services de `docker-compose.coolify.yml`
| Service | Image / build | Rôle | Healthcheck |
|---|---|---|---|
| `web` | build `apps/web/Dockerfile` (Next.js `output: standalone`) | Interface | `GET /api/health` |
| `api` | build `apps/api/Dockerfile` | API + SSE + webhooks | `GET /health` |
| `worker` | build `apps/worker/Dockerfile` | Consommateurs, jobs planifiés, PDF (Chromium inclus) | commande de ping interne |
| `migrate` | même image que `api`, commande `pnpm db:migrate:deploy` | Migrations au déploiement, puis sort | `exclude_from_hc: true` |
| `postgres` | `postgres:16-alpine`, volume persistant | Base | `pg_isready` |
| `minio` | `minio/minio`, volume persistant | Stockage S3 | `GET /minio/health/live` |
| `minio-init` | `minio/mc` | Crée les buckets (`uploads`, `legal` versionné), puis sort | `exclude_from_hc: true` |

- `api` et `worker` dépendent de `migrate` (`condition: service_completed_successfully`) et de `postgres` (`service_healthy`).
- Images multi-étapes (deps → build → runtime), utilisateur non-root, `NODE_ENV=production`, image finale minimale.
- Arrêt propre sur SIGTERM : l'API termine les requêtes en cours et ferme les SSE, le worker finit le job en cours.

## Domaines
Recommandation : `app.<domaine>` pour `web` et `api.<domaine>` pour `api`, cookies sur le domaine parent. Une autre option (même origine via le proxy) est possible si l'agent le justifie par ADR. Le SSE ne doit pas être bufferisé (en-têtes `Cache-Control: no-cache`, `X-Accel-Buffering: no`).

Dans Coolify, on renseigne le champ **Domains** de chaque service avec le port interne, par exemple `https://app.batimint.be:3000` et `https://api.batimint.be:4000`.

## Variables d'environnement
Toutes listées et commentées dans `.env.example`. Celles marquées (magique) sont générées par Coolify via ses variables `SERVICE_*`.

| Variable | Exemple / source |
|---|---|
| `DATABASE_URL` | construite à partir de `SERVICE_USER_POSTGRES` et `SERVICE_PASSWORD_POSTGRES` (magique) |
| `APP_URL`, `API_URL` | `SERVICE_URL_WEB`, `SERVICE_URL_API` (magique) ou valeurs fixes |
| `SESSION_SECRET`, `PORTAL_TOKEN_SECRET`, `FIELD_ENCRYPTION_KEY` | `SERVICE_PASSWORD_64_*` (magique) |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_UPLOADS`, `S3_BUCKET_LEGAL` | MinIO interne, identifiants magiques |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | fournisseur SMTP |
| `PEPPOL_PROVIDER` (`mock`\|`getpeppr`), `PEPPOL_GETPEPPR_API_KEY`, `PEPPOL_GETPEPPR_WEBHOOK_SECRET` | getpeppr |
| `ACCOUNTING_PROVIDER` (`mock`\|`chift`), `CHIFT_*` | Chift |
| `PAYMENTS_PROVIDER` (`mock`\|`mollie`), `MOLLIE_*` | Mollie |
| `ONSS_PROVIDER` (`mock`) | ONSS |
| `AI_PROVIDER` (`mock`\|`anthropic`), `ANTHROPIC_API_KEY` | IA |
| `SENTRY_DSN` (optionnel), `LOG_LEVEL` | observabilité |
| `SEED_DEMO` (`true` sur une instance de démo uniquement) | seed |

## Procédure (à rédiger pas à pas par l'agent dans ce fichier, avec captures si possible)
1. Dans Coolify : Projet → Ressource → repo GitHub `batimint` (via la GitHub App), branche `main` → Build Pack **Docker Compose** → fichier `docker-compose.coolify.yml`.
2. Renseigner les domaines de `web` et `api`, puis vérifier les variables générées et compléter les autres.
3. Déployer. Les migrations passent, puis `web`, `api` et `worker` deviennent sains.
4. Configurer les **sauvegardes planifiées** de la base dans Coolify vers un stockage S3 externe, et documenter la restauration testée (un essai réel de restauration fait partie du jalon).
5. Configurer les webhooks entrants (getpeppr, Mollie, e-mail entrant) vers `https://api.<domaine>/v1/webhooks/<fournisseur>`.
6. Créer le super-admin via une commande documentée (`pnpm admin:create`).

## Vérifications de fin
- `docker compose -f docker-compose.coolify.yml up` fonctionne en local avec un `.env` copié de l'exemple, avec `SEED_DEMO=true`.
- Redéployer sans perte de données (volumes), et les migrations restent idempotentes.
- Une mise à jour applicative n'interrompt pas les sessions ; le SSE se reconnecte seul.
