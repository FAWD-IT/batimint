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
| `migrate` | même image que `api`, commande `node packages/db/dist/migrate.js deploy` | Migrations (+ seed si `SEED_DEMO`), puis au repos | fichier témoin, puis au repos (ADR 0007) |
| `postgres` | `postgres:16-alpine`, volume persistant | Base | `pg_isready` |
| `minio` | `pgsty/minio` (ADR 0006), volume persistant | Stockage S3 | `GET /minio/health/live` |
| `minio-init` | `pgsty/minio` (`mc`) | Crée les buckets (`uploads`, `legal` versionné et verrouillé), puis au repos | fichier témoin, puis au repos (ADR 0007) |

- `api` et `worker` dépendent de `migrate` (`condition: service_healthy`, ADR 0007) et de `postgres` (`service_healthy`).
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

## Procédure pas à pas

> Prérequis : une instance Coolify v4 avec un serveur Docker (≥ 4 Go de RAM, 2 vCPU, 20 Go de disque), un domaine dont vous gérez le DNS, et un compte SMTP transactionnel (Brevo, Postmark, Scaleway TEM…).

### 1. DNS
Créez deux enregistrements `A` (ou `CNAME`) vers l'IP du serveur Coolify :
- `app.<domaine>` → interface (web) ;
- `api.<domaine>` → API (app mobile, webhooks, documentation OpenAPI). Facultatif tant qu'aucun webhook réel n'est branché : le navigateur passe par `app.<domaine>/api/v1` (ADR 0003).

### 2. Source GitHub
Coolify → **Sources** → **+ Add** → **GitHub App**. Suivez l'assistant puis, sur GitHub, n'autorisez que le dépôt `batimint`.

### 3. Ressource
1. Coolify → **Projects** → votre projet → environnement `production` → **+ New** → **Private Repository (with GitHub App)**.
2. Dépôt `batimint`, branche **`main`**, **Build Pack : Docker Compose**.
3. **Docker Compose Location** : `/docker-compose.coolify.yml`. Base Directory : `/`.
4. Validez : Coolify lit le fichier et liste les services (`web`, `api`, `worker`, `migrate`, `postgres`, `minio`, `minio-init`).

### 4. Domaines
Dans l'onglet de la ressource, pour chaque service :
- `web` → **Domains** : `https://app.<domaine>:3000`
- `api` → **Domains** : `https://api.<domaine>:4000`
- les autres services : aucun domaine.

Coolify configure le proxy (Traefik/Caddy) et les certificats Let's Encrypt. Les variables `SERVICE_URL_WEB` et `SERVICE_URL_API` prennent ces valeurs : elles servent d'`APP_URL` (liens des e-mails, portails) et d'`API_URL`.

### 5. Variables d'environnement
Onglet **Environment Variables**. Coolify a déjà généré les secrets « magiques » (ne pas les modifier après le premier déploiement, sinon les données chiffrées deviennent illisibles) :

| Variable générée | Rôle |
|---|---|
| `SERVICE_USER_POSTGRES`, `SERVICE_PASSWORD_POSTGRES` | Propriétaire de la base (migrations) |
| `SERVICE_PASSWORD_APPDB` | Mot de passe du rôle applicatif `batimint_app` (sans BYPASSRLS), créé par `migrate` |
| `SERVICE_PASSWORD_64_SESSION`, `SERVICE_PASSWORD_64_PORTAL` | Secrets de session et des liens portail |
| `SERVICE_PASSWORD_64_FIELDKEY` | Clé de chiffrement applicatif (INSS, secrets d'intégration, TOTP) — **à sauvegarder hors de Coolify** |
| `SERVICE_USER_MINIO`, `SERVICE_PASSWORD_MINIO` | Identifiants MinIO |

À compléter :

| Variable | Valeur |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | Votre fournisseur SMTP (sans `SMTP_HOST`, les e-mails sont simulés et non envoyés) |
| `MAIL_FROM` | ex. `Batimint <no-reply@<domaine>>` (domaine authentifié SPF/DKIM) |
| `SEED_DEMO` | `true` **uniquement** sur une instance de démonstration (crée Rénov'Habitat et ses personas, mot de passe `SEED_DEMO_PASSWORD`, `batimint-demo` par défaut) |
| `COOKIE_DOMAIN` | laisser vide (même origine) |
| Intégrations | `PEPPOL_PROVIDER`, `ACCOUNTING_PROVIDER`, `PAYMENTS_PROVIDER`, `AI_PROVIDER`, `VAT_VALIDATOR_PROVIDER` restent à `mock` jusqu'au jalon M12 ; clés sandbox uniquement ensuite |

Les autres variables ont des valeurs par défaut sensées (voir `.env.example`, entièrement commenté).

### 6. Déployer
Cliquez **Deploy**. Ordre de démarrage (garanti par les `depends_on`) :
1. `postgres` et `minio` deviennent sains ;
2. `minio-init` crée les buckets `batimint-uploads` et `batimint-legal` (verrouillage d'objets, versionnement, rétention 10 ans) puis reste au repos, sain ;
3. `migrate` applique les migrations Prisma, provisionne le rôle applicatif, vérifie que **toutes** les tables métier ont la RLS, charge le seed si `SEED_DEMO=true`, puis reste au repos, sain (ADR 0007) ;
4. `api` et `worker` démarrent, puis `web`.

Le premier build prend 5 à 10 minutes. Vérifications :
- `https://app.<domaine>` affiche la connexion ;
- `https://api.<domaine>/ready` répond `{"status":"ready", …}` ;
- Paramètres → Diagnostic → **Tester maintenant** affiche « Tout fonctionne » (chaîne API → outbox → worker → temps réel).

Activez **Auto Deploy** (onglet General) : chaque merge sur `main` redéploie. Les volumes `postgres-data` et `minio-data` sont conservés ; les migrations sont idempotentes ; l'API ferme proprement ses flux SSE sur SIGTERM et les navigateurs se reconnectent seuls.

### 7. Super-admin
Dans Coolify, ouvrez un **Terminal** sur le conteneur `api` et lancez :
```bash
node packages/db/dist/admin-create.js --email vous@<domaine> --name "Votre nom"
```
Le mot de passe généré s'affiche une fois (ou passez `--password`). En développement : `pnpm admin:create -- --email …`.

### 8. Sauvegardes et restauration
1. Coolify → **Storages** → ajoutez un stockage S3 **externe** au serveur (Scaleway, OVH, Backblaze…).
2. Service `postgres` → **Backups** → planification quotidienne (`0 2 * * *`), rétention 30 jours, destination ce stockage.
3. Sauvegardez aussi les fichiers : `mc mirror` du volume MinIO vers le même stockage (tâche planifiée Coolify sur `minio`), ou un bucket répliqué.
4. **Restauration testée** (à refaire après chaque montée de version majeure) :
   ```bash
   # sur une instance de test, ressource identique, base vide
   docker exec -i <conteneur-postgres> pg_restore -U "$SERVICE_USER_POSTGRES" -d batimint --clean --if-exists < sauvegarde.dump
   # puis redéployer : migrate réapplique les droits du rôle applicatif et vérifie la RLS
   ```
   Contrôle : connexion d'un utilisateur, ouverture d'un chantier, téléchargement d'une facture archivée.

### 9. Webhooks entrants (à partir de M7/M8/M12)
Configurer chez chaque fournisseur : `https://api.<domaine>/v1/webhooks/<fournisseur>` (`getpeppr`, `mollie`, `inbound-email`), avec le secret correspondant dans les variables.

### 10. Dépannage
| Symptôme | Cause probable |
|---|---|
| `migrate` en erreur, `api` ne démarre pas | Lire les logs de `migrate` : base injoignable, ou table métier sans RLS (le déploiement est volontairement bloqué) |
| Connexion impossible, cookie absent | L'interface doit être servie en HTTPS (cookies `Secure` en production) |
| « En direct » ne s'allume pas | Un proxy intermédiaire bufferise le SSE : vérifier qu'aucune compression n'est ajoutée devant `web` |
| E-mails non reçus | `SMTP_HOST` vide (mode simulé) ou domaine expéditeur non authentifié |
| Port 3000/4000 déjà utilisé sur l'hôte | Les ports ne sont publiés que sur `127.0.0.1` pour l'usage local ; changer `WEB_HOST_PORT` / `API_HOST_PORT` |

## Vérifications de fin
- `docker compose -f docker-compose.coolify.yml up` fonctionne en local avec un `.env` copié de l'exemple, avec `SEED_DEMO=true`.
- Redéployer sans perte de données (volumes), et les migrations restent idempotentes.
- Une mise à jour applicative n'interrompt pas les sessions ; le SSE se reconnecte seul.
